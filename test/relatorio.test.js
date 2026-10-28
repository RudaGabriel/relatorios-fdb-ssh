"use strict";
// Testes automáticos (node:test) — rodam sem Firebird real: cada teste monta
// uma pasta temporária com servidor/gerador + o Firebird simulado de
// test/mock-firebird. Uso: npm test   (ou: node --test test/)
// Observação: perto da meia-noite os testes de correção de horário podem
// falhar de propósito (o servidor ignora correções no 1º minuto do dia).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");

const RAIZ_PROJETO = path.join(__dirname, "..");
const SENHA = "senha-de-teste";

const pad = n => String(n).padStart(2, "0");
const hojeISO = () => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
const horaHaMin = m => { const d = new Date(Date.now() - m * 60000); return [d.getHours(), d.getMinutes(), d.getSeconds()].map(pad).join(":"); };
const esperar = ms => new Promise(r => setTimeout(r, ms));

const portaLivre = () => new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
});

function montarPasta(config, estado) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relatorio-teste-"));
    for (const f of ["servidor-relatorio.js", "gerar-relatorio-html.js"]) fs.copyFileSync(path.join(RAIZ_PROJETO, f), path.join(dir, f));
    const mock = path.join(dir, "node_modules", "node-firebird");
    fs.mkdirSync(mock, { recursive: true });
    fs.copyFileSync(path.join(__dirname, "mock-firebird", "index.js"), path.join(mock, "index.js"));
    fs.copyFileSync(path.join(__dirname, "mock-firebird", "package.json"), path.join(mock, "package.json"));
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(Object.assign({
        appName: "Teste", porta: 7734, pollInterval: 200, fbHost: "127.0.0.1", fdbPath: "/tmp/teste.fdb",
        proibidos: [], maxLogLines: 5000, logDebug: false, toastDuration: 5000, spawnTimeoutMs: 120000, teclasPersonalizadas: []
    }, config || {}), null, 2));
    fs.writeFileSync(path.join(dir, "estado.json"), JSON.stringify(Object.assign({ nfce: [], pag: [], ger: [] }, estado || {})));
    return dir;
}
// Grava o estado do "banco" de forma atômica (arquivo temporário + rename): o
// fast-poll lê o estado a cada ~15 ms e, com writeFileSync direto, podia pegar
// o arquivo no meio da escrita (vazio) e ver uma venda "sumir" e voltar.
// No Windows o rename falha com EPERM/EBUSY/EACCES enquanto o servidor está lendo o
// arquivo naquele instante: tenta de novo por até ~2 s antes de desistir.
const gravarEstado = (dir, st) => {
    const tmp = path.join(dir, "estado.json.tmp");
    fs.writeFileSync(tmp, JSON.stringify(st));
    const espera = new Int32Array(new SharedArrayBuffer(4));
    for (let i = 0; ; i++) {
        try { fs.renameSync(tmp, path.join(dir, "estado.json")); return; } catch (e) {
            if (!["EPERM", "EBUSY", "EACCES"].includes(e.code) || i >= 200) throw e;
            Atomics.wait(espera, 0, 0, 10);
        }
    }
};
const ambiente = dir => Object.assign({}, process.env, { MOCK_SENHA: SENHA, RELATORIO_FB_PASS: SENHA, MOCK_FB_DIR: dir });
const lerSqlLog = dir => { try { return fs.readFileSync(path.join(dir, "sql.log"), "utf8"); } catch (_) { return ""; } };

function gerar(dir) {
    const saida = path.join(dir, "saida.html");
    const r = spawnSync(process.execPath, ["gerar-relatorio-html.js", "--fdb", "127.0.0.1:/tmp/teste.fdb", "--data", hojeISO(), "--saida", saida],
        { cwd: dir, env: ambiente(dir), encoding: "utf8", timeout: 60000 });
    assert.strictEqual(r.status, 0, "gerador saiu com erro:\n" + r.stdout + r.stderr);
    return fs.readFileSync(saida, "utf8");
}

async function iniciarServidor(dir, envExtra) {
    const porta = await portaLivre();
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
    cfg.porta = porta;
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(cfg, null, 2));
    const proc = spawn(process.execPath, ["servidor-relatorio.js", "--no-browser"], { cwd: dir, env: Object.assign(ambiente(dir), envExtra || {}), stdio: "ignore" });
    const base = "http://127.0.0.1:" + porta;
    for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/db-status"); break; } catch (_) { await esperar(200); } }
    return { proc, base, parar: () => { try { proc.kill(); } catch (_) {} } };
}

// ---------------------------------------------------------------------------
test("gerador: teclas de atalho com </script> saem escapadas (sem XSS)", () => {
    const dir = montarPasta({ teclasPersonalizadas: [{ tecla: "F2", comando: "</script><script>window.__X=1</script>", acao: "" }] });
    const html = gerar(dir);
    assert.ok(!html.includes("<script>window.__X=1</script>"), "payload apareceu cru no HTML");
    assert.ok(html.includes("\\u003c/script>"), "escape \\u003c não encontrado");
});

test("gerador: hora-fixada-cache.json preserva entradas gravadas por outro processo", () => {
    const dir = montarPasta({}, { nfce: [{ numero: "200", hora: horaHaMin(10) }, { numero: "201", hora: horaHaMin(1) }] });
    const chaveServidor = hojeISO() + "|999";
    fs.writeFileSync(path.join(dir, "hora-fixada-cache.json"), JSON.stringify({ [chaveServidor]: { tipo: "gerencial", hora: "OK" } }));
    gerar(dir);
    const cache = JSON.parse(fs.readFileSync(path.join(dir, "hora-fixada-cache.json"), "utf8"));
    assert.deepStrictEqual(cache[chaveServidor], { tipo: "gerencial", hora: "OK" }, "entrada do servidor foi apagada");
    assert.strictEqual(cache[hojeISO() + "|201"].hora, "OK", "venda dentro da tolerância deveria ser marcada OK");
    assert.match(cache[hojeISO() + "|200"].hora, /^\d{2}:\d{2}$/, "venda fora da tolerância deveria ter hora fixada");
});

test("gerador: hora-fixada-cache.json registra venda cancelada e gerencial convertida", () => {
    const dir = montarPasta({}, { nfce: [
        { numero: "300", hora: horaHaMin(10), modelo: 99 },
        { numero: "301", hora: horaHaMin(10), modelo: 99 }
    ] });
    const lerCache = () => JSON.parse(fs.readFileSync(path.join(dir, "hora-fixada-cache.json"), "utf8"));
    const alterar = fn => { const st = JSON.parse(fs.readFileSync(path.join(dir, "estado.json"), "utf8")); fn(st); fs.writeFileSync(path.join(dir, "estado.json"), JSON.stringify(st)); };
    const k300 = hojeISO() + "|300", k301 = hojeISO() + "|301";
    gerar(dir);
    const hora300 = lerCache()[k300].hora;
    assert.match(hora300, /^\d{2}:\d{2}$/, "gerencial ativa ganha hora fixada");
    assert.strictEqual(lerCache()[k300].situacao, undefined, "ativa: sem situação");

    // 300 cancelada; 301 convertida na NFC-e 125000 (linha nova aponta para ela).
    alterar(st => {
        st.nfce[0].canc = "S";
        st.nfce[1].canc = "T";
        st.nfce.push({ numero: "125000", hora: horaHaMin(1), modelo: 65, gerencial: "301" });
    });
    gerar(dir);
    let c = lerCache();
    assert.deepStrictEqual(c[k300], { tipo: "gerencial", hora: hora300, situacao: "cancelada" }, "cancelada, mesma hora");
    assert.strictEqual(c[k301].situacao, "convertida");
    assert.deepStrictEqual(c[k301].convertidaEm, { tipo: "nfce", numero: "125000" });

    // v3.8.1: gerencial marcada 'S' MAS com documento fiscal apontando para ela
    // = convertida (o vínculo prevalece); número repetido com uma linha
    // cancelada e outra ativa = ativa (é a que está na tela).
    alterar(st => {
        st.nfce.push({ numero: "302", hora: horaHaMin(10), modelo: 99 });
        st.nfce.push({ numero: "303", hora: horaHaMin(10), modelo: 65, total: 20 });
    });
    gerar(dir);
    alterar(st => {
        st.nfce.find(r => r.numero === "302").canc = "S";
        st.nfce.push({ numero: "125001", hora: horaHaMin(1), modelo: 65, gerencial: "302" });
        st.nfce.push({ numero: "303", hora: horaHaMin(10), modelo: 65, total: 20, canc: "S" });
    });
    gerar(dir);
    c = lerCache();
    assert.strictEqual(c[hojeISO() + "|302"].situacao, "convertida", "vínculo GERENCIAL prevalece sobre o 'S'");
    assert.deepStrictEqual(c[hojeISO() + "|302"].convertidaEm, { tipo: "nfce", numero: "125001" });
    assert.strictEqual(c[hojeISO() + "|303"].situacao, undefined, "a 303 ativa está na tela — não pode virar cancelada");

    // 300 volta a ficar ativa: a situação sai, a hora continua a mesma.
    alterar(st => { st.nfce[0].canc = "N"; });
    gerar(dir);
    c = lerCache();
    assert.deepStrictEqual(c[k300], { tipo: "gerencial", hora: hora300 });
    assert.strictEqual(c[k301].situacao, "convertida", "a outra não muda");
});

