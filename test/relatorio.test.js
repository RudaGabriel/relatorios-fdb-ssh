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
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(Object.assign({
        appName: "Teste", porta: 7734, pollInterval: 200, fbHost: "127.0.0.1", fdbPath: "/tmp/teste.fdb",
        proibidos: [], maxLogLines: 5000, logDebug: false, toastDuration: 5000, spawnTimeoutMs: 120000, teclasPersonalizadas: []
    }, config || {}), null, 2));
    fs.writeFileSync(path.join(dir, "estado.json"), JSON.stringify(Object.assign({ nfce: [], pag: [], ger: [] }, estado || {})));
    return dir;
}
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

test("gerador: janela de correção de horário — padrão 3 h e valor configurado", () => {
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

// ---------------------------------------------------------------------------
test("servidor: correção de horário só em documentos que APARECEM com hora velha", { timeout: 60000 }, async () => {
    const dir = montarPasta({}, {
        nfce: [{ numero: "100", hora: horaHaMin(30) }, { numero: "101", hora: horaHaMin(0.2) }],
        pag:  [{ numero: "500", hora: horaHaMin(30) }]
    });
    const srv = await iniciarServidor(dir);
    try {
        await esperar(8000); // 5 s de espera inicial + 1ª varredura (linha de base)
        assert.ok(!/UPDATE/.test(lerSqlLog(dir)), "a linha de base (boot) não pode alterar nada:\n" + lerSqlLog(dir));

        const st = JSON.parse(fs.readFileSync(path.join(dir, "estado.json"), "utf8"));
        st.ger = [
            { numero: "700", hora: horaHaMin(150) },                   // gerencial 2h30 atrás → corrigir (janela padrão 3 h)
            { numero: "701", hora: horaHaMin(200) }                    // gerencial 3h20 atrás → fora da janela, ignorar
        ];
        st.nfce.find(r => r.numero === "101").hora = horaHaMin(20); // já visto → nunca corrigir
        st.nfce.push({ numero: "102", hora: horaHaMin(10) });         // novo e velho → corrigir
        st.nfce.push({ numero: "103", hora: horaHaMin(0.1) });        // novo e recente → não corrigir
        st.pag.push({ numero: "501", hora: horaHaMin(5) });           // novo e velho → corrigir
        fs.writeFileSync(path.join(dir, "estado.json"), JSON.stringify(st));
        await esperar(5000);

        const updates = lerSqlLog(dir).split("\n").filter(l => l.startsWith("UPDATE"));
        const alvos = updates.map(l => JSON.parse(l.slice(7, l.indexOf(" :: ")))[1]).sort();
        assert.deepStrictEqual(alvos, ["102", "501", "700"], "UPDATEs inesperados:\n" + updates.join("\n"));
    } finally { srv.parar(); }
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

        const r = await fetch(srv.base + "/api/encerrar?origem=teste-automatico");
        assert.strictEqual(r.status, 200);
        await Promise.race([saiu, esperar(8000)]);
        controle.abort(); await lendo;

        assert.strictEqual(codigo, 0, "o servidor deveria sair com código 0");
        assert.match(recebido, /"type":"encerrando"/, "as abas deveriam receber o aviso de encerramento");
        const log = fs.readFileSync(path.join(dir, "relatorio.log"), "utf8");
        assert.match(log, /=== Servidor encerrado: encerramento solicitado por teste-automatico ===/);
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
    const dir = montarPasta({}, {
        nfce: [{ numero: "101", hora: horaHaMin(0.1), vendedor: "ANA", modelo: 65 }],
        pag:  [{ numero: "101", hora: horaHaMin(0.1) }]
    });
    const srv = await iniciarServidor(dir);
    const log = () => { try { return fs.readFileSync(path.join(dir, "relatorio.log"), "utf8"); } catch (_) { return ""; } };
    const geracoes = () => lerSqlLog(dir).split("\n").filter(l => l === "GERACAO").length;
    const alterar = fn => { const st = JSON.parse(fs.readFileSync(path.join(dir, "estado.json"), "utf8")); fn(st); fs.writeFileSync(path.join(dir, "estado.json"), JSON.stringify(st)); };
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

test("servidor: sem suporte à consulta completa, o fast-poll segue no modo básico", { timeout: 60000 }, async () => {
    const dir = montarPasta({}, { semHash: true, nfce: [{ numero: "101", hora: horaHaMin(0.1) }] });
    const srv = await iniciarServidor(dir);
    const log = () => { try { return fs.readFileSync(path.join(dir, "relatorio.log"), "utf8"); } catch (_) { return ""; } };
    try {
        await esperar(7000);
        assert.match(log(), /consulta completa indisponível neste banco .*modo básico/);
        const st = JSON.parse(fs.readFileSync(path.join(dir, "estado.json"), "utf8"));
        st.nfce.push({ numero: "102", hora: horaHaMin(0.1) });
        fs.writeFileSync(path.join(dir, "estado.json"), JSON.stringify(st));
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
        fs.writeFileSync(path.join(dir, "estado.json"), JSON.stringify(st));
        await esperar(3000);
        assert.strictEqual(reservas().length, 1, "deveria repor exatamente uma reserva");
        const r = await fetch(srv.base + "/api/encerrar?origem=teste");
        assert.strictEqual(r.status, 200);
        await esperar(2500);
        assert.strictEqual(reservas().length, 0, "nenhum gerador pode sobrar depois de encerrar:\n" + reservas().join("\n"));
    } finally { srv.parar(); }
});
