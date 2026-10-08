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
const gravarEstado = (dir, st) => {
    const tmp = path.join(dir, "estado.json.tmp");
    fs.writeFileSync(tmp, JSON.stringify(st));
    fs.renameSync(tmp, path.join(dir, "estado.json"));
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

async function iniciarServidor(dir) {
    const porta = await portaLivre();
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
    cfg.porta = porta;
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(cfg, null, 2));
    const proc = spawn(process.execPath, ["servidor-relatorio.js", "--no-browser"], { cwd: dir, env: ambiente(dir), stdio: "ignore" });
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
    // Caso real: gerencial 063538 (RICHARD) × NFC-e 125319 (GERENCIA), mesmo
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
    assert.ok(!codigos(venda("RICHARD", "GERENCIA")).includes("POSSIVEL_DUPLICIDADE"), "vendedores diferentes: não é duplicidade");
    // v3.8.3: mesmo vendedor (ou NFC-e ainda sem vendedor) = conversão — a
    // reconciliação final resolve sozinha e o aviso não sobra.
    assert.ok(!codigos(venda("RICHARD", "RICHARD")).includes("POSSIVEL_DUPLICIDADE"), "mesmo vendedor: absorvida, sem aviso pendente");
    assert.ok(!codigos(venda("RICHARD", "")).includes("POSSIVEL_DUPLICIDADE"), "NFC-e sem vendedor: absorvida, sem aviso pendente");
    // Itens dos dois lados sem nenhum em comum: são duas vendas — nem absorve, nem avisa.
    const comItens = venda("RICHARD", "RICHARD");
    comItens.alt = [{ pedido: "63538", desc: "CANETA AZUL", qtd: 1, total: 19 }, { pedido: "125319", desc: "CADERNO", qtd: 1, total: 19 }];
    const htmlItens = gerar(montarPasta({}, comItens));
    const dItens = JSON.parse(htmlItens.match(/<script id="dados" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    assert.strictEqual(dItens.vendas.length, 2, "itens diferentes: as duas vendas ficam");
    assert.ok(!dItens.autoteste.achados.some(a => a.codigo === "POSSIVEL_DUPLICIDADE"), "itens diferentes: não é duplicidade");
});

test("padrão de fábrica: config.json do repositório sem dados de loja e sem proibidos embutidos", () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(RAIZ_PROJETO, "config.json"), "utf8"));
    assert.strictEqual(cfg.appName, "Relatorios");
    assert.deepStrictEqual(cfg.proibidos, []);
    assert.deepStrictEqual(cfg.teclasPersonalizadas, []);
    for (const k of ["fbHost", "fdbPath", "maquinaIP", "fbUser", "fbPass", "favicon"]) assert.strictEqual(cfg[k], "", k + " deveria estar vazio");
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
            { numero: "62418", hora: "10:00:00", modelo: 99, total: 1000, vendedor: "RICHARD" },
            { numero: "306", hora: "10:07:00", modelo: 65, total: 1215.51, vendedor: "RICHARD" },
            // Mesmo valor e janela, vendedores diferentes: duas vendas — fica tudo.
            { numero: "63538", hora: "11:00:00", modelo: 99, total: 19, vendedor: "RICHARD" },
            { numero: "125319", hora: "11:03:00", modelo: 65, total: 19, vendedor: "GERENCIA" }
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
        ["COCA\nPEPSI", ["COCA", "PEPSI"], false],
        ["COCA, PEPSI;FANTA\tSPRITE | KUAT", ["COCA", "PEPSI", "FANTA", "SPRITE", "KUAT"], true],
        ['["COCA","coca","PEPSI"]', ["COCA", "PEPSI"], true],
        ['- "COCA"\n1. COCÁ\n2) AGUA   1,5L', ["COCA", "AGUA 1,5L"], true],
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
            { pedido: "101", desc: "COCA", qtd: 2, total: 20 }, { pedido: "101", desc: "PAO", qtd: 5, total: 5 },
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
        nfce: [{ numero: "101", hora: horaHaMin(0.1), vendedor: "ANA", modelo: 65 }],
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