test("gerador: janela de correção de horário — padrão 3 h e valor configurado", (t) => {
    // Venda de 2 h atrás com a data de hoje: antes das 02:05 ela cairia no dia anterior.
    const agoraT = new Date();
    if (agoraT.getHours() * 60 + agoraT.getMinutes() < 125) { t.skip("antes das 02:05 a venda de 2 h atrás não cabe no dia"); return; }
    // Venda com hora 2 h atrás: dentro da janela padrão (180 min) → hora fixada;
    // com janela configurada em 60 min → fora da janela, nenhuma entrada no cache.
    const estado = { nfce: [{ numero: "400", hora: horaHaMin(120) }] };
    const chave = hojeISO() + "|400";

    const dirPadrao = montarPasta({}, estado);
    gerar(dirPadrao);
    const cachePadrao = JSON.parse(fs.readFileSync(path.join(dirPadrao, "hora-fixada-cache.json"), "utf8"));
    assert.ok(cachePadrao[chave] && /^\d{2}:\d{2}$/.test(cachePadrao[chave].hora), "com o padrão de 3 h a venda de 2 h atrás deveria ser fixada");

    const dir60 = montarPasta({ janelaCorrecaoHoraMin: 60 }, estado);
    gerar(dir60);
    let cache60 = {};
    try { cache60 = JSON.parse(fs.readFileSync(path.join(dir60, "hora-fixada-cache.json"), "utf8")); } catch (_) {}
    assert.strictEqual(cache60[chave], undefined, "com janela de 60 min a venda de 2 h atrás deveria ser ignorada");
});

test("gerador: aviso de possível duplicidade ignora gerencial e NFC-e de vendedores diferentes", () => {
    // Caso real: gerencial 063538 (VENDEDOR A) × NFC-e 125319 (VENDEDOR B), mesmo
    // valor e 5 min depois — são duas vendas, não uma convertida.
    const codigos = estado => {
        const html = gerar(montarPasta({}, estado));
        const dados = JSON.parse(html.match(/<script id="dados" type="application\/json">([\s\S]*?)<\/script>/)[1]);
        return ((dados.autoteste && dados.autoteste.achados) || []).map(a => a.codigo);
    };
    const venda = (vg, vn) => ({ nfce: [
        { numero: "63538", hora: "10:00:00", modelo: 99, total: 19, vendedor: vg },
        { numero: "125319", hora: "10:05:00", modelo: 65, total: 19, vendedor: vn }
    ] });
    assert.ok(!codigos(venda("VENDEDOR A", "VENDEDOR B")).includes("POSSIVEL_DUPLICIDADE"), "vendedores diferentes: não é duplicidade");
    // v3.8.3: mesmo vendedor (ou NFC-e ainda sem vendedor) = conversão — a
    // reconciliação final resolve sozinha e o aviso não sobra.
    assert.ok(!codigos(venda("VENDEDOR A", "VENDEDOR A")).includes("POSSIVEL_DUPLICIDADE"), "mesmo vendedor: absorvida, sem aviso pendente");
    assert.ok(!codigos(venda("VENDEDOR A", "")).includes("POSSIVEL_DUPLICIDADE"), "NFC-e sem vendedor: absorvida, sem aviso pendente");
    // Itens dos dois lados sem nenhum em comum: são duas vendas — nem absorve, nem avisa.
    const comItens = venda("VENDEDOR A", "VENDEDOR A");
    comItens.alt = [{ pedido: "63538", desc: "CANETA AZUL", qtd: 1, total: 19 }, { pedido: "125319", desc: "CADERNO", qtd: 1, total: 19 }];
    const htmlItens = gerar(montarPasta({}, comItens));
    const dItens = JSON.parse(htmlItens.match(/<script id="dados" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    assert.strictEqual(dItens.vendas.length, 2, "itens diferentes: as duas vendas ficam");
    assert.ok(!dItens.autoteste.achados.some(a => a.codigo === "POSSIVEL_DUPLICIDADE"), "itens diferentes: não é duplicidade");
});

test("gerador: visualização detalhada (painel com gráficos) e modo leve vêm no relatório", () => {
    const html = gerar(montarPasta({}, { nfce: [{ numero: "500", hora: "10:00:00", modelo: 65, total: 30 }], pagGer: [{ numero: "500", forma: "03 PIX", valor: 30 }] }));
    assert.match(html, /<div class="dash" id="dash"/, "contêiner do painel");
    assert.match(html, /class="tmPerfOp tmVisOp"[^>]*data-vis="detalhada"/, "opção Detalhada no menu Tema");
    assert.match(html, /localStorage\.getItem\("fdb_vis"\)/, "visualização decidida no <head>");
    assert.match(html, /window\.__perfDecidir/, "modo leve decidido no <head>");
    const dados = JSON.parse(html.match(/<script id="dados" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    assert.ok(dados.vendas[0].formasValores && dados.vendas[0].formasValores.PIX === 30, "forma de pagamento chega ao painel");
});

test("padrão de fábrica: config.json do repositório sem dados de loja e sem proibidos embutidos", t => {
    // Confere a versão VERSIONADA (git), não o config.json da pasta: numa instalação real
    // ele já tem o nome da loja, o banco e os proibidos configurados — e está certo assim.
    const g = spawnSync("git", ["show", "HEAD:config.json"], { cwd: RAIZ_PROJETO, encoding: "utf8", timeout: 15000 });
    if (g.error || g.status !== 0 || !String(g.stdout || "").trim()) {
        t.diagnostic("git indisponível ou pasta fora do repositório: config.json de fábrica não conferido (o da pasta é o da loja).");
    } else {
        const cfg = JSON.parse(g.stdout.replace(/^\uFEFF/, ""));
        assert.strictEqual(cfg.appName, "Relatorios");
        assert.deepStrictEqual(cfg.proibidos, []);
        assert.deepStrictEqual(cfg.teclasPersonalizadas, []);
        for (const k of ["fbHost", "fdbPath", "maquinaIP", "fbUser", "fbPass", "favicon"]) assert.strictEqual(cfg[k], "", k + " deveria estar vazio");
    }
    // hora-fixada-cache.json não é versionado: o sistema o cria sozinho na primeira correção.
    // O gerador precisa funcionar sem ele (montarPasta não cria o arquivo).
    const html = gerar(montarPasta());
    assert.ok(html.includes("const proibidosPadrao=[];"), "a lista padrão de proibidos deveria vir vazia");
});

test("gerador: duplicata gerencial→NFC-e vai para o painel e sai da tabela", () => {
    const dir = montarPasta({}, { nfce: [
        { numero: "300", hora: "10:00", modelo: 99 },
        { numero: "301", hora: "10:05", modelo: 65, gerencial: "300" }
    ] });
    const html = gerar(dir);
    const dados = JSON.parse(html.match(/<script id="dados" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    assert.strictEqual(dados.duplicatas.confirmadas.length, 1);
    assert.strictEqual(dados.duplicatas.confirmadas[0].gerencial, "300");
    assert.ok(!dados.vendas.some(v => v.numero === "300" || v.numero === "000300"), "gerencial absorvida continuou na tabela");
});

test("gerador: gerencial convertida sem vínculo é absorvida pelo documento fiscal usando os valores FINAIS", () => {
    // Caso real (v3.8.3): o NFCE.TOTAL bruto da gerencial (1000) difere do total
    // final (itens do ALTERACA = 1215,51) — a 1ª reconciliação não via o par,
    // só o auto-teste. Agora o documento fiscal prevalece automaticamente.
    const dir = montarPasta({}, {
        nfce: [
            { numero: "62418", hora: "10:00:00", modelo: 99, total: 1000, vendedor: "VENDEDOR A" },
            { numero: "306", hora: "10:07:00", modelo: 65, total: 1215.51, vendedor: "VENDEDOR A" },
            // Mesmo valor e janela, vendedores diferentes: duas vendas — fica tudo.
            { numero: "63538", hora: "11:00:00", modelo: 99, total: 19, vendedor: "VENDEDOR A" },
            { numero: "125319", hora: "11:03:00", modelo: 65, total: 19, vendedor: "VENDEDOR B" }
        ],
        alt: [
            { pedido: "62418", desc: "PRODUTO A", qtd: 1, total: 1000 },
            { pedido: "62418", desc: "PRODUTO B", qtd: 1, total: 215.51 }
        ]
    });
    const html = gerar(dir);
    const dados = JSON.parse(html.match(/<script id="dados" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    const num = v => String(v.numero).replace(/^0+/, "");
    assert.ok(!dados.vendas.some(v => num(v) === "62418"), "gerencial convertida continuou na tabela");
    const doc = dados.vendas.find(v => num(v) === "306");
    assert.ok(doc, "o documento fiscal tem que continuar");
    assert.ok(Math.abs(doc.total - 1215.51) < 0.001);
    const par = dados.duplicatas.provaveis.find(d => String(d.gerencial).replace(/^0+/, "") === "62418");
    assert.ok(par, "o par vai para o painel Duplicatas");
    assert.strictEqual(String(par.docNumero).replace(/^0+/, ""), "306");
    assert.strictEqual(par.docModelo, 65);
    assert.ok(Math.abs(par.total - 1215.51) < 0.001, "total do par = total final da gerencial");
    assert.ok(Array.isArray(par.itensDetalhe) && par.itensDetalhe.length === 2, "itens da gerencial seguem no par (para \"manter apenas a gerencial\")");
    assert.ok(Math.abs(dados.totaisDia.geral - (1215.51 + 19 + 19)) < 0.001, "a venda não pode ser contada duas vezes");
    assert.ok(dados.vendas.some(v => num(v) === "63538") && dados.vendas.some(v => num(v) === "125319"), "vendedores diferentes: as duas vendas ficam");
    assert.ok(dados.autoteste && Array.isArray(dados.autoteste.achados), "auto-teste presente no relatório");
    assert.ok(!dados.autoteste.achados.some(a => a.codigo === "POSSIVEL_DUPLICIDADE"), "par já resolvido não pode continuar no aviso do auto-teste");
});

test("gerador: gerencial absorvida pelos valores finais vira \"convertida\" no hora-fixada-cache.json", (t) => {
    const agoraT = new Date(), minHoje = agoraT.getHours() * 60 + agoraT.getMinutes();
    if (minHoje < 15) { t.skip("logo após a meia-noite: o caso de 10 min atrás não cabe no dia"); return; }
    const dir = montarPasta({}, {
        nfce: [{ numero: "62418", hora: horaHaMin(10), modelo: 99, total: 1000 }],
        alt: [{ pedido: "62418", desc: "PRODUTO A", qtd: 1, total: 1215.51 }]
    });
    const lerCache = () => JSON.parse(fs.readFileSync(path.join(dir, "hora-fixada-cache.json"), "utf8"));
    const k = hojeISO() + "|62418";
    gerar(dir);
    assert.ok(lerCache()[k], "gerencial ativa ganha hora fixada");
    const st = JSON.parse(fs.readFileSync(path.join(dir, "estado.json"), "utf8"));
    st.nfce.push({ numero: "306", hora: horaHaMin(5), modelo: 65, total: 1215.51 });
    gravarEstado(dir, st);
    gerar(dir);
    const ent = lerCache()[k];
    assert.strictEqual(ent.situacao, "convertida");
    assert.deepStrictEqual(ent.convertidaEm, { tipo: "nfce", numero: "306" });
});

// ---------------------------------------------------------------------------
test("gerador: NFC-e reemitida como NF-e (mesmos itens e valor) conta uma vez só e a NF-e prevalece", () => {
    // Caso real (v3.8.4): NFC-e 125636 (VENDEDOR C, 16:17) e NF-e 000307 (cliente,
    // sem vendedor) com os mesmos 3 itens e R$ 453,35 — eram somadas as duas.
    const itens = p => [
        { pedido: p, desc: "RACAO CAES HIPOALERGENICA 10KG", qtd: 1, total: 300 },
        { pedido: p, desc: "ANTIPULGAS 0,2MG", qtd: 1, total: 53.35 },
        { pedido: p, desc: "ANTIBIOTICO 50MG COMPRIMIDOS", qtd: 1, total: 100 }
    ];
    const dir = montarPasta({}, {
        nfce: [
            { numero: "125636", hora: "16:17:00", modelo: 65, total: 453.35, vendedor: "VENDEDOR C" },
            // Hora da NF-e (saída) ANTES da NFC-e: não pode impedir (v3.8.6).
            { numero: "307", hora: "08:00:00", modelo: 55, total: 453.35, vendedor: "" },
            // Mesmo valor, itens diferentes: duas vendas — ficam as duas.
            { numero: "125700", hora: "16:30:00", modelo: 65, total: 80, vendedor: "VENDEDOR D" },
            { numero: "308", hora: "16:40:00", modelo: 55, total: 80, vendedor: "" }
        ],
        // A NFC-e tem a linha de desconto (5%); a NF-e não — v3.8.6 ignora descontos.
        alt: [...itens("125636"), { pedido: "125636", desc: "DESCONTO", qtd: 1, total: -21.65 }, ...itens("307"),
            { pedido: "125700", desc: "COLEIRA", qtd: 1, total: 80 },
            { pedido: "308", desc: "SHAMPOO", qtd: 1, total: 80 }]
    });
    const html = gerar(dir);
    const dados = JSON.parse(html.match(/<script id="dados" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    const num = v => String(v.numero).replace(/^0+/, "");
    assert.ok(!dados.vendas.some(v => num(v) === "125636"), "NFC-e reemitida continuou na tabela");
    const nfe = dados.vendas.find(v => num(v) === "307");
    assert.ok(nfe && nfe.modelo === 55, "a NF-e tem que continuar");
    assert.strictEqual(nfe.vendedor, "VENDEDOR C", "NF-e sem vendedor herda o da NFC-e");
    assert.ok(Math.abs(dados.totaisDia.geral - (453.35 + 80 + 80)) < 0.001, "a venda não pode ser contada duas vezes");
    assert.ok(dados.vendas.some(v => num(v) === "125700") && dados.vendas.some(v => num(v) === "308"), "itens diferentes: as duas ficam");
    const par = dados.duplicatas.provaveis.find(d => num({ numero: d.gerencial }) === "125636");
    assert.ok(par, "o par vai para o painel Duplicatas");
    assert.strictEqual(par.origemModelo, 65);
    assert.strictEqual(par.docModelo, 55);
    assert.strictEqual(num({ numero: par.docNumero }), "307");
});

test("gerador: nome com acento em coluna sem charset sai certo (lido como bytes)", () => {
    // Caso real (v3.8.5): "Atendente Número 1" aparecia como "Atendente N\uFFFDmero 1".
    const estado = { nfce: [{ numero: "500", hora: "10:00:00", modelo: 65, total: 30, vendedor: "ATENDENTE NÚMERO 1" }] };
    const ler = html => JSON.parse(html.match(/<script id="dados" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    const d1 = ler(gerar(montarPasta({}, estado)));
    assert.strictEqual(d1.vendas[0].vendedor, "ATENDENTE NÚMERO 1");
    // Firebird que recusa OCTETS: a geração não cai, só volta ao comportamento antigo.
    const d2 = ler(gerar(montarPasta({}, Object.assign({ semOctets: true }, estado))));
    assert.strictEqual(d2.vendas.length, 1, "a venda continua no relatório");
    assert.strictEqual(d2.vendas[0].vendedor, "ATENDENTE N\uFFFDMERO 1");
});

test("servidor: somente leitura — nenhuma escrita no banco; hora corrigida só na tela, com linha de base", { timeout: 60000 }, async (t) => {
    // As vendas do teste são "N minutos atrás" com a data de HOJE: perto da
    // meia-noite elas cairiam no dia anterior (e virariam hora no futuro).
    // Só usa os casos que cabem no dia de hoje.
    const agoraT = new Date(), minHoje = agoraT.getHours() * 60 + agoraT.getMinutes();
    if (minHoje < 35) { t.skip("logo após a meia-noite: os casos de 30 min atrás não cabem no dia"); return; }
    const comGerenciais = minHoje >= 205; // 700 (2h30) e 701 (3h20) só cabem a partir das 03:25
    const dir = montarPasta({}, {
        nfce: [{ numero: "100", hora: horaHaMin(30) }, { numero: "101", hora: horaHaMin(0.2) }]
    });
    const srv = await iniciarServidor(dir);
    const cacheHoras = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, "hora-fixada-cache.json"), "utf8")); } catch (_) { return {}; } };
    const k = n => hojeISO() + "|" + n;
    const hhmm = v => !!v && /^\d{2}:\d{2}$/.test(v.hora);
    try {
        // Linha de base (1ª geração após ligar): o que já existe só é registrado.
        for (let t = 0; t < 100 && !cacheHoras()[k("101")]; t++) await esperar(100);
        let c = cacheHoras();
        assert.strictEqual(c[k("100")] && c[k("100")].hora, "OK", "venda de 30 min atrás que já existia ao ligar NÃO pode ser corrigida");
        assert.strictEqual(c[k("101")] && c[k("101")].hora, "OK");

        const st = JSON.parse(fs.readFileSync(path.join(dir, "estado.json"), "utf8"));
        st.nfce.find(r => r.numero === "101").hora = horaHaMin(20);          // já vista → nunca corrigir
        st.nfce.push({ numero: "102", hora: horaHaMin(10) });                  // nova e velha → corrigir na tela
        st.nfce.push({ numero: "103", hora: horaHaMin(0.1) });                 // nova e recente → aceitar
        if (comGerenciais) {
            st.nfce.push({ numero: "700", hora: horaHaMin(150), modelo: 99 }); // gerencial 2h30 → corrigir (janela 3 h)
            st.nfce.push({ numero: "701", hora: horaHaMin(200), modelo: 99 }); // gerencial 3h20 → fora da janela
        }
        gravarEstado(dir, st);
        for (let t = 0; t < 100 && !cacheHoras()[k("102")]; t++) await esperar(100);
        await esperar(500);

        c = cacheHoras();
        assert.ok(hhmm(c[k("102")]), "102 (nova, 10 min atrás) deveria ter a hora fixada na tela");
        if (comGerenciais) assert.ok(hhmm(c[k("700")]), "gerencial 700 (2h30 atrás) deveria ter a hora fixada na tela");
        assert.strictEqual(c[k("101")].hora, "OK", "101 já tinha sido vista — não muda");
        assert.strictEqual(c[k("103")] && c[k("103")].hora, "OK", "103 é recente — aceita como está");
        if (comGerenciais) assert.strictEqual(c[k("701")], undefined, "701 está fora da janela — ignorada");

        const log = fs.readFileSync(path.join(dir, "relatorio.log"), "utf8");
        assert.match(log, /Hora corrigida na tela \(banco não alterado\)/);
        assert.match(log, /Índices: NFCE\.DATA, PAGAMENT\.DATA — ok/, "deveria conferir os índices no catálogo");
        // Log categorizado (v2.15.4): toda linha leva [CATEGORIA] após o horário.
        const semCategoria = log.split("\n").filter(l => l.trim() && !/^\[\d\d-\d\d-\d{4}\] \[\d\d:\d\d:\d\d\] \[[A-Z]+\] /.test(l));
        assert.deepStrictEqual(semCategoria, [], "linhas sem categoria no relatorio.log");
        assert.match(log, /\] \[SERVIDOR\] === Servidor iniciado/);
        assert.match(log, /\] \[BANCO\] Índices: /);
        assert.match(log, /\] \[FASTPOLL\] FastPoll: modo completo/);
        assert.match(log, /\] \[VENDAS\] Hora corrigida na tela/);
        assert.match(log, /FastPoll: modo completo em consulta única \(NFCE, PAGAMENT\) — todas as tabelas com índice/, "todas com índice: consulta única");
        assert.match(log, /FastPoll: consulta única \(NFCE, PAGAMENT\) ~\d+ ms → a cada ~\d+ ms/, "deveria registrar o tempo medido da consulta");
        const sql = lerSqlLog(dir);
        assert.ok(!/UPDATE/.test(sql), "nenhum UPDATE pode chegar ao banco:\n" + sql);
        assert.ok(!/TX_ESCRITA/.test(sql), "toda transação deve ser SOMENTE LEITURA:\n" + sql.split("\n").filter(l => /TX_ESCRITA/.test(l)).slice(0, 5).join("\n"));
    } finally { srv.parar(); }
});

test("somente leitura: servidor e gerador bloqueiam qualquer comando de escrita e usam transação read-only", async () => {
    const extrair = (arq, recuo) => {
        const src = fs.readFileSync(path.join(RAIZ_PROJETO, arq), "utf8");
        const i = src.indexOf("var _somenteLeitura = function"), j = src.indexOf("// =====", i + 50);
        assert.ok(i > 0 && j > i, "_somenteLeitura ausente em " + arq);
        return { txt: recuo ? src.slice(i, j).replace(/^ {4}/gm, "") : src.slice(i, j), fn: new Function("require", src.slice(i, j) + "; return _somenteLeitura;") };
    };
    const srv = extrair("servidor-relatorio.js", false), ger = extrair("gerar-relatorio-html.js", true);
    assert.strictEqual(srv.txt.trim(), ger.txt.trim(), "o bloco _somenteLeitura deve ser idêntico nos dois arquivos");
    for (const { fn } of [srv, ger]) {
        const txs = [], enviados = [];
        const tx = { query(sql, p, cb) { enviados.push(sql); cb(null, []); }, execute(sql, p, cb) { enviados.push(sql); cb(null, []); }, rollback(c) { if (c) c(); }, commit(c) { if (c) c(); } };
        const FB = { ISOLATION_READ_COMMITTED: [15, 18], attach(o, cb) { cb(null, { connection: { startTransaction(op, cb2) { txs.push(op); cb2(null, Object.assign({}, tx)); } }, query() { throw new Error("db.query original não pode ser usado"); } }); } };
        const req = m => m === "node-firebird/package.json" ? { version: "1.1.10" } : require(m);
        const RO = fn(req)(FB);
        const db = await new Promise(r => RO.attach({}, (e, d) => r(d)));
        const roda = sql => new Promise(r => db.query(sql, [], e => r(e)));
        for (const sql of ["UPDATE nfce SET hora='x'", "insert into t values (1)", "  DELETE FROM nfce", "/* x */ EXECUTE BLOCK AS BEGIN END",
                           "ALTER TABLE nfce ADD x INT", "MERGE INTO t USING s ON 1=1", "", "-- comentario\nUPDATE t SET a=1"]) {
            const e = await roda(sql);
            assert.ok(e && /somente leitura/.test(e.message), "deveria bloquear: " + JSON.stringify(sql));
        }
        for (const sql of ["SELECT 1 FROM RDB$DATABASE", "  select * from nfce", "WITH x AS (SELECT 1 FROM RDB$DATABASE) SELECT * FROM x", "/* c */ SELECT 1 FROM RDB$DATABASE"]) {
            assert.strictEqual(await roda(sql), null, "deveria permitir: " + sql);
        }
        assert.ok(!enviados.some(s => /update|insert|delete|alter|merge|execute/i.test(s)), "comando de escrita chegou ao driver: " + enviados.join(" | "));
        assert.ok(txs.length > 0 && txs.every(o => o && o.readOnly === true && o.wait === false), "toda transação deve ser readOnly e sem espera: " + JSON.stringify(txs));
        // rec_version (17), nunca no_rec_version (18): com 18 a leitura dá conflito ou trava
        // esperando o caixa terminar uma gravação.
        assert.ok(txs.every(o => JSON.stringify(o.isolation) === "[15,17]"), "isolamento deve ser read_committed + rec_version: " + JSON.stringify(txs[0]));
        // Transação explícita (como o gerador usa) também é forçada a somente leitura.
        await new Promise(r => db.transaction({ readOnly: false }, (e, t) => t.query("UPDATE x SET y=1", [], e2 => { assert.ok(e2); r(); })));
        assert.ok(txs.every(o => o.readOnly === true));
    }
});


test("servidor: validações das rotas HTTP", { timeout: 60000 }, async () => {
    const dir = montarPasta();
    const srv = await iniciarServidor(dir);
    try {
        const post = (rota, corpo) => fetch(srv.base + rota, { method: "POST", headers: { "Content-Type": "application/json" }, body: corpo });

        assert.strictEqual((await post("/api/config", "null")).status, 400);

        const rCfg = await post("/api/config", JSON.stringify({ proibidos: [1, {}, null, " ok ", "ok"], teclasPersonalizadas: [{ tecla: "F3", acao: "limpar" }, { tecla: "", comando: "x" }, 5] }));
        assert.strictEqual(rCfg.status, 200);
        const cfg = await (await fetch(srv.base + "/api/config")).json();
        assert.deepStrictEqual(cfg.proibidos, ["ok"]);
        assert.deepStrictEqual(cfg.teclasPersonalizadas, [{ tecla: "F3", comando: "", acao: "limpar" }]);

        await post("/api/log-error", JSON.stringify({ msg: "x\n[01-01-2026] [10:00:00] FORJADO", stack: "a\nb" }));
        await esperar(600);
        const log = fs.readFileSync(path.join(dir, "relatorio.log"), "utf8");
        assert.ok(!/\n\[01-01-2026\] \[10:00:00\] FORJADO/.test(log), "linha forjada entrou no log");

        const rPer = await fetch(srv.base + "/periodo?i=2026-02-30&f=2026-03-01", { redirect: "manual" });
        assert.strictEqual(rPer.status, 302);
        assert.strictEqual((await fetch(srv.base + "/api/navigate/periodo/2026-02-30/2026-03-01")).status, 400);
        assert.strictEqual((await fetch(srv.base + "/api/navigate/hash/periodo")).status, 200);
        assert.strictEqual((await fetch(srv.base + "/api/navigate/foco")).status, 200);

        // Janela de correção de horário: padrão 180, limites 5–720, alterável pela API.
        assert.strictEqual(cfg.janelaCorrecaoHoraMin, 180);
        assert.strictEqual((await post("/api/config", JSON.stringify({ janelaCorrecaoHoraMin: 1000 }))).status, 400);
        assert.strictEqual((await post("/api/config", JSON.stringify({ janelaCorrecaoHoraMin: 240 }))).status, 200);
        assert.strictEqual((await (await fetch(srv.base + "/api/config")).json()).janelaCorrecaoHoraMin, 240);
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8")).janelaCorrecaoHoraMin, 240);
    } finally { srv.parar(); }
});

test("servidor: controle remoto — temas, tema e aviso nas abas, info, log e programas", { timeout: 60000 }, async () => {
    const marca = path.join(os.tmpdir(), "prog-aberto-" + process.pid + "-" + Date.now() + ".txt");
    const dir = montarPasta({ programas: [
        { nome: "Teste Node", caminho: process.execPath, args: ["-e", "require('fs').writeFileSync(" + JSON.stringify(marca) + ",'ok')"] },
        { nome: "Inexistente", caminho: "/caminho/que/nao/existe.exe" }
    ] });
    const srv = await iniciarServidor(dir);
    const ctrl = new AbortController();
    try {
        const post = (rota, corpo) => fetch(srv.base + rota, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
        // Temas vêm do próprio gerador (fonte única).
        const t = await (await fetch(srv.base + "/api/temas")).json();
        assert.ok(t.temas.some(x => x.id === "hud") && t.temas.some(x => x.id === "light"), "lista de temas lida do gerador");
        assert.strictEqual((await fetch(srv.base + "/api/navigate/tema/nao-existe")).status, 400);

        // Uma "aba" conectada por SSE recebe o tema e o aviso.
        const sse = await fetch(srv.base + "/api/events", { signal: ctrl.signal });
        const leitor = sse.body.getReader();
        let recebido = "";
        const ler = (async () => { try { for (;;) { const { value, done } = await leitor.read(); if (done) break; recebido += Buffer.from(value).toString("utf8"); } } catch (_) {} })();
        await esperar(300);
        const rt = await (await fetch(srv.base + "/api/navigate/tema/hud")).json();
        assert.strictEqual(rt.ok, true); assert.ok(rt.clients >= 1);
        assert.strictEqual((await post("/api/navigate/aviso", { msg: "" })).status, 400);
        const ra = await (await post("/api/navigate/aviso", { msg: "Fechamento às 18h\n", segundos: 5 })).json();
        assert.strictEqual(ra.ok, true);
        for (let i = 0; i < 20 && !/"type":"aviso"/.test(recebido); i++) await esperar(100);
        assert.match(recebido, /"type":"tema","id":"hud"/);
        assert.match(recebido, /"type":"aviso","msg":"Fechamento às 18h","segundos":5/);

        const info = await (await fetch(srv.base + "/api/info")).json();
        assert.ok(info.ok && /^v\d+\.\d+\.\d+$/.test(info.servidor) && info.gerador && info.node);

        await esperar(300);
        const lg = await (await fetch(srv.base + "/api/log?linhas=5&filtro=aviso")).json();
        assert.ok(lg.ok && lg.linhas.length >= 1 && lg.linhas.every(l => /aviso/i.test(l)));

        // Programas: só os do config.json local (+ 2 fixos); pela rede, só pelo nome.
        const pr = await (await fetch(srv.base + "/api/programas")).json();
        const nomes = pr.programas.map(p => p.nome);
        assert.ok(nomes.includes("Pasta do sistema") && nomes.includes("Log do servidor") && nomes.includes("Teste Node"));
        assert.strictEqual(pr.programas.find(p => p.nome === "Inexistente").existe, false);
        assert.strictEqual((await post("/api/programas/abrir", { nome: "Inexistente" })).status, 404);
        assert.strictEqual((await post("/api/programas/abrir", { nome: "calc" })).status, 404);
        const ab = await post("/api/programas/abrir", { nome: "teste node" });
        assert.strictEqual(ab.status, 200);
        for (let i = 0; i < 30 && !fs.existsSync(marca); i++) await esperar(100);
        assert.ok(fs.existsSync(marca), "o programa da lista foi aberto");
        // A lista não pode ser alterada pela rede (o /api/config ignora "programas").
        await post("/api/config", { programas: [{ nome: "X", caminho: "/bin/sh" }] });
        const cfgDisco = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
        assert.ok(!cfgDisco.programas.some(p => p.nome === "X"), "/api/config não pode cadastrar programas");
        ctrl.abort(); await ler;
    } finally { try { ctrl.abort(); } catch (_) {} try { fs.unlinkSync(marca); } catch (_) {} srv.parar(); }
});

test("servidor: preferências por aparelho — uma não afeta a outra; só o computador do servidor muda para todos", async () => {
    const dir = montarPasta({ toastDuration: 5000, proibidos: [] }, { nfce: [{ numero: "500", hora: horaHaMin(5) }] });
    const json = r => r.json();
    const cfgDisco = () => JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
    const prefsDisco = () => JSON.parse(fs.readFileSync(path.join(dir, "preferencias-aparelhos.json"), "utf8")).aparelhos;
    // 1ª parte: localhost tratado como aparelho da rede (RELATORIO_DISP_LOCAL=1).
    let srv = await iniciarServidor(dir, { RELATORIO_DISP_LOCAL: "1" });
    let A, B;
    try {
        const cookieDe = async () => {
            const r = await fetch(srv.base + "/api/db-status");
            const m = String(r.headers.get("set-cookie") || "").match(/fdb_ap=([a-f0-9]{32})/);
            assert.ok(m, "aparelho novo deveria ganhar o cookie fdb_ap");
            return "fdb_ap=" + m[1];
        };
        A = await cookieDe(); B = await cookieDe();
        assert.notStrictEqual(A, B, "cada aparelho tem o seu identificador");
        const com = (c, extra) => Object.assign({ headers: Object.assign({ Cookie: c, "Content-Type": "application/json" }, (extra && extra.headers) || {}) }, extra || {}, { headers: Object.assign({ Cookie: c, "Content-Type": "application/json" }, (extra && extra.headers) || {}) });
        const r1 = await fetch(srv.base + "/api/config", com(A, { method: "POST", body: JSON.stringify({ toastDuration: 9000, proibidos: ["RACAO"], appName: "Invasor", pollInterval: 900 }) })).then(json);
        assert.strictEqual(r1.ok, true); assert.strictEqual(r1.escopo, "aparelho");
        assert.ok(r1.ignorados.includes("appName") && r1.ignorados.includes("pollInterval"), "configurações do sistema ignoradas para aparelho");
        const cA = await fetch(srv.base + "/api/config", com(A)).then(json);
        assert.strictEqual(cA.servidor, false); assert.strictEqual(cA.toastDuration, 9000); assert.deepStrictEqual(cA.proibidos, ["RACAO"]);
        assert.strictEqual(cA.appName, "Teste", "nome do sistema não muda por aparelho");
        const cB = await fetch(srv.base + "/api/config", com(B)).then(json);
        assert.strictEqual(cB.toastDuration, 5000, "o outro aparelho continua no padrão"); assert.deepStrictEqual(cB.proibidos, []);
        assert.strictEqual(cfgDisco().appName, "Teste"); assert.deepStrictEqual(cfgDisco().proibidos, [], "config.json não muda por aparelho");
        assert.strictEqual(cfgDisco().pollInterval, 200);
        // proibidos pelo editor da página (POST /api/proibidos) também só dele
        assert.strictEqual((await fetch(srv.base + "/api/proibidos", com(B, { method: "POST", body: JSON.stringify(["GRANEL"]) })).then(json)).escopo, "aparelho");
        assert.deepStrictEqual((await fetch(srv.base + "/api/proibidos", com(A)).then(json)).proibidos, ["RACAO"]);
        const pB = await fetch(srv.base + "/api/proibidos", com(B)).then(json);
        assert.deepStrictEqual(pB.proibidos, ["GRANEL"]); assert.strictEqual(pB.efetivo, true);
        assert.deepStrictEqual(cfgDisco().proibidos, []);
        assert.deepStrictEqual((await fetch(srv.base + "/api/proibidos-servidor", com(A)).then(json)).proibidos, [], "lista padrão do servidor (para importar)");
        // banco e ícone: só no computador do servidor
        assert.strictEqual((await fetch(srv.base + "/api/salvar-fdb", com(A, { method: "POST", body: JSON.stringify({ caminho: "C:\\x.fdb" }) }))).status, 403);
        assert.strictEqual((await fetch(srv.base + "/api/upload-favicon", com(A, { method: "POST", body: "x" }))).status, 403);
        // a página do aparelho já vem com as preferências dele
        let html = "";
        for (let i = 0; i < 60 && !html.includes("window.__APARELHO__="); i++) { html = await fetch(srv.base + "/", com(A)).then(r => r.text()); if (!html.includes("window.__APARELHO__=")) await esperar(250); }
        assert.match(html, /window\.__APARELHO__=\{"servidor":false,"prefs":\{"toastDuration":9000,"proibidos":\["RACAO"\]/);
        // apelido do aparelho: só dele, limpo de caracteres perigosos, sem virar "preferência própria"
        const rAp = await fetch(srv.base + "/api/config", com(A, { method: "POST", body: JSON.stringify({ apelido: '  Celular do <b>Caixa 1</b>  ' }) })).then(json);
        assert.strictEqual(rAp.ok, true); assert.deepStrictEqual(rAp.alterados, ["apelido"]);
        assert.strictEqual((await fetch(srv.base + "/api/config", com(A)).then(json)).aparelho.apelido, "Celular do b Caixa 1 /b");
        assert.strictEqual((await fetch(srv.base + "/api/config", com(B)).then(json)).aparelho.apelido, "", "o outro aparelho não ganha o apelido");
        assert.strictEqual((await fetch(srv.base + "/api/config", com(A, { method: "POST", body: JSON.stringify({ apelido: "Celular do Caixa 1" }) })).then(json)).ok, true);
        const pf = await fetch(srv.base + "/api/preferencias", com(B)).then(json);
        assert.deepStrictEqual(pf.prefs.proibidos, ["GRANEL"]); assert.strictEqual(pf.personalizado.toastDuration, false);
    } finally { srv.parar(); }
    await esperar(300);
    // 2ª parte: o computador do servidor (localhost) edita um aparelho e muda para todos.
    srv = await iniciarServidor(dir);
    try {
        const idA = A.split("=")[1], idB = B.split("=")[1];
        const post = (rota, corpo) => fetch(srv.base + rota, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }).then(json);
        const c = await fetch(srv.base + "/api/config").then(json);
        assert.strictEqual(c.servidor, true); assert.strictEqual(c.escopo, "servidor"); assert.strictEqual(c.toastDuration, 5000);
        const e = await post("/api/config?aparelho=" + idA, { toastDuration: 7000 });
        assert.strictEqual(e.ok, true); assert.strictEqual(e.escopo, "aparelho");
        assert.strictEqual(prefsDisco()[idA].prefs.toastDuration, 7000); assert.deepStrictEqual(prefsDisco()[idA].prefs.proibidos, ["RACAO"]);
        const vA = await fetch(srv.base + "/api/config?aparelho=" + idA).then(json);
        assert.strictEqual(vA.escopo, "aparelho-editado"); assert.strictEqual(vA.toastDuration, 7000); assert.strictEqual(vA.personalizado.proibidos, true);
        assert.strictEqual((await fetch(srv.base + "/api/config?aparelho=..%2Fx")).status, 400, "chave de aparelho inválida");
        assert.strictEqual(vA.aparelho.apelido, "Celular do Caixa 1", "o computador do servidor vê o apelido");
        assert.strictEqual((await post("/api/config?aparelho=" + idA, { restaurar: true })).ok, true);
        assert.deepStrictEqual(prefsDisco()[idA].prefs, {}, "restaurar apaga as preferências do aparelho");
        assert.strictEqual(prefsDisco()[idA].apelido, "Celular do Caixa 1", "restaurar mantém o apelido");
        assert.strictEqual((await post("/api/config?aparelho=" + idA, { apelido: "" })).ok, true);
        assert.strictEqual(prefsDisco()[idA], undefined, "sem apelido e sem preferências, o aparelho sai do arquivo");
        // padrão novo aplicado a todos: B perde a lista própria
        assert.strictEqual((await post("/api/config", { toastDuration: 6000, proibidos: ["PADRAO"], aplicarTodos: true })).ok, true);
        assert.strictEqual(cfgDisco().toastDuration, 6000); assert.deepStrictEqual(cfgDisco().proibidos, ["PADRAO"]);
        const vB = await fetch(srv.base + "/api/config?aparelho=" + idB).then(json);
        assert.strictEqual(vB.toastDuration, 6000); assert.deepStrictEqual(vB.proibidos, ["PADRAO"]);
        assert.deepStrictEqual((await fetch(srv.base + "/api/proibidos-servidor").then(json)).proibidos, ["PADRAO"]); assert.strictEqual(vB.personalizado.proibidos, false);
    } finally { srv.parar(); }
});

test("servidor: acesso de fora — túnel/proxy nunca vale como o computador do servidor; /api/qr traz o endereço externo", async () => {
    const dir = montarPasta({}, { nfce: [{ numero: "600", hora: horaHaMin(5) }] });
    const srv = await iniciarServidor(dir);
    try {
        const local = await fetch(srv.base + "/api/config").then(r => r.json());
        assert.strictEqual(local.servidor, true, "localhost sem proxy = computador do servidor");
        for (const h of [{ "X-Forwarded-For": "203.0.113.9" }, { "CF-Connecting-IP": "203.0.113.9" }, { "Forwarded": "for=203.0.113.9" }, { "X-Real-IP": "203.0.113.9" }]) {
            const c = await fetch(srv.base + "/api/config", { headers: h }).then(r => r.json());
            assert.strictEqual(c.servidor, false, "via proxy (" + Object.keys(h)[0] + ") não é o computador do servidor");
            assert.strictEqual((await fetch(srv.base + "/api/dispositivos", { headers: h })).status, 403, "via proxy não é rede local");
            const sv = await fetch(srv.base + "/api/salvar-fdb", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, h), body: JSON.stringify({ caminho: "C:\\x.fdb" }) });
            assert.strictEqual(sv.status, 403, "via proxy não troca o banco");
        }
        const q = await fetch(srv.base + "/api/qr").then(r => r.json());
        assert.ok(q.ok && /^http:\/\//.test(q.url) && "externo" in q, "/api/qr traz url e externo (Tailscale ou null)");
        const pg = await fetch(srv.base + "/qr").then(r => r.text());
        assert.match(pg, /Fora da loja/);
    } finally { srv.parar(); }
});

test("servidor: dispositivos conectados — log com tipo, IP e nome, rotas, telas e /api/dispositivos", { timeout: 60000 }, async () => {
    const dir = montarPasta();
    // RELATORIO_DISP_LOCAL=1: trata 127.0.0.1 como um aparelho da rede (só para o teste).
    const srv = await iniciarServidor(dir, { RELATORIO_DISP_LOCAL: "1" });
    const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    const h = { "User-Agent": UA };
    const ctrl = new AbortController();
    try {
        assert.strictEqual((await fetch(srv.base + "/api/temas", { headers: h })).status, 200);
        for (let i = 0; i < 3; i++) await fetch(srv.base + "/api/status", { headers: h });
        const sse = await fetch(srv.base + "/api/events", { headers: h, signal: ctrl.signal });
        const leitor = sse.body.getReader(); const ler = (async () => { try { for (;;) { const { done } = await leitor.read(); if (done) break; } } catch (_) {} })();
        await esperar(2200);   // nome do aparelho: até ~1,6 s procurando
        const lst = await (await fetch(srv.base + "/api/dispositivos", { headers: h })).json();
        assert.strictEqual(lst.ok, true);
        const d = lst.dispositivos.find(x => x.ip === "127.0.0.1");
        assert.ok(d, "o aparelho aparece em /api/dispositivos");
        assert.strictEqual(d.tipo, "Celular"); assert.strictEqual(d.modelo, "iPhone");
        assert.strictEqual(d.sistema, "iOS 17.5"); assert.strictEqual(d.navegador, "Safari 17.5");
        assert.strictEqual(d.telasAbertas, 1);
        assert.strictEqual(d.rotas["/api/temas"], 1, "rota contada");
        assert.ok(!("/api/status" in d.rotas), "batimento não entra nas rotas (vai para o resumo)");
        // Recarregamento da tela (fecha e reabre em < 8 s) não gera "fechada"/"aberta":
        // uma 2ª tela abre e fecha logo; depois a 1ª fecha de verdade (a linha sai após 8 s).
        const abrirTela = async (c) => { const r = await fetch(srv.base + "/api/events", { headers: h, signal: c.signal }); r.body.getReader().read().catch(() => {}); };
        const ctrl2 = new AbortController(), ctrl3 = new AbortController();
        await abrirTela(ctrl2); await esperar(300);             // 2ª tela: "aberta" (agora: 2)
        ctrl2.abort(); await esperar(300);                      // fecha…
        await abrirTela(ctrl3); await esperar(300);             // …e reabre logo: recarregamento
        ctrl.abort(); ctrl3.abort(); await ler; await esperar(9000);
        const log = fs.readFileSync(path.join(dir, "relatorio.log"), "utf8");
        assert.strictEqual((log.match(/Tela aberta \(tempo real\)/g) || []).length, 2, "a reabertura rápida conta como recarregamento");
        assert.match(log, /\[CONEXAO\] Novo dispositivo conectado: Celular iPhone \(iOS 17\.5, Safari 17\.5\) \| IP 127\.0\.0\.1 \| nome: /);
        assert.match(log, /\[API\] API: GET \/api\/temas ← (?:[^\s←—][^←—]* \()?127\.0\.0\.1\)? → 200 \(\d+ ms\)/);
        assert.match(log, /\[CONEXAO\] Tela aberta \(tempo real\) em (?:[^\s←—][^←—]* \()?127\.0\.0\.1\)? — telas abertas agora: 1/);
        assert.match(log, /\[CONEXAO\] Tela fechada em (?:[^\s←—][^←—]* \()?127\.0\.0\.1\)? — telas abertas agora: 0/);
        assert.ok(log.indexOf("Novo dispositivo conectado") < log.indexOf("API: GET /api/temas"), "a linha do aparelho vem antes das rotas dele");
        assert.ok(!/API: GET \/api\/status/.test(log), "batimento não gera uma linha por chamada");
    } finally { try { ctrl.abort(); } catch (_) {} srv.parar(); }
});

test("servidor: encerramento ordenado registra no log, avisa as abas e sai com código 0", { timeout: 60000 }, async () => {
    const dir = montarPasta();
    const srv = await iniciarServidor(dir);
    let codigo = null;
    const saiu = new Promise(r => srv.proc.once("exit", c => { codigo = c; r(); }));
    try {
        // Conecta no fluxo SSE para receber o aviso de encerramento.
        const controle = new AbortController();
        const sse = await fetch(srv.base + "/api/events", { signal: controle.signal });
        const leitor = sse.body.getReader();
        let recebido = "";
        const lendo = (async () => { try { for (;;) { const { value, done } = await leitor.read(); if (done) break; recebido += Buffer.from(value).toString("utf8"); } } catch (_) {} })();

        // Antes de encerrar (v2.15.5): pollStatus rodando sem nenhuma venda nova;
        // erro da tela com várias linhas; pollInterval/maxLogLines fora da faixa.
        await esperar(4000);
        await fetch(srv.base + "/api/log-error", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ msg: "erro de teste", stack: "linha A\nlinha B\nlinha C" }) });
        const rc = await fetch(srv.base + "/api/config", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pollInterval: 500000000, maxLogLines: 999999999 }) });
        assert.ok(rc.status < 500, "config fora da faixa não pode derrubar a rota");
        const cfgEf = await (await fetch(srv.base + "/api/config")).json();
        assert.ok(cfgEf.pollInterval >= 100 && cfgEf.pollInterval <= 60000, "pollInterval efetivo fora da faixa: " + cfgEf.pollInterval);
        assert.ok(cfgEf.maxLogLines >= 100 && cfgEf.maxLogLines <= 100000, "maxLogLines efetivo fora da faixa: " + cfgEf.maxLogLines);

        const r = await fetch(srv.base + "/api/encerrar?origem=teste-automatico");
        assert.strictEqual(r.status, 200);
        await Promise.race([saiu, esperar(8000)]);
        controle.abort(); await lendo;

        assert.strictEqual(codigo, 0, "o servidor deveria sair com código 0");
        assert.match(recebido, /"type":"encerrando"/, "as abas deveriam receber o aviso de encerramento");
        const log = fs.readFileSync(path.join(dir, "relatorio.log"), "utf8");
        assert.match(log, /=== Servidor encerrado: encerramento solicitado por teste-automatico ===/);
        assert.ok(!/Dados alterados/.test(log), "sem venda nova, a verificação de reserva não pode acusar mudança (vendas+pagamentos × vendas):\n" + log);
        const semCat = log.split("\n").filter(l => l.trim() && !/^\[\d\d-\d\d-\d{4}\] \[\d\d:\d\d:\d\d\] \[[A-Z]+\] /.test(l));
        assert.deepStrictEqual(semCat, [], "toda linha física (inclusive stack de várias linhas) leva data, hora e categoria");
        assert.match(log, /\[NAVEGADOR\]     \| linha B/, "linhas de continuação do stack");
    } finally { srv.parar(); }
});

// ---------------------------------------------------------------------------
test("gerador: proibidos colados em outro formato viram um termo por linha", () => {
    const html = gerar(montarPasta());
    // Executa a funcao do proprio HTML gerado, com as dependencias minimas dela.
    const ini = html.indexOf("const PROIB_MAX="), fim = html.indexOf("// Liga contador");
    assert.ok(ini > 0 && fim > ini, "formatarProibidos nao encontrada no HTML");
    const deps = 'const rmAcento=v=>String(v||"").normalize("NFD").replace(/[\\u0300-\\u036f]/g,"");' +
        'const normP=v=>rmAcento(v).trim().toUpperCase().replace(/\\s+/g," ");' +
        'const _isValorProib=v=>{const s=String(v||"").trim();return /^(>=|<=|>|<)[0-9]/.test(s)||/^\\d[\\d.,]*$/.test(s);};';
    const formatar = new Function(deps + html.slice(ini, fim) + "return formatarProibidos;")();
    const casos = [
        ["SUCO\nCHA", ["SUCO", "CHA"], false],
        ["SUCO, CHA;CAFE\tLEITE | MEL", ["SUCO", "CHA", "CAFE", "LEITE", "MEL"], true],
        ['["SUCO","suco","CHA"]', ["SUCO", "CHA"], true],
        ['- "CHA"\n1. CHÁ\n2) AGUA   1,5L', ["CHA", "AGUA 1,5L"], true],
        [">100=6578,96\n6578,96", [">100=6578,96", "6578,96"], false],
        ["", [], false]
    ];
    for (const [entrada, lista, alterado] of casos) {
        const r = formatar(entrada);
        assert.deepStrictEqual(r.lista, lista, "lista de " + JSON.stringify(entrada));
        assert.strictEqual(r.alterado, alterado, "alterado de " + JSON.stringify(entrada));
        assert.strictEqual(r.texto, lista.join("\n"));
    }
    const grande = formatar(Array.from({ length: 510 }, (_, i) => "T" + i).join(","));
    assert.strictEqual(grande.excedente, 10, "acima de 500 termos deveria sinalizar o excedente");
});

// ---------------------------------------------------------------------------
test("gerador: venda com desconto ganha o chip vermelho com o percentual", () => {
    const dir = montarPasta({}, {
        nfce: [{ numero: "101", hora: "10:00:00" }, { numero: "102", hora: "10:05:00" }],
        alt: [
            { pedido: "101", desc: "REFRIGERANTE", qtd: 2, total: 20 }, { pedido: "101", desc: "PAO", qtd: 5, total: 5 },
            { pedido: "101", desc: "LEITE", qtd: 1, total: 6 }, { pedido: "101", desc: "CAFE", qtd: 1, total: 19 },
            { pedido: "101", desc: "DESCONTO", qtd: 1, total: -5 },
            { pedido: "102", desc: "AGUA", qtd: 1, total: 3 }
        ]
    });
    const html = gerar(dir);
    const ini = html.indexOf("const _fmtPctDesc="), fim = html.indexOf("const itensTdHTML=");
    assert.ok(ini > 0 && fim > ini, "descontoVenda nao encontrada no HTML");
    const deps = 'const fmt=v=>"R$ "+Number(v).toFixed(2).replace(".",",");' +
        'const normP=v=>String(v||"").normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").trim().toUpperCase();';
    const descontoVenda = new Function(deps + html.slice(ini, fim) + "return descontoVenda;")();
    const dados = JSON.parse(html.match(/<script id="dados" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    const v101 = dados.vendas.find(v => /101$/.test(v.numero)), v102 = dados.vendas.find(v => /102$/.test(v.numero));
    const d = descontoVenda(v101);
    assert.ok(d, "venda 101 deveria ter desconto");
    assert.strictEqual(d.rotulo, "Desconto de 10% (\u2212R$ 5,00)", "5 de 50 = 10%");
    assert.match(d.tip, /Desconto de 10% \(\u2212R\$ 5,00\)/);
    assert.match(d.tip, /Total com desconto: R\$ 45,00/);
    assert.strictEqual(descontoVenda(v102), null, "venda sem desconto nao ganha chip");
    assert.strictEqual(descontoVenda({ itensDetalhe: [{ desc: "X", total: 200 }, { desc: "DESCONTO", total: -1 }] }).rotulo, "Desconto de 0,5% (\u2212R$ 1,00)");
    assert.ok(html.includes('class="tdItemChip tdItemDesc"'), "chip com a classe tdItemDesc ausente no HTML");
});

// ---------------------------------------------------------------------------
test("servidor: fast-poll completo detecta mudanças que não alteram quantidade nem total geral", { timeout: 90000 }, async () => {
    // Como na loja real: índice só em NFCE.DATA → NFCE na parte rápida,
    // PAGAMENT na complementar.
    const dir = montarPasta({}, {
        indices: ["NFCE.DATA"],
        nfce: [{ numero: "101", hora: horaHaMin(0.1), vendedor: "VENDEDOR D", modelo: 65 }],
        pag:  [{ numero: "101", hora: horaHaMin(0.1) }]
    });
    const srv = await iniciarServidor(dir);
    const log = () => { try { return fs.readFileSync(path.join(dir, "relatorio.log"), "utf8"); } catch (_) { return ""; } };
    const geracoes = () => lerSqlLog(dir).split("\n").filter(l => l === "GERACAO").length;
    const alterar = fn => { const st = JSON.parse(fs.readFileSync(path.join(dir, "estado.json"), "utf8")); fn(st); gravarEstado(dir, st); };
    // Espera pela condição (até 10 s) em vez de um tempo fixo: com a máquina
    // ocupada a geração pode demorar mais, e o teste não deve depender disso.
    const etapa = async (fn, padrao, msg) => {
        const g0 = geracoes();
        alterar(fn);
        for (let t = 0; t < 100 && !(padrao.test(log()) && geracoes() > g0); t++) await esperar(100);
        assert.match(log(), padrao, msg + "\n" + log().split("\n").filter(l => /FastPoll/.test(l)).join("\n"));
        assert.ok(geracoes() > g0, msg + ": deveria regerar o relatório");
    };
    try {
        await esperar(7000);
        assert.match(log(), /FastPoll: modo completo/, "deveria entrar no modo completo");
        // /api/status: contagem por tipo preenchida pelo fast-poll (antes ficava -1
        // até a 1ª conferência do pollStatus).
        const st0 = await (await fetch(srv.base + "/api/status")).json();
        assert.deepStrictEqual({ g: st0.g, nfc: st0.nfc, nf: st0.nf },
            { g: { qt: 0, tot: 0 }, nfc: { qt: 1, tot: 10 }, nf: { qt: 0, tot: 0 } }, "contagem por tipo no /api/status");
        assert.match(log(), /AVISO índices: sem índice em PAGAMENT\.DATA —/, "deveria avisar só o que falta");
        assert.match(log(), /duas partes pelos índices — rápida: NFCE \(com índice\) \| complementar: PAGAMENT \(sem índice/, "deveria dividir pelos índices");
        assert.match(log(), /FastPoll: consulta rápida \(NFCE, com índice\) ~\d+ ms → a cada ~\d+ ms \| complementar \(PAGAMENT, sem índice\) ~\d+ ms/, "deveria medir as duas partes separadamente");
        await etapa(st => { st.nfce[0].vendedor = "BIA"; },
            /FastPoll: NFC-e: venda alterada/, "troca de vendedor (mesma quantidade e total)");
        await etapa(st => { st.nfce[0].modelo = 99; },
            /Gerencial: vendas 0 → 1 \(↑ \+1\).*NFC-e: vendas 1 → 0 \(↓ -1\)/, "venda mudou de NFC-e para gerencial (mesmo valor)");
        await etapa(st => { st.pag[0].forma = "05 PIX"; },
            /Pagamentos: forma ou valor alterado/, "troca de forma de pagamento");
        await etapa(st => { st.nfce[0].total = 15; },
            /Gerencial: total R\$ 10,00 → R\$ 15,00 \(↑ \+R\$ 5,00\)/, "aumento de valor");
        await etapa(st => { st.nfce[0].total = 12; },
            /Gerencial: total R\$ 15,00 → R\$ 12,00 \(↓ −R\$ 3,00\)/, "redução de valor");
    } finally { srv.parar(); }
});

test("servidor: venda e pagamento gravados em momentos diferentes geram UM refresh só", { timeout: 60000 }, async () => {
    // Como no caixa real: a venda (NFCE) é gravada e o pagamento (PAGAMENT) vem
    // numa transação separada um pouco depois. Antes: dois "→ regerando".
    const dir = montarPasta({}, {
        indices: ["NFCE.DATA"],
        nfce: [{ numero: "101", hora: horaHaMin(0.1) }],
        pag:  [{ numero: "101", hora: horaHaMin(0.1) }]
    });
    const srv = await iniciarServidor(dir);
    const log = () => { try { return fs.readFileSync(path.join(dir, "relatorio.log"), "utf8"); } catch (_) { return ""; } };
    const geracoes = () => lerSqlLog(dir).split("\n").filter(l => l === "GERACAO").length;
    const alterar = fn => { const st = JSON.parse(fs.readFileSync(path.join(dir, "estado.json"), "utf8")); fn(st); gravarEstado(dir, st); };
    const regerando = () => (log().match(/FastPoll: .*→ regerando\./g) || []).length;
    try {
        for (let t = 0; t < 100 && !/consulta rápida \(NFCE, com índice\)/.test(log()); t++) await esperar(100);
        await esperar(1500);
        const g0 = geracoes(), r0 = regerando();
        alterar(st => { st.nfce.push({ numero: "102", hora: horaHaMin(0.1) }); });
        await esperar(400);
        alterar(st => { st.pag.push({ numero: "102", hora: horaHaMin(0.1) }); });
        await esperar(4000);
        const linhas = log().split("\n").filter(l => /FastPoll: .*→ regerando\./.test(l)).slice(r0);
        assert.strictEqual(linhas.length, 1, "deveria haver UMA detecção (venda + pagamento juntos):\n" + linhas.join("\n"));
        assert.match(linhas[0], /vendas 1 → 2 .*Pagamentos: 1 → 2/, "a linha deve trazer a venda e o pagamento");
        assert.match(linhas[0], /\] \[VENDAS\] FastPoll: /, "detecção de venda na categoria [VENDAS]");
        assert.strictEqual(geracoes() - g0, 1, "deveria gerar o relatório UMA vez");

        // Venda EXCLUÍDA: a venda sai e o pagamento sai 400 ms depois → um refresh.
        const g2 = geracoes(), r2 = regerando();
        alterar(st => { st.nfce = st.nfce.filter(r => r.numero !== "102"); });
        await esperar(400);
        alterar(st => { st.pag = st.pag.filter(r => r.numero !== "102"); });
        await esperar(4000);
        const lx = log().split("\n").filter(l => /FastPoll: .*→ regerando\./.test(l)).slice(r2);
        assert.strictEqual(lx.length, 1, "exclusão: uma detecção (venda + pagamento):\n" + lx.join("\n"));
        assert.match(lx[0], /vendas 2 → 1 .*Pagamentos: 2 → 1/);
        assert.strictEqual(geracoes() - g2, 1, "exclusão: uma geração");

        // Gerencial CONVERTIDO em NFC-e (como no caixa): some do gerencial e fica
        // "aguardando autorização" (total 0) ~1,5 s, vira NFC-e autorizada e, logo
        // depois, a forma do pagamento muda → antes 3 refresh, agora UM.
        alterar(st => { st.nfce.push({ numero: "103", hora: horaHaMin(0.1), modelo: 99, total: 20 }); st.pag.push({ numero: "103", hora: horaHaMin(0.1), valor: 20 }); });
        await esperar(4000);
        const g3 = geracoes(), r3 = regerando();
        alterar(st => { const v = st.nfce.find(r => r.numero === "103"); v.modelo = 65; v.total = 0; });
        await esperar(1500);
        alterar(st => { st.nfce.find(r => r.numero === "103").total = 20; });
        await esperar(300);
        alterar(st => { st.pag.find(r => r.numero === "103").forma = "05 PIX"; });
        await esperar(4000);
        const lc = log().split("\n").filter(l => /FastPoll: .*→ regerando\./.test(l)).slice(r3);
        assert.strictEqual(lc.length, 1, "conversão em NFC-e: uma detecção:\n" + lc.join("\n"));
        assert.match(lc[0], /Gerencial: vendas 1 → 0 .*NFC-e: vendas 1 → 2 .*Pagamentos: forma ou valor alterado/);
        assert.strictEqual(geracoes() - g3, 1, "conversão em NFC-e: uma geração");

        // Mudança que não traz pagamento (troca de vendedor): gera logo, uma vez.
        const g1 = geracoes(), r1 = regerando();
        alterar(st => { st.nfce[0].vendedor = "BIA"; });
        for (let t = 0; t < 40 && regerando() === r1; t++) await esperar(50);
        assert.strictEqual(regerando() - r1, 1, "troca de vendedor: uma detecção");
        await esperar(1500);
        assert.strictEqual(geracoes() - g1, 1, "troca de vendedor: uma geração");
    } finally { srv.parar(); }
});

test("servidor: fast-poll põe na parte rápida a tabela que TEM índice (mesmo que não seja a NFCE)", { timeout: 60000 }, async () => {
    const dir = montarPasta({}, {
        indices: ["PAGAMENT.DATA"],
        nfce: [{ numero: "101", hora: horaHaMin(0.1) }],
        pag:  [{ numero: "101", hora: horaHaMin(0.1) }]
    });
    const srv = await iniciarServidor(dir);
    const log = () => { try { return fs.readFileSync(path.join(dir, "relatorio.log"), "utf8"); } catch (_) { return ""; } };
    const alterar = fn => { const st = JSON.parse(fs.readFileSync(path.join(dir, "estado.json"), "utf8")); fn(st); gravarEstado(dir, st); };
    const aguardar = async re => { for (let t = 0; t < 100 && !re.test(log()); t++) await esperar(100); };
    try {
        await aguardar(/consulta rápida \(PAGAMENT, com índice\)/);
        assert.match(log(), /AVISO índices: sem índice em NFCE\.DATA —/);
        assert.match(log(), /duas partes pelos índices — rápida: PAGAMENT \(com índice\) \| complementar: NFCE \(sem índice/);
        alterar(st => { st.pag[0].forma = "05 PIX"; });
        await aguardar(/Pagamentos: forma ou valor alterado/);
        assert.match(log(), /Pagamentos: forma ou valor alterado/, "mudança na parte rápida (PAGAMENT)");
        alterar(st => { st.nfce.push({ numero: "102", hora: horaHaMin(0.1) }); });
        await aguardar(/vendas 1 → 2/);
        assert.match(log(), /vendas 1 → 2 \(↑ \+1\)/, "mudança na parte complementar (NFCE) também é detectada");
    } finally { srv.parar(); }
});

test("servidor: sem suporte à consulta completa, o fast-poll segue no modo básico", { timeout: 60000 }, async () => {
    const dir = montarPasta({}, { semHash: true, semIndice: true, nfce: [{ numero: "101", hora: horaHaMin(0.1) }] });
    const srv = await iniciarServidor(dir);
    const log = () => { try { return fs.readFileSync(path.join(dir, "relatorio.log"), "utf8"); } catch (_) { return ""; } };
    try {
        await esperar(7000);
        assert.match(log(), /consulta completa indisponível neste banco .*modo básico/);
        assert.match(log(), /AVISO índices: sem índice em NFCE\.DATA, PAGAMENT\.DATA/, "deveria avisar a falta de índice");
        const st = JSON.parse(fs.readFileSync(path.join(dir, "estado.json"), "utf8"));
        st.nfce.push({ numero: "102", hora: horaHaMin(0.1) });
        gravarEstado(dir, st);
        await esperar(3000);
        assert.match(log(), /FastPoll: vendas 2 > 1/, "o modo básico ainda deve detectar venda nova");
    } finally { srv.parar(); }
});

test("servidor: gerador pré-aquecido fica pronto e não sobra processo ao encerrar", { timeout: 60000, skip: process.platform === "win32" ? "usa ps (Linux/macOS)" : false }, async () => {
    const dir = montarPasta({}, { nfce: [{ numero: "101", hora: horaHaMin(0.1) }] });
    const srv = await iniciarServidor(dir);
    const reservas = () => spawnSync("ps", ["-eo", "pid,args"], { encoding: "utf8" }).stdout
        .split("\n").filter(l => l.includes("node-firebird") && l.includes(dir));
    try {
        await esperar(4000);
        assert.ok(reservas().length >= 1, "deveria haver um gerador pré-aquecido esperando a ordem");
        // Uma venda nova usa a reserva e uma nova é preparada em seguida.
        const st = JSON.parse(fs.readFileSync(path.join(dir, "estado.json"), "utf8"));
        st.nfce.push({ numero: "102", hora: horaHaMin(0.1) });
        gravarEstado(dir, st);
        await esperar(3000);
        assert.strictEqual(reservas().length, 1, "deveria repor exatamente uma reserva");
        const r = await fetch(srv.base + "/api/encerrar?origem=teste");
        assert.strictEqual(r.status, 200);
        await esperar(2500);
        assert.strictEqual(reservas().length, 0, "nenhum gerador pode sobrar depois de encerrar:\n" + reservas().join("\n"));
    } finally { srv.parar(); }
});

test("servidor: rajada de vendas sem pausa — a tela continua atualizando (geração não é cancelada)", { timeout: 60000 }, async () => {
    // Geração de 300 ms (banco lento) e uma alteração a cada 60 ms: antes, cada
    // alteração cancelava a geração em curso e nenhuma terminava até a rajada parar.
    const dir = montarPasta({}, { atrasoGeracaoMs: 300, nfce: [{ numero: "101", hora: horaHaMin(0.1), total: 10 }] });
    const srv = await iniciarServidor(dir);
    const http = require("node:http");
    let recargas = 0;
    const req = http.get(srv.base + "/api/events", res => { res.setEncoding("utf8"); res.on("data", d => { recargas += (d.match(/"type":"reload"/g) || []).length; }); });
    try {
        await esperar(6000);
        recargas = 0;
        const st = JSON.parse(fs.readFileSync(path.join(dir, "estado.json"), "utf8"));
        const fimRajada = Date.now() + 3000;
        let v = 10;
        while (Date.now() < fimRajada) {               // uma alteração a cada 60 ms, sem parar
            st.nfce[0].total = ++v;
            gravarEstado(dir, st);
            await esperar(60);
        }
        const durante = recargas;
        await esperar(2500);
        assert.ok(durante >= 3, "a tela deveria atualizar várias vezes DURANTE a rajada (atualizou " + durante + "x)");
        assert.ok(recargas > durante || durante > 0, "deveria haver atualização final após a rajada");
        const log = fs.readFileSync(path.join(dir, "relatorio.log"), "utf8");
        assert.ok(!/superada por/.test(log), "nenhuma geração deveria ser cancelada/superada pelo fast-poll");
    } finally { req.destroy(); srv.parar(); }
});
