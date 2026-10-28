/**
 * gerar-relatorio-html.js
 * @version 3.26.1
 * @author Ruda Gabriel
 * @description Gerador de relatório HTML (subprocesso spawnado pelo servidor). SOMENTE LEITURA.
 * @changelog (único, exclusivo desta versão — sem acumular histórico de versões anteriores)
 *   (Histórico completo das versões: CHANGELOG.md no repositório.)
 *   3.26.1 - 2026-10-28 23:00 - Exemplos neutros (sem nomes de pessoas ou empresas) na ajuda e nos placeholders.
 */

(function() {
    // Mantida em sincronia manual com @version no header do arquivo.
    // Embutida no HTML gerado (comentário + atributo data-*) para rastreabilidade:
    // suporte técnico consegue identificar qual versão do script gerou um relatório
    // específico sem precisar abrir o gerar-relatorio-html.js.
    const SCRIPT_VERSION = "3.26.1";
    // Lista-mestra dos temas. id = valor de data-theme no HTML e de "fdb_theme" salvo no navegador;
    // ordem = ordem no menu e no "próximo tema". O CSS de cada id é o bloco [data-theme="id"] do <style>
    // (variáveis) mais, nos temas de estilo, as regras html[data-theme="id"] (forma: cantos, bordas,
    // brilho, fundo, cards). "ultra-dark" e "light" mantêm o id: há quem tenha a escolha salva.
    // v3.9.0: saíram os temas que só trocavam a cor; quem usava um deles cai no Escuro ou no Claro
    // (TEMAS_LEGADOS_CLAROS decide qual).
    const TEMAS_RELATORIO = [
        { id: "ultra-dark", nome: "Escuro",      grupo: "basico" },
        { id: "light",      nome: "Claro",       grupo: "basico" },
        { id: "hud",        nome: "HUD Ciano",   grupo: "estilo" },
        { id: "indigo",     nome: "Índigo Neon", grupo: "estilo" },
        { id: "executivo",  nome: "Executivo",   grupo: "estilo" },
        { id: "ambar",      nome: "Âmbar Vidro", grupo: "estilo" },
        { id: "brasa",      nome: "Brasa Noturna", grupo: "estilo" }
    ];
    const TEMAS_LEGADOS_CLAROS = ["solarized-light", "paper", "mint", "lavender", "sky"];
    // ===== SOMENTE LEITURA (v2.14.0) ============================================
    // O sistema NUNCA escreve no banco do Small Commerce. Duas travas, em toda
    // conexão aberta por este processo (bloco idêntico no servidor e no gerador):
    //  1. Comando: só passa SQL que começa com SELECT ou WITH; qualquer outro
    //     (UPDATE, INSERT, DELETE, EXECUTE, ALTER...) é recusado ANTES de chegar
    //     ao Firebird.
    //  2. Transação: toda consulta roda numa transação SOMENTE LEITURA (isc_tpb_read),
    //     READ COMMITTED com rec_version e sem espera — o próprio Firebird recusa
    //     qualquer escrita (inclusive por procedure chamada num SELECT) e a leitura
    //     nunca fica esperando transação aberta do caixa.
    // Vale SÓ para as conexões abertas por este projeto: é uma opção da transação
    // que o próprio projeto inicia — o banco, os PDVs e as conexões deles não são
    // afetados e continuam gravando normalmente (testado num Firebird 3). O banco
    // NÃO é colocado em modo somente leitura.
    // O padrão do node-firebird (db.query) abria transação de ESCRITA, com ESPERA e
    // "no_rec_version": com o caixa no meio de uma gravação, a leitura ficava
    // TRAVADA até ele confirmar (medido: ~3 s). Atenção aos nomes do driver:
    // ISOLATION_READ_COMMITTED = read_committed + NO_rec_version (dá conflito);
    // o certo é read_committed (15) + rec_version (17), escrito aqui por número.
    var _somenteLeitura = function(FB) {
        if (!FB || FB.__somenteLeitura) return FB;
        // Versão do driver: pelo package.json do módulo e, se o pacote bloquear
        // esse caminho (campo "exports" em versões futuras), lendo o arquivo do disco.
        var maior = NaN;
        try { maior = parseInt(String(require("node-firebird/package.json").version).split(".")[0], 10); } catch (_) {}
        if (!(maior >= 0)) {
            try {
                var _fsV = require("fs"), _pV = require("path"), _dV = _pV.dirname(require.resolve("node-firebird"));
                for (var _iV = 0; _iV < 6 && !(maior >= 0); _iV++) {
                    try {
                        var _pkV = JSON.parse(_fsV.readFileSync(_pV.join(_dV, "package.json"), "utf8"));
                        if (_pkV && _pkV.name === "node-firebird") maior = parseInt(String(_pkV.version).split(".")[0], 10);
                    } catch (_) {}
                    _dV = _pV.dirname(_dV);
                }
            } catch (_) {}
        }
        // node-firebird 1.x aceita objeto de opções; versões antigas só a lista de isolamento.
        var ISO_REC_VERSION = [15, 17]; // isc_tpb_read_committed + isc_tpb_rec_version
        // Lista só no 0.x CONFIRMADO. No 1.x uma lista vira transação de ESCRITA com
        // espera (readOnly:false, wait:true) — por isso versão desconhecida usa o objeto.
        var TX = maior === 0 ? ISO_REC_VERSION : { isolation: ISO_REC_VERSION, readOnly: true, wait: false };
        var SQL_LEITURA = /^\s*(?:(?:--[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*(select|with)\b/i;
        var recusar = function(sql, cb) {
            var cmd = String(sql || "").trim().split(/\s+/)[0] || "(vazio)";
            var e = new Error("Bloqueado: o sistema é somente leitura — comando " + cmd.toUpperCase() + " não é enviado ao banco.");
            if (typeof cb === "function") setImmediate(function() { cb(e); });
            return e;
        };
        var blindarTx = function(tx) {
            ["query", "execute"].forEach(function(m) {
                var orig = tx[m];
                if (typeof orig !== "function") return;
                tx[m] = function(sql, params, cb) {
                    if (!SQL_LEITURA.test(String(sql || ""))) return recusar(sql, typeof params === "function" ? params : cb);
                    // Repassa TODOS os argumentos: query() chama execute() com um 4º
                    // (opções como asObject) que não pode se perder.
                    return orig.apply(tx, arguments);
                };
            });
            return tx;
        };
        var blindarDb = function(db) {
            if (!db || db.__somenteLeitura) return db;
            db.__somenteLeitura = true;
            // Vai direto na conexão: Database.transaction chama this.startTransaction,
            // que é substituído aqui — chamar o original de Database entraria em laço.
            var conn = db.connection;
            db.transaction = db.startTransaction = function(_opcoesIgnoradas, cb) {
                if (typeof _opcoesIgnoradas === "function") cb = _opcoesIgnoradas;
                conn.startTransaction(TX, function(err, tx) { cb(err, tx ? blindarTx(tx) : tx); });
                return db;
            };
            db.query = db.execute = function(sql, params, cb) {
                if (typeof params === "function") { cb = params; params = []; }
                if (!SQL_LEITURA.test(String(sql || ""))) return recusar(sql, cb);
                db.transaction(null, function(errTx, tx) {
                    if (errTx) { if (cb) cb(errTx); return; }
                    tx.query(sql, params || [], function(e, rows) {
                        // Leitura pura: rollback encerra a transação sem custo de commit.
                        try { tx.rollback(function() {}); } catch (_) {}
                        if (cb) cb(e || null, rows);
                    });
                });
                return db;
            };
            return db;
        };
        var api = Object.create(FB);
        api.__somenteLeitura = true;
        api.attach = function(opts, cb) {
            return FB.attach(opts, function(err, db) { cb(err, db ? blindarDb(db) : db); });
        };
        return api;
    };
    // ===========================================================================
    const Firebird = _somenteLeitura(require("node-firebird"));
    const fs = require("node:fs");
    const process = require("node:process");
    const args = process.argv.slice(2);
    const pegar = k => {
        const i = args.indexOf(k);
        return i >= 0 && i + 1 < args.length ? String(args[i + 1] || "").trim() : "";
    };
    const fdbRaw = pegar("--fdb");
    const dataSingular = pegar("--data");
    const dataInicioRaw = dataSingular || pegar("--data-inicio");
    const dataFimRaw = dataSingular || pegar("--data-fim");

    const parseISO = (s) => {
        const str = String(s || "").trim();
        let m;
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
        m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m) return `${m[3]}-${m[2]}-${m[1]}`;
        return str;
    };

    // Valida não só o FORMATO (regex) mas também se representa uma data de
    // calendário real — ex: "2026-02-30" bate no regex mas não existe.
    // BUG CORRIGIDO: antes, uma string que não batesse em NENHUM formato
    // reconhecido (ex: "amanha", digitação errada) era retornada inalterada
    // por parseISO() e passava incólume pela checagem "!dataInicioISO" (pois
    // é uma string não-vazia). Isso propagava para new Date(...).getTime(),
    // virava NaN, contaminava _diasIntervalo/_tGlobal, e o setTimeout do
    // watchdog (linha ~155) disparava com delay NaN — que o Node/browser
    // tratam como 0ms — derrubando o processo quase instantaneamente com uma
    // mensagem enganosa de "Tempo limite excedido", quando o problema real
    // era um argumento de data inválido.
    const isDataValidaISO = (iso) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
        const [ano, mes, dia] = iso.split("-").map(Number);
        const d = new Date(Date.UTC(ano, mes - 1, dia));
        // Round-trip: se o JS "normalizou" (ex: dia 30 de fevereiro virou março),
        // os componentes não batem mais — detecta datas de calendário inválidas.
        return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
    };

    const dataInicioISO = parseISO(dataInicioRaw);
    const dataFimISO = parseISO(dataFimRaw);

    const saida = pegar("--saida");
    // Credenciais: --user/--pass (uso manual) > variáveis de ambiente (fora da
    // linha de comando, que é visível na lista de processos do SO) > padrão de
    // fábrica. Aceita as duas convenções: RELATORIO_FB_USER/RELATORIO_FB_PASS
    // (repassadas pelo servidor-relatorio.js) e FIREBIRD_USER/FIREBIRD_PASSWORD.
    const _envUsuario = String(process.env.RELATORIO_FB_USER || process.env.FIREBIRD_USER || "").trim();
    const _envSenha   = String(process.env.RELATORIO_FB_PASS || process.env.FIREBIRD_PASSWORD || "");
    const usuario = pegar("--user") || _envUsuario || "SYSDBA";
    const senha   = pegar("--pass") || _envSenha   || "masterkey";
    // Aviso de segurança: SYSDBA/masterkey são as credenciais de fábrica do
    // Firebird — se o banco de produção nunca teve a senha trocada, isso
    // conecta com privilégios de DBA completos. Só avisa quando é o caso e a
    // senha não veio do servidor (ele mesmo já registra esse aviso uma vez —
    // repetir a cada geração enchia o log).
    if (usuario.toUpperCase() === "SYSDBA" && senha === "masterkey" && !_envSenha) {
        console.warn("[AVISO] Usando credenciais padrão do Firebird (SYSDBA/masterkey). Se o banco de produção usa outras, defina fbUser/fbPass no config.json.");
    }
    const FIREBIRD_PORT = 3050; // porta padrão Firebird — única fonte da verdade

    if (!fdbRaw || !dataInicioISO || !dataFimISO || !saida) {
        console.log("Uso:\nnode gerar-relatorio-html.js --fdb 192.168.1.100:C:\\Banco.fdb --data 2026-03-01 --saida out.html");
        process.exit(1);
    }
    // Validação explícita de calendário — falha cedo e com mensagem clara,
    // em vez de deixar o erro se manifestar como timeout enganoso mais tarde.
    if (!isDataValidaISO(dataInicioISO) || !isDataValidaISO(dataFimISO)) {
        console.log("ERRO: data inválida. Use --data AAAA-MM-DD ou DD/MM/AAAA (ex: --data 2026-03-01 ou --data 01/03/2026).");
        console.log("  --data-inicio recebido: " + JSON.stringify(dataInicioRaw) + " -> interpretado como: " + JSON.stringify(dataInicioISO));
        console.log("  --data-fim    recebido: " + JSON.stringify(dataFimRaw)    + " -> interpretado como: " + JSON.stringify(dataFimISO));
        process.exit(1);
    }
    if (dataInicioISO > dataFimISO) {
        console.log("ERRO: --data-inicio (" + dataInicioISO + ") é posterior a --data-fim (" + dataFimISO + "). Inverta o intervalo.");
        process.exit(1);
    }

    // === LÊ CONFIG (proibidos + appName) ===
    const pathConfig = require("node:path").join(__dirname, "config.json");
    let cfgProibidos             = [];
    let cfgAppName               = "Relatorios"; // default igual ao servidor — evita título "Relatório  YYYY-MM-DD" (espaço duplo) quando config.json não tem appName
    let cfgToastDuracao          = 5000;
    // Janela de correção de horário (min) — mesma chave e mesmos limites de
    // servidor-relatorio.js ("janelaCorrecaoHoraMin"); padrão 180 (3 horas).
    let cfgJanelaHoraMin         = 180;
    let cfgTeclasPersonalizadas  = [];
    try {
        const rawCfg = fs.readFileSync(pathConfig, "utf8").replace(/^\uFEFF/, "");
        const c = JSON.parse(rawCfg);
        if (Array.isArray(c.proibidos))            cfgProibidos    = c.proibidos;
        if (c.appName && String(c.appName).trim()) cfgAppName      = String(c.appName).trim();
        const _td = parseInt(c.toastDuration, 10); if (_td >= 500) cfgToastDuracao = _td;
        const _jh = parseInt(c.janelaCorrecaoHoraMin, 10); if (_jh >= 5 && _jh <= 720) cfgJanelaHoraMin = _jh;
        if (Array.isArray(c.teclasPersonalizadas)) cfgTeclasPersonalizadas = c.teclasPersonalizadas.filter(
            t => t && typeof t.tecla === "string" && (typeof t.comando === "string" || typeof t.acao === "string")
        );
    } catch(e) {
        console.warn("[AVISO] config.json não pôde ser lido (" + (e.message || e) + ") — usando valores padrão.");
    }

    // === LÓGICA DE IDENTIFICAÇÃO DE REDE DO FIREBIRD ===
    let host = "127.0.0.1";
    let dbPath = fdbRaw;
    const matchIP = fdbRaw.match(/^([0-9.]+|[a-zA-Z0-9_-]+):([a-zA-Z]:\\.*|\/.*)/);
    if (matchIP) {
        host = matchIP[1];
        dbPath = matchIP[2];
    }

    // ATENÇÃO — duplicação INTENCIONAL: esta função é logicamente idêntica a
    // `esc()` definida no lado cliente (dentro do template `html`, procure por
    // "const esc="). Não dá para compartilhar o código entre os dois porque
    // um roda em Node.js (montagem do relatório) e o outro no navegador
    // (dentro do HTML gerado) — são runtimes diferentes sem módulo compartilhado
    // neste formato de arquivo único. Se um dia mudar a lógica de escape aqui,
    // replique a mudança em `esc()` também.
    const escHtml = s => String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    // JSON seguro para embutir em <script>: escapa "<" (impede "</script>"
    // fechar o bloco) e U+2028/U+2029 (quebram literais em JS antigo).
    // Fonte única — usada para os dados do relatório e para as teclas de atalho.
    const _jsonParaScript = v => JSON.stringify(v === undefined ? null : v)
        .replace(/</g, "\\u003c")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");

    // Texto vindo do banco como bytes crus (CHARACTER SET OCTETS — ver _txt): o
    // SmallSoft grava nomes em colunas sem charset (NONE) com bytes Windows-1252;
    // pedidos como texto, o "í" chegava trocado pelo caractere de substituição U+FFFD. UTF-8
    // válido é usado como está (coluna declarada UTF8); senão, Windows-1252.
    // Node sem ICU completo não tem windows-1252: cai em latin1 (mesmos acentos).
    const _decUtf8Estrito = (() => { try { return new TextDecoder("utf-8", { fatal: true }); } catch (_) { return null; } })();
    const _decWin1252 = (() => { try { return new TextDecoder("windows-1252"); } catch (_) { return null; } })();
    const decoder = {
        decode(buf) {
            if (_decUtf8Estrito) { try { return _decUtf8Estrito.decode(buf); } catch (_) { /* não é UTF-8 */ } }
            if (_decWin1252) { try { return _decWin1252.decode(buf); } catch (_) { /* segue */ } }
            return Buffer.from(buf).toString("latin1");
        }
    };

    // Limpeza em "melhor esforço" (detach de conexão, remoção de arquivo temporário):
    // usada SÓ onde uma falha secundária não pode mascarar o erro principal que já
    // está sendo reportado ao operador. Nomear o padrão evita catch vazio espalhado
    // e deixa a intenção explícita em cada ponto de uso.
    const tentarSilencioso = (fn) => { try { return fn(); } catch (_) { return undefined; } };

    // Soma de valores monetários em ponto flutuante acumula resíduo (ex.:
    // 444.28999999999996). Arredonda para centavos antes de gravar no JSON.
    const arredondarCentavos = (valor) => Math.round((Number(valor) + Number.EPSILON) * 100) / 100;

    // Nomes de coluna descobertos no schema (rdb$relation_fields) são interpolados
    // em SQL. Não são entrada do usuário, mas aceitar só identificadores simples
    // não-quotados é defesa em profundidade: um nome exótico é descartado em vez
    // de virar fragmento de SQL.
    const IDENTIFICADOR_SQL_SEGURO = /^[A-Z_][A-Z0-9_$]*$/;

    // <AUTOTESTE-INICIO>
    // ── AUTO-TESTE (v3.1.0) ──────────────────────────────────────────────────────
    // Roda a CADA geração, sem ação do usuário, sobre o resultado final já montado, e só
    // se manifesta quando acha algo (log + caixa de mensagem no relatório). Nunca derruba
    // a geração: qualquer exceção interna vira o achado AUTOTESTE_FALHOU.
    // Transforma em verificação permanente os defeitos já vistos neste sistema: total que
    // não fecha, venda contada duas vezes, NF-e que some, leitura do banco que falha em
    // silêncio. Bloco autônomo (sem dependência externa) para poder ser testado isolado.
    const executarAutoTeste = (ctx) => {
        const TOLERANCIA_CENTAVO = 0.005;
        const achados = [];
        let verificacoes = 0;
        const alertar = (nivel, codigo, msg) => { achados.push({ nivel, codigo, msg }); };
        const verificar = (ok, nivel, codigo, msg) => { verificacoes++; if (!ok) alertar(nivel, codigo, msg); };
        const reais = (v) => "R$ " + Number(v || 0).toFixed(2).replace(".", ",");
        const semZeros = (n) => String(n == null ? "" : n).trim().replace(/^0+/, "");
        const lista = (itens, max) => itens.slice(0, max).join(", ") + (itens.length > max ? " e mais " + (itens.length - max) : "");
        const minutos = (h) => {
            const m = String(h || "").trim().match(/^(\d{1,2}):(\d{2})/);
            return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
        };
        // Vendedores diferentes = vendas diferentes (v3.8.2). Só vale quando os DOIS
        // são conhecidos: vazio, "?" e rótulos como "(aguardando autorização)" — a
        // NFC-e convertida chega sem vendedor até a SEFAZ autorizar — não descartam.
        const vendedoresDiferentes = (a, b) => {
            const norm = (v) => String(v == null ? "" : v).trim().toUpperCase()
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
            const x = norm(a), y = norm(b);
            const conhecido = (v) => v !== "" && v !== "?" && !v.startsWith("(");
            return conhecido(x) && conhecido(y) && x !== y;
        };
        // Itens dos DOIS lados e nenhum em comum = vendas diferentes (v3.8.3) — mesma
        // regra da reconciliação final do gerador (descrição normalizada, 20 caracteres).
        const itensIncompativeis = (a, b) => {
            const descs = (l) => new Set((Array.isArray(l && l.itensDetalhe) ? l.itensDetalhe : [])
                .filter((it) => it && !(Number.isFinite(Number(it.total)) && it.total !== null && Number(it.total) < 0))
                .map((it) => String(it.desc || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                    .toUpperCase().replace(/\s+/g, " ").trim().slice(0, 20))
                .filter((d) => d && !/\b(DESCONTO|ACRESCIMO)\b/.test(d)));
            const x = descs(a), y = descs(b);
            if (x.size === 0 || y.size === 0) return false;
            for (const d of x) if (y.has(d)) return false;
            return true;
        };

        const linhas = Array.isArray(ctx.linhas) ? ctx.linhas : [];
        const totais = ctx.totais || {};
        const totaisDia = ctx.totaisDia || {};
        const porVendedor = Array.isArray(ctx.vendTotaisDia) ? ctx.vendTotaisDia : [];
        const dup = ctx.duplicatas || {};
        const falhasLeitura = Array.isArray(ctx.falhasLeitura) ? ctx.falhasLeitura : [];
        const nfeRejeitadas = Array.isArray(ctx.nfeRejeitadas) ? ctx.nfeRejeitadas : [];
        const dedupAmbiguos = Array.isArray(ctx.dedupAmbiguos) ? ctx.dedupAmbiguos : [];
        const dedupFundidas = Array.isArray(ctx.dedupFundidas) ? ctx.dedupFundidas : [];
        const toleranciaMin = Number.isFinite(ctx.toleranciaMinutos) ? ctx.toleranciaMinutos : 20;

        try {
            // 1) Leitura do banco: falha aqui é silenciosa na geração (o relatório sai, só que incompleto).
            verificacoes++;
            for (const f of falhasLeitura) {
                alertar("critico", "LEITURA_FALHOU", "Falha ao ler " + f.fonte + " (" + f.detalhe + "): parte das vendas pode estar faltando e o total do dia pode estar abaixo do real.");
            }

            // 2) Valores e totais que precisam fechar.
            const invalidas = linhas.filter((l) => !Number.isFinite(Number(l.total)) || Number(l.total) <= 0);
            verificar(invalidas.length === 0, "critico", "VALOR_INVALIDO",
                invalidas.length + " venda(s) com valor inválido ou zerado: " + lista(invalidas.map((l) => l.tipo + " " + l.numero), 5) + ".");
            const soma = linhas.reduce((a, l) => a + (Number(l.total) || 0), 0);
            verificar(Math.abs(Number(totais.total || 0) - soma) <= TOLERANCIA_CENTAVO, "critico", "TOTAL_DIA_DIVERGE",
                "O total do dia (" + reais(totais.total) + ") não bate com a soma das vendas listadas (" + reais(soma) + ").");
            verificar(Number(totais.qtd) === linhas.length, "critico", "QTD_DIVERGE",
                "A quantidade de vendas (" + totais.qtd + ") não bate com as linhas listadas (" + linhas.length + ").");
            if (totaisDia.ok) {
                const porTipo = Number(totaisDia.gerencial || 0) + Number(totaisDia.nfce || 0) + Number(totaisDia.nfe || 0);
                verificar(Math.abs(porTipo - soma) <= TOLERANCIA_CENTAVO, "critico", "TOTAL_TIPO_DIVERGE",
                    "Gerencial + NFC-e + NF-e (" + reais(porTipo) + ") não bate com a soma das vendas (" + reais(soma) + ").");
                const qtdTipos = Number(totaisDia.qtd_gerencial || 0) + Number(totaisDia.qtd_nfce || 0) + Number(totaisDia.qtd_nfe || 0);
                verificar(qtdTipos === linhas.length, "critico", "QTD_TIPO_DIVERGE",
                    "A contagem por tipo (" + qtdTipos + ") não bate com as linhas listadas (" + linhas.length + ").");
            }
            const somaVendedores = porVendedor.reduce((a, v) => a + (Number(v.geral) || 0), 0);
            verificar(Math.abs(somaVendedores - soma) <= TOLERANCIA_CENTAVO, "critico", "TOTAL_VENDEDOR_DIVERGE",
                "A soma por vendedor (" + reais(somaVendedores) + ") não bate com a soma das vendas (" + reais(soma) + ").");
            // Exato de propósito: 444.28999999999996 difere de 444.29 por ~4e-14, então qualquer
            // tolerância "folgada" deixaria passar justamente o resíduo que se quer pegar.
            const totalDia = Number(totais.total || 0);
            verificar(totalDia === Math.round(totalDia * 100) / 100, "aviso", "RESIDUO_FLUTUANTE",
                "O total do dia tem resíduo de ponto flutuante (" + totais.total + ").");

            // 3) Duplicidade: a mesma venda contada duas vezes.
            const vistos = new Set();
            const repetidos = [];
            for (const l of linhas) {
                const chave = l.tipo + "|" + semZeros(l.numero) + "|" + (l._dtKey || "");
                if (vistos.has(chave)) repetidos.push(l.tipo + " " + l.numero); else vistos.add(chave);
            }
            verificar(repetidos.length === 0, "critico", "DOCUMENTO_REPETIDO",
                "Documento listado mais de uma vez: " + lista(repetidos, 5) + ".");

            const suprimidas = new Set([].concat(dup.confirmadas || [], dup.provaveis || [])
                .map((d) => semZeros(d.gerencial)).filter(Boolean));
            const fantasmas = linhas.filter((l) => l.tipo === "recebimento" && suprimidas.has(semZeros(l.numero)));
            verificar(fantasmas.length === 0, "critico", "RECEBIMENTO_FANTASMA",
                "Gerencial já convertida voltou como recebimento e está sendo contada em dobro: " + lista(fantasmas.map((l) => l.numero + " (" + reais(l.total) + ")"), 5) + ".");
            const reaparecidas = linhas.filter((l) => l.tipo === "gerencial" && suprimidas.has(semZeros(l.numero)));
            verificar(reaparecidas.length === 0, "critico", "GERENCIAL_SUPRIMIDA_NA_LISTA",
                "Gerencial marcada como convertida continua na lista: " + lista(reaparecidas.map((l) => l.numero), 5) + ".");

            // Gerencial e NFC-e/NF-e de mesmo valor, emitida logo depois, que a reconciliação não ligou.
            const docsFiscais = linhas.filter((l) => l.tipo === "nfc-e" || l.tipo === "nf-e");
            const usados = new Set();
            const pares = [];
            for (const g of linhas.filter((l) => l.tipo === "gerencial")) {
                const gm = minutos(g.hora);
                if (gm === null) continue;
                for (let i = 0; i < docsFiscais.length; i++) {
                    const d = docsFiscais[i];
                    const dm = minutos(d.hora);
                    if (usados.has(i) || dm === null || d._dtKey !== g._dtKey) continue;
                    if (Math.abs(Number(d.total) - Number(g.total)) > 0.01 || dm - gm < 0 || dm - gm > toleranciaMin) continue;
                    if (vendedoresDiferentes(g.vendedor, d.vendedor)) continue; // ex.: VENDEDOR A × VENDEDOR B — vendas distintas
                    if (itensIncompativeis(g, d)) continue; // itens sem nada em comum — vendas distintas
                    usados.add(i);
                    pares.push("gerencial " + g.numero + " × " + d.tipo + " " + d.numero + " (" + reais(g.total) + ")");
                    break;
                }
            }
            verificar(pares.length === 0, "aviso", "POSSIVEL_DUPLICIDADE",
                pares.length + " possível(is) duplicidade(s) Gerencial × NFC-e/NF-e (mesmo valor, até " + toleranciaMin + " min depois): " + lista(pares, 4) + ". Confira se a gerencial já foi convertida.");

            verificar(dedupAmbiguos.length === 0, "info", "NFE_MESMO_VALOR",
                dedupAmbiguos.length + " grupo(s) de NF-e com mesmo valor e data mantidos separados (" + lista(dedupAmbiguos.map((g) => g.join(" / ")), 3) + "): confira se alguma é duplicada.");

            verificar(dedupFundidas.length === 0, "info", "NFE_FUNDIDA",
                dedupFundidas.length + " NF-e fundida(s) por virem das duas tabelas com números diferentes (" + lista(dedupFundidas.map((f) => f.de + " → " + f.para + " " + reais(f.total)), 3) + ").");

            // 4) Situação fiscal que o operador precisa saber.
            verificar(nfeRejeitadas.length === 0, "aviso", "NFE_REJEITADA",
                nfeRejeitadas.length + " NF-e rejeitada(s) pela SEFAZ fora do relatório: " + lista(nfeRejeitadas.map((r) => r.numero + " (" + reais(r.total) + ")"), 4) + ". Reemita ou confira a venda.");
        } catch (erroInterno) {
            alertar("aviso", "AUTOTESTE_FALHOU", "O auto-teste não conseguiu terminar: " + String((erroInterno && erroInterno.message) || erroInterno));
        }
        return { verificacoes, achados };
    };
    // <AUTOTESTE-FIM>

    // Registra o resultado no log SÓ quando muda (uma geração acontece a cada venda nova;
    // repetir o mesmo alerta em cada uma empurraria o que importa para fora do relatorio.log).
    // O estado fica num arquivo ao lado do script; falha de leitura/gravação é tolerada —
    // o pior caso é repetir uma linha de log.
    const registrarAutoTeste = (resultado, opcoes) => {
        const MAX_CHAVES_ESTADO = 30;
        const arquivoEstado = require("node:path").join(__dirname, "autoteste-estado.json");
        const alertas = resultado.achados.filter((a) => a.nivel !== "info");
        const assinatura = alertas.map((a) => a.codigo + ":" + a.msg).join("|");
        const estado = Object.create(null);
        tentarSilencioso(() => {
            const bruto = JSON.parse(fs.readFileSync(arquivoEstado, "utf8").replace(/^\uFEFF/, ""));
            if (bruto && typeof bruto === "object") {
                for (const [k, v] of Object.entries(bruto)) if (typeof v === "string") estado[k] = v;
            }
        });
        const anterior = estado[opcoes.chave];
        const mudou = anterior === undefined ? assinatura !== "" : anterior !== assinatura;
        if (mudou) {
            if (alertas.length) {
                for (const a of alertas) console.log("AUTOTESTE [" + a.nivel.toUpperCase() + "] " + a.codigo + ": " + a.msg);
            } else {
                console.log("AUTOTESTE: normalizado — nenhum alerta (" + resultado.verificacoes + " verificações).");
            }
            delete estado[opcoes.chave];
            estado[opcoes.chave] = assinatura;
            const chaves = Object.keys(estado);
            for (const k of chaves.slice(0, Math.max(0, chaves.length - MAX_CHAVES_ESTADO))) delete estado[k];
            const tmp = arquivoEstado + ".tmp";
            tentarSilencioso(() => {
                fs.writeFileSync(tmp, JSON.stringify(estado, null, 2), "utf8");
                fs.renameSync(tmp, arquivoEstado);
            });
        } else if (opcoes.debug) {
            console.log("AUTOTESTE: " + resultado.verificacoes + " verificações, " + alertas.length + " alerta(s) (sem mudança desde a última geração).");
        }
        if (opcoes.debug) {
            for (const a of resultado.achados.filter((x) => x.nivel === "info")) console.log("AUTOTESTE [INFO] " + a.codigo + ": " + a.msg);
        }
    };

    // Número de NF-e para exibição: NUMERONF de 12 dígitos = 9 do número + 3 da série.
    const numeroNfeParaExibir = (bruto) => {
        const raw = String(bruto || "").trim();
        if (/^\d{12}$/.test(raw)) {
            const n = parseInt(raw.substring(0, 9), 10);
            return isNaN(n) ? raw : String(n).padStart(6, "0");
        }
        const semZero = raw.replace(/^0+/, "");
        return semZero ? semZero.padStart(6, "0") : raw;
    };

    // Converte campo de data do Firebird (pode chegar como Date JS ou string) para ISO YYYY-MM-DD.
    // node-firebird retorna campos DATE como objetos Date cujo .toString() é "Wed Apr 08 2026…",
    // quebrando o teste /^\d{4}-\d{2}-\d{2}$/. Usando getUTC* evitamos shift de fuso horário.
    // _pad2: helper único — elimina 5 redefinições de `const p = n => ...`
    const _pad2 = n => String(n).padStart(2, "0");

    const toISO = (val) => {
        if (!val) return "";
        if (val instanceof Date) {
            return `${val.getUTCFullYear()}-${_pad2(val.getUTCMonth()+1)}-${_pad2(val.getUTCDate())}`;
        }
        const s = String(val).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;                     // já ISO
        if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.substring(0, 10);    // ISO com hora
        const d = new Date(s);                                             // fallback: parsear
        if (!isNaN(d.getTime())) {
            return `${d.getUTCFullYear()}-${_pad2(d.getUTCMonth()+1)}-${_pad2(d.getUTCDate())}`;
        }
        return s.substring(0, 10);
    };


    // Escalona timeouts conforme o intervalo solicitado — períodos grandes (ex: 1/4–15/4)
    // precisam de muito mais tempo para ALTERACA/PAGAMENT/ITENS001 com centenas de registros.
    // Fórmula: 60s por dia (global) / 45s por dia (query), mínimo 90s/80s, máximo 15min/10min.
    const _diasIntervalo = Math.max(1, Math.round(
        (new Date(dataFimISO).getTime() - new Date(dataInicioISO).getTime()) / 86400000
    ) + 1);
    // CONTRATO: aceita --timeout do servidor para sincronizar o tempo máximo de
    // execução deste processo filho. Se não fornecido, calcula pelo intervalo de
    // datas (comportamento anterior). Garante que o filho nunca exceda o timeout
    // configurado no servidor (com margem de 5s para o filho reportar erro antes).
    const _timeoutCli   = parseInt(pegar("--timeout") || "0", 10);
    const _tGlobalCalc   = Math.min(Math.max(90000, _diasIntervalo * 60000), 900000);
    const _tGlobal = (_timeoutCli >= 30000) ? Math.min(_timeoutCli - 5000, _tGlobalCalc) : _tGlobalCalc;
    const _tQuery  = Math.min(Math.max(80000, _diasIntervalo * 45000), Math.round(_tGlobal * 0.85));

    // Timeout global
    const _globalTimeout = setTimeout(() => {
        const minutos = Math.round(_tGlobal / 60000);
        console.log(`\nERRO: Tempo limite excedido (${minutos} min). O banco de dados nao respondeu.`);
        console.log("Verifique se o Firebird esta rodando em " + host + ":" + FIREBIRD_PORT + " e se o arquivo FDB existe:");
        console.log("  " + dbPath);
        process.exit(1);
    }, _tGlobal);
    _globalTimeout.unref(); // nao impede o processo de terminar normalmente se tudo der certo

	// Transação explícita SOMENTE LEITURA, READ COMMITTED com rec_version e sem
	// espera (ver _somenteLeitura, no topo): o relatório nunca escreve no banco e
	// nunca fica esperando transações abertas do PDV. (Antes passava
	// ISOLATION_READ_UNCOMMITTED, que no node-firebird 1.x abre transação de
	// ESCRITA com espera — o oposto do que este comentário prometia.)
	// Aceita timeoutMs opcional — usado para escalonar por intervalo de datas.
	// Campo de texto exibido na tela, pedido como BYTES (OCTETS): o driver devolve
	// Buffer em qualquer versão (1.x/2.x) e "decoder" acima escolhe a codificação.
	// Pedido como texto, uma coluna NONE com "í" Windows-1252 chega já estragada.
	// Cast DIRETO para OCTETS (cabe até 4 bytes/char): um cast intermediário para
	// varchar sem charset faz o Firebird 3 recusar coluna NONE ("Malformed string").
	// Testado com node-firebird 1.1.9, 2.0.0 e 2.18.2 e colunas NONE/UTF8/WIN1252.
	const _txt = (expr, tam) => `cast(${expr} as varchar(${tam * 4}) character set octets)`;
	// Firebird que recusar a conversão para OCTETS: a consulta é refeita sem ela
	// (comportamento anterior) e as próximas já saem sem — nunca derruba a geração.
	const _RE_OCTETS = / character set octets/gi;
	const _RE_ERRO_OCTETS = /octets|transliterat|character set|charset|malformed|conversion|truncation|arithmetic/i;
	let _octetsRecusado = false;
	const query = (db, sql, params, timeoutMs) => {
		const _temOctets = typeof sql === "string" && _RE_OCTETS.test(sql);
		_RE_OCTETS.lastIndex = 0;
		if (_temOctets && _octetsRecusado) sql = sql.replace(_RE_OCTETS, "");
		return _queryBase(db, sql, params, timeoutMs).then((r) => {
			if (!r.e || !_temOctets || _octetsRecusado || !_RE_ERRO_OCTETS.test(String(r.e.message || r.e))) return r;
			_octetsRecusado = true;
			console.log("AVISO TEXTO: o banco recusou ler texto como bytes (" + String(r.e.message || r.e).slice(0, 160) + ") — seguindo com a leitura antiga (acentos podem sair errados).");
			return _queryBase(db, sql.replace(_RE_OCTETS, ""), params, timeoutMs);
		});
	};
	const _queryBase = (db, sql, params, timeoutMs) => new Promise((resolve, reject) => {
		const _qt = setTimeout(() => {
			const seg = Math.round((timeoutMs || _tQuery) / 1000);
			reject(new Error(`Timeout na query apos ${seg}s. Conexao pode estar travada.`));
		}, timeoutMs || _tQuery);
		db.transaction(null, (errTx, tx) => {
			if (errTx) {
				clearTimeout(_qt);
				return resolve({ e: errTx, rows: [] });
			}
			tx.query(sql, params || [], (e, rows) => {
				clearTimeout(_qt);
				tx.rollback(() => {}); // leitura pura: rollback libera sem overhead de commit
				if (rows) {
					for (let i = 0; i < rows.length; i++) {
						for (const key of Object.keys(rows[i])) {
							if (Buffer.isBuffer(rows[i][key])) {
								rows[i][key] = decoder.decode(rows[i][key]);
							}
						}
					}
				}
				resolve({ e, rows: rows || [] });
			});
		});
	});
	
	const parseBR = (iso, raw) => {
		let m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
		if (m) return `${m[3]}/${m[2]}/${m[1]}`;
		m = String(raw || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
		if (m) return `${m[1]}/${m[2]}/${m[3]}`;
		return String(raw || iso || "");
	};
	
	const dataInicioBR = parseBR(dataInicioISO, dataInicioRaw);
	const dataFimBR = parseBR(dataFimISO, dataFimRaw);
	const dataBR = dataInicioISO === dataFimISO ? dataInicioBR : `${dataInicioBR} até ${dataFimBR}`;

	const _agora         = new Date();
	const horaGeradaBR   = `${_pad2(_agora.getHours())}:${_pad2(_agora.getMinutes())}`;
	const _hojeISO       = `${_agora.getFullYear()}-${_pad2(_agora.getMonth()+1)}-${_pad2(_agora.getDate())}`;
	const diaMesGeradaBR = `${_pad2(_agora.getDate())}/${_pad2(_agora.getMonth()+1)}`;
	const ano2           = String(_agora.getFullYear()).slice(-2);

	const TOLERANCIA_RELOGIO_MIN = 3;    // ate 3 min atrasado -> aceita como esta (OK)
	// REGRA DE HORA FIXA (v2.7.5) — alinhada com servidor-relatorio.js v2.7.7 e
	// com a regra descrita pelo usuário:
	//   hora acima da atual (futuro)      -> corrige para a hora atual
	//   ate 3 min atras                    -> aceita como esta (marca OK)
	//   entre 3 min e a janela atras       -> corrige para a hora atual
	//   mais antigo que a janela           -> ignora (fora da janela)
	// A janela é configurável (v3.3.0): "janelaCorrecaoHoraMin" no config.json,
	// padrão 180 min (3 horas) — antes era fixa em 1 hora.
	// Antes eram 1,5 min de tolerancia e 18 min de janela, valores que nao
	// batiam nem com a regra pedida nem com a janela usada pelo servidor.
	const MAXIMO_ATRASO_MIN      = cfgJanelaHoraMin; // janela: mais antigo que isso -> ignora
	// LINHA DE BASE (v3.7.0): o servidor passa --linha-de-base na 1ª geração do dia
	// após ligar, reconectar ou trocar de banco. Nela, venda de hoje que ainda não
	// está no cache é só REGISTRADA como está (OK) — não dá para saber se a hora
	// dela estava errada quando chegou. Só hora no futuro continua corrigida.
	// Sem isso, ligar o servidor no meio do dia "corrigia" para a hora atual
	// todas as vendas legítimas das últimas horas. A correção é só na tela:
	// nada é gravado no banco (ver _somenteLeitura).
	const _LINHA_DE_BASE = args.includes("--linha-de-base");
	// Correções feitas nesta geração — o servidor mostra o aviso na tela.
	const _correcoesHora = [];

	// ── CACHE DE HORAS DO PDV ─────────────────────────────────────────────────
	// Quando uma venda de hoje tem hora futura (relógio do PDV adiantado), capamos
	// à hora atual. O problema: a cada atualização do relatório a hora avança,
	// fazendo a venda flutuar para o topo da lista. Para evitar isso, persistimos
	// a PRIMEIRA hora capada em um arquivo JSON — todas as execuções seguintes
	// reutilizam essa hora fixada, mantendo a venda em posição estável.
	// Entradas de dias anteriores são descartadas automaticamente na gravação.
	//
	// FORMATO FIX (ajuste solicitado — ordenação + bug de gerenciais ignorados):
	// o valor era antes uma STRING solta ("OK" ou "HH:MM"). servidor-relatorio.js
	// (correção de gerencial via poll) gravava a marca de tolerância como "ok"
	// minúsculo, enquanto esta comparação abaixo (`_cached === "OK"`) exigia
	// maiúsculo exato — toda venda gerencial marcada como "tolerável" pelo
	// servidor era lida aqui como se "ok" fosse a PRÓPRIA HORA da venda,
	// corrompendo a hora exibida e efetivamente perdendo a correção daquela
	// venda dali em diante (o sintoma relatado: "gerenciais ignorados").
	// Também não havia como ordenar o arquivo por tipo (nfc-e antes de
	// gerencial) sem essa informação. Agora o valor é {tipo, hora}, e
	// _ordenarHoraCache() (chamada sempre antes de salvar) reordena as
	// chaves do objeto nessa ordem — nfc-e, nf-e, gerencial, ascendente por
	// hora dentro de cada grupo — refletida diretamente no arquivo em disco.
	// Compatibilidade: entradas antigas (string solta) continuam sendo lidas
	// corretamente por _normalizarEntradaHoraCache; não é necessário migrar
	// o arquivo manualmente. ESPELHA servidor-relatorio.js (procure por
	// "HORA_CACHE_OK" lá) — duplicado de propósito, um processo de longa
	// duração e um subprocesso descartável não compartilham módulo.
	const HORA_CACHE_OK = "OK";
	const _normalizarEntradaHoraCache = (bruto) => {
		if (bruto && typeof bruto === "object" && !Array.isArray(bruto)) {
			const horaObj = String(bruto.hora == null ? "" : bruto.hora).trim();
			return {
				tipo: String(bruto.tipo || "desconhecido"),
				hora: horaObj.toUpperCase() === HORA_CACHE_OK ? HORA_CACHE_OK : horaObj
			};
		}
		const s = String(bruto == null ? "" : bruto).trim();
		return { tipo: "desconhecido", hora: s.toUpperCase() === HORA_CACHE_OK ? HORA_CACHE_OK : s };
	};
	// Ordem pedida (v2.6.5): gerencial primeiro, depois nfc-e, por último nf-e.
	const _HORA_CACHE_TIPO_RANK = { gerencial: 0, nfce: 1, nfe: 2 };
	// Extrai o número do documento a partir da chave "YYYY-MM-DD|numero".
	// Retorna null se não conseguir parsear como inteiro (chave em formato
	// inesperado) — nesse caso o desempate final por string cuida do resto.
	const _numeroDaChaveHoraCache = (chave) => {
		const partes = String(chave).split("|");
		const n = parseInt(partes.length > 1 ? partes[1] : chave, 10);
		return isNaN(n) ? null : n;
	};
	const _ordenarHoraCache = (cacheObj) => {
		const chaves = Object.keys(cacheObj);
		chaves.sort((a, b) => {
			const ea = _normalizarEntradaHoraCache(cacheObj[a]);
			const eb = _normalizarEntradaHoraCache(cacheObj[b]);
			const ra = _HORA_CACHE_TIPO_RANK.hasOwnProperty(ea.tipo) ? _HORA_CACHE_TIPO_RANK[ea.tipo] : 99;
			const rb = _HORA_CACHE_TIPO_RANK.hasOwnProperty(eb.tipo) ? _HORA_CACHE_TIPO_RANK[eb.tipo] : 99;
			if (ra !== rb) return ra - rb;
			// AJUSTE (v2.6.5): dentro do mesmo tipo, ordem DECRESCENTE por número
			// do documento (do maior para o menor) — o mais recente primeiro, já
			// que o número é sequencial por natureza.
			const na = _numeroDaChaveHoraCache(a);
			const nb = _numeroDaChaveHoraCache(b);
			if (na !== null && nb !== null && na !== nb) return nb - na;
			return a < b ? 1 : (a > b ? -1 : 0); // desempate final determinístico (também decrescente)
		});
		const ordenado = Object.create(null);
		chaves.forEach((k) => { ordenado[k] = cacheObj[k]; });
		return ordenado;
	};

	const _horaCacheFile = require("node:path").join(__dirname, "hora-fixada-cache.json");
	// Object.create(null): sem protótipo — imune a prototype pollution
	let _horaCache = Object.create(null);
	try {
		const _rawHC = fs.readFileSync(_horaCacheFile, "utf8").replace(/^\uFEFF/, "");
		const _parsedHC = JSON.parse(_rawHC);
		// Mantém somente entradas de hoje — purga dias anteriores.
		// FORMATO FIX: aceita tanto string solta (formato antigo) quanto
		// {tipo,hora} (formato novo) — a checagem anterior (`typeof val ===
		// "string"`) descartava silenciosamente qualquer entrada gravada no
		// formato novo por servidor-relatorio.js, tornando aquelas correções
		// de gerencial invisíveis para este processo.
		if (_parsedHC && typeof _parsedHC === "object") {
			for (const [k, val] of Object.entries(_parsedHC)) {
				if (typeof k === "string" && k.startsWith(_hojeISO + "|") && (typeof val === "string" || (val && typeof val === "object"))) {
					_horaCache[k] = val;
				}
			}
		}
	} catch(e) {
		// ENOENT (arquivo ainda não existe) é o caso normal na primeira execução
		// do dia — não merece aviso. Qualquer outro erro (JSON corrompido,
		// permissão negada etc.) é silenciosamente ignorado no fluxo (o cache
		// é só uma otimização, não é crítico), mas o operador merece saber que
		// o cache de hora fixada não pôde ser lido, para investigar se as
		// vendas do dia começarem a "flutuar" de posição a cada atualização.
		if (e && e.code !== "ENOENT") {
			console.warn("[AVISO] hora-fixada-cache.json não pôde ser lido (" + (e.message || e) + ") — cache de hora fixada será reconstruído do zero.");
		}
	}
	// Chaves criadas/alteradas NESTA execução — só elas são gravadas no fim
	// (ver a mescla com o disco antes da gravação).
	const _horaChavesAlteradas = new Set();
	// Situação de cada venda do dia (ver "SITUAÇÃO NO hora-fixada-cache.json"):
	// chave -> null (ativa) | {situacao: "cancelada"|"convertida", convertidaEm?}.
	const _horaSituacoes = new Map();
	const _definirHoraCache = (chave, valor) => {
		_horaCache[chave] = valor;
		_horaChavesAlteradas.add(chave);
	};
	// ──────────────────────────────────────────────────────────────────────────

	let _dbRef = null;
	process.on("unhandledRejection", (reason) => {
		clearTimeout(_globalTimeout);
		console.log("\nERRO inesperado: " + String((reason && reason.message) || reason));
		tentarSilencioso(() => { if (_dbRef) { _dbRef.detach(); _dbRef = null; } });
		process.exit(1);
	});

	const rodar = async () => {
		const opts = {
			host: host,
			port: FIREBIRD_PORT,
			database: dbPath,
			user: usuario,
			password: senha,
			role: null,
			pageSize: 4096,
			charset: "UTF8",
			// READ COMMITTED: lê dados confirmados no momento da query, sem
			// montar snapshot — essencial para não travar ao consultar dados
			// do dia atual enquanto o PDV está gravando ativamente.
			isolation: Firebird.ISOLATION_READ_COMMITTED
		};
		

			// ── runConn: abre conexão Firebird, executa asyncFn, fecha. ─────────────────
			// Nunca rejeita: resolve com { e, rows:[] } em qualquer erro — erros críticos
			// checados após Promise.all. Timeout de 10s no attach previne que uma conexão
			// travada segure o Promise.all indefinidamente (ex: banco reiniciando).
			const runConn = asyncFn => new Promise(resolve => {
				let _settled = false;
				const _settle = r => { if (!_settled) { _settled = true; resolve(r); } };
				const _attachWd = setTimeout(() => {
					_settle({ e: new Error("runConn attach timeout 10s"), rows: [] });
				}, 10000);
				try {
					Firebird.attach(opts, async (e2, db2) => {
						clearTimeout(_attachWd);
						if (e2) { _settle({ e: e2, rows: [] }); return; }
						try {
							const r = await asyncFn(db2);
							tentarSilencioso(() => db2.detach());
							_settle(r);
						} catch (eRun) {
							tentarSilencioso(() => db2.detach());
							_settle({ e: eRun, rows: [] });
						}
					});
				} catch(syncErr) {
					clearTimeout(_attachWd);
					_settle({ e: syncErr, rows: [] });
				}
			});

		console.log(`Conectando em: Host: ${host} | Banco: ${dbPath}`);

		Firebird.attach(opts, async function(err, db) {
			if (err) {
				clearTimeout(_globalTimeout);
				console.log("Falha ao conectar: " + String(err.message || err));
				console.log("Verifique se o Firebird esta rodando em " + host + ":" + FIREBIRD_PORT);
				process.exit(1);
			}
			_dbRef = db;
			console.log("Conectado! Executando consultas...");
			const _t0 = Date.now();
			// LOG FIX (v2.6.8): a cronometragem por etapa só é impressa quando o
			// servidor passa "--debug" (ele repassa o logDebug do config.json).
			// São 7 linhas POR GERAÇÃO — e uma geração acontece a cada venda nova.
			// Numa loja em movimento isso domina o relatorio.log e empurra para
			// fora a informação que de fato importa, pela rotação do arquivo.
			// Continua disponível para investigar desempenho: basta ligar
			// "logDebug": true no config.json.
			const _DEBUG_LOG = process.argv.includes("--debug");
			const tick = label => { if (_DEBUG_LOG) console.log(`  >> ${label}: ${Date.now() - _t0}ms acumulado`); };
			const camposCache = new Map();
			const camposTabela = async nome => {
				const n = String(nome || "").trim().toUpperCase();
				if (camposCache.has(n)) return camposCache.get(n);
				const rr = await query(db, "select trim(rf.rdb$field_name) as C from rdb$relation_fields rf where trim(rf.rdb$relation_name)=?", [n]);
				const set = new Set();
				if (!rr.e && rr.rows)
					for (const r of rr.rows) {
						const c = String(r.C ?? "").trim().toUpperCase();
						if (c && IDENTIFICADOR_SQL_SEGURO.test(c)) set.add(c);
					}
				camposCache.set(n, set);
				return set;
			};
			const camposNfce = await camposTabela("NFCE");
			const validCols = ["NUMERONF", "CONTROLE", "GERENCIAL", "PEDIDO"].filter(c => camposNfce.has(c));
			const colsSelect = validCols.length > 0 ? ", " + validCols.map(c => `cast(n.${c} as varchar(30)) as VAL_${c}`).join(", ") : "";
			const campoVendedorNfce = camposNfce.has("VENDEDOR") ? _txt("n.VENDEDOR", 60) : "cast(null as varchar(60))";
			const campoCaixa = camposNfce.has("CAIXA") ? "CAIXA" : (camposNfce.has("NUMCAIXA") ? "NUMCAIXA" : "null");
			const selCaixa = campoCaixa !== "null" ? `cast(n.${campoCaixa} as varchar(20))` : `cast('' as varchar(20))`;

			const campoCancelado = camposNfce.has("CANCELADO") ? "cast(n.CANCELADO as varchar(1))" : "'N'";
			const campoSituacao  = camposNfce.has("SITUACAO")  ? "cast(n.SITUACAO as varchar(1))"  : "''";
			const campoEmissao   = camposNfce.has("EMISSAO")   ? "cast(n.EMISSAO as varchar(1))"   : "''";

			let colHoraReal = Array.from(camposNfce).find(c => c.includes("HORA") || c === "HR");
			const campoHora = colHoraReal
				? `cast(n.${colHoraReal} as varchar(8))`
				: `substring(cast(n.data as varchar(24)) from 12 for 5)`;

			// Campo nome do cliente (NF-e) — tenta nomes comuns
			const _clienteCandidatos = ["NOMECLIENTE","CLIENTE","NOME_CLIENTE","NOMECLI","RAZAOSOCIAL","RAZAO_SOCIAL","NOMEDESTINATARIO"];
			const campoClienteNome = _clienteCandidatos.find(c => camposNfce.has(c)) || null;
			const selClienteNome   = campoClienteNome ? _txt(`n.${campoClienteNome}`, 80) : `cast('' as varchar(80))`;

			// Campo natureza da operação (NF-e)
			const _naturezaCandidatos = ["NATUREZA","NATOP","NATUREZA_OP","NAT_OP","NATOPERACAO","NATUREZAOP"];
			const campoNaturezaOp = _naturezaCandidatos.find(c => camposNfce.has(c)) || null;
			const selNaturezaOp   = campoNaturezaOp ? _txt(`n.${campoNaturezaOp}`, 60) : `cast('' as varchar(60))`;

			const nfceSql = `
			select
			  n.data as DATA,
			  coalesce(n.modelo, 65) as MODELO,
			  n.total as TOTAL,
			  ${selCaixa} as CAIXA,
			  ${campoVendedorNfce} as VENDEDOR_NFCE,
			  ${campoCancelado} as CANC,
			  ${campoSituacao} as SIT,
			  ${campoEmissao} as EMI,
			  ${campoHora} as HORA,
			  ${selClienteNome} as CLI_NOME,
			  ${selNaturezaOp}  as NAT_OP
			  ${colsSelect}
			from nfce n
			where n.data between cast(? as date) and cast(? as date)
			  and coalesce(n.modelo, 65) in (99, 65, 55)
			`;
			const camposAlt = await camposTabela("ALTERACA");
			const campoVendAlt  = camposAlt.has("VENDEDOR")  ? _txt("VENDEDOR", 60)  : "cast(null as varchar(60))";
			const campoHoraAlt  = camposAlt.has("HORA")      ? "cast(HORA as varchar(8))"        : "cast('' as varchar(8))";
			// Campo de total por item: preferência TOTAL > PRECO (×QUANTIDADE) > null
			const campoTotalAlt = camposAlt.has("TOTAL")
				? "cast(TOTAL as double precision)"
				: camposAlt.has("PRECO")
					? "cast(PRECO as double precision) * cast(coalesce(QUANTIDADE,1) as double precision)"
					: "cast(null as double precision)";
			// Flag: se não há campo de preço disponível, não tenta somar
			const _temPrecoAlt = camposAlt.has("TOTAL") || camposAlt.has("PRECO");

			const fmtQtd = v => {
				const n = Number(v || 0);
				if (!Number.isFinite(n)) return "0";
				const r = Math.round(n);
				if (Math.abs(n - r) < 1e-9) return String(r);
				let s = String(n);
				if (s.indexOf("e") >= 0 || s.indexOf("E") >= 0) s = n.toFixed(4);
				s = s.replace(/0+$/, "").replace(/\.$/, "");
				return s.replace(".", ",");
			};

			const altSql = `
			select DATA, cast(PEDIDO as varchar(30)) as PED, cast(CAIXA as varchar(10)) as CX,
			       ${_txt("DESCRICAO", 400)} as DESCRICAO, QUANTIDADE, ${campoVendAlt} as VENDEDOR_ALT, ${campoHoraAlt} as HORA_ALT,
			       ${campoTotalAlt} as TOTAL_ITEM
			from ALTERACA
			where DATA between cast(? as date) and cast(? as date)
			order by DATA, PEDIDO, ITEM
			`;
			// pagSql UNIFICADO — retorna linhas brutas sem GROUP BY nem list().
			// Uma única varredura da tabela substitui dois queries separados:
			//   (a) forma='00' + valor<0  → _tot00Map (total real do SmallSoft)
			//   (b) demais formas + valor>0 → mapVendas extension (pagamentos reais)
			// Elimina totalSql como conexão paralela separada: menos attach overhead,
			// sem GROUP BY nem list() no Firebird → query mais rápida (~60-75ms vs 112ms).
			// Inclui forma='00' (antes excluída); exclui apenas '13' (Troco).
			const pagSql = `
			select
			  p.data as DATA,
			  cast(p.pedido as varchar(30)) as PEDIDO,
			  ${_txt("p.vendedor", 200)} as VENDEDOR,
			  cast(p.valor as double precision) as VALOR,
			  substring(trim(p.forma) from 1 for 2) as FORMA_PREF,
			  ${_txt(`trim(iif(
			    substring(trim(p.forma) from 1 for 2) between '00' and '99'
			    and substring(trim(p.forma) from 3 for 1) = ' ',
			    trim(substring(trim(p.forma) from 4)),
			    trim(p.forma)
			  ))`, 200)} as FORMA_NOME
			from pagament p
			where p.data between cast(? as date) and cast(? as date)
			  and p.valor is not null
			  and substring(p.forma from 1 for 2) <> '13'
			order by p.data, p.pedido
			`;
			// ── Inicia 2 conexões paralelas ─────────────────────────────────────────────
			// pagSql inclui '00' (tot real) → totalSql removido, de 3 conexões para 2.
			// ALTERACA: schema feito acima (~2ms) → altSql já construído → inicia agora.
			const _pPag = runConn(d2 => query(d2, pagSql, [dataInicioISO, dataFimISO]));
			const _pAlt = runConn(d2 => query(d2, altSql, [dataInicioISO, dataFimISO]));

			tick("inicio queries");
			const rNfce = await query(db, nfceSql, [dataInicioISO, dataFimISO]);
			tick("NFCE pronta");
			if (rNfce.e) {
				// PRECISÃO FIX (v2.6.4): detach() sem try/catch ANTES do console.log
				// engolia a mensagem de erro — se o detach lançasse (cenário provável,
				// já que a query acabou de falhar e a conexão pode estar morta), o
				// usuário recebia um stack trace cru em vez da causa real do problema.
				tentarSilencioso(() => db.detach());
				console.log("Erro na consulta NFCE: " + String(rNfce.e.message || rNfce.e));
				process.exit(1);
			}

			const mapVendas = new Map();
			const idIndex   = new Map();

			// VELOCIDADE FIX (v2.7.2): antes de descartar as linhas convertidas
			// (CANC='T'), guarda os dados de identificação delas. Quando o Small
			// Commerce converte uma gerencial em NFC-e, a linha nova (modelo 65)
			// nasce com VENDEDOR, HORA e NATUREZA VAZIOS e só é preenchida quando
			// a autorização volta da SEFAZ — o que pode demorar. Como a v2.7.1
			// passou a exibir essas vendas imediatamente (o dinheiro já entrou no
			// caixa), elas ficavam com "(sem vendedor)" e "não identificado" até
			// lá. A gerencial de origem, que está sendo descartada aqui, JÁ TEM
			// todos esses dados — e a coluna GERENCIAL da linha nova aponta
			// exatamente para ela. Este mapa permite herdar essa identificação na
			// hora, em vez de esperar a SEFAZ.
			const _origemConvertida = new Map(); // numero da gerencial -> {vendedor, hora, natureza, cliente}
			for (const n of rNfce.rows) {
				if (n.CANC !== 'T') continue;
				for (const c of validCols) {
					const val = String(n["VAL_" + c] || "").trim().replace(/^0+/, "");
					if (!val || _origemConvertida.has(val)) continue;
					_origemConvertida.set(val, {
						vendedor: String(n.VENDEDOR_NFCE || "").trim(),
						hora:     String(n.HORA || "").trim(),
						natureza: String(n.NAT_OP || "").trim(),
						cliente:  String(n.CLI_NOME || "").trim()
					});
				}
			}

			// BUG REAL (v2.7.8) — caso 061449 → NFC-e 124242, confirmado na tela nativa
			// do SmallSoft: a coluna GERENCIAL da linha 124242 (modelo 65) aponta
			// explicitamente para 061449, mas a gerencial de origem NÃO estava com
			// CANC='T' (só o loop acima, que exige CANC='T', preenche
			// _origemConvertida — e só serve pra HERDAR vendedor/hora, nunca pra
			// SUPRIMIR a gerencial duplicada). Resultado: 061449 continuava sendo
			// listada como venda própria, em cima da NFC-e que já é a mesma venda.
			//
			// Corrigido: monta um conjunto de números de gerencial que JÁ TÊM um
			// documento fiscal válido (modelo 65/55, não cancelado/rejeitado)
			// apontando pra eles via GERENCIAL — usando o vínculo direto do banco,
			// SEM depender do CANC da própria gerencial estar certo. Isso é uma
			// referência de chave real (não heurística de data/valor — ver aviso
			// na reconciliação por VENDAS logo abaixo, que É heurística e foi
			// rebaixada a apenas registrar aviso, por causa deste mesmo caso).
			// Duplicatas: gerenciais absorvidas por documento fiscal, coletadas para
			// exibir no painel "Duplicatas" do relatório (auditoria/transparência —
			// não muda o comportamento de supressão em si, só registra o que foi
			// suprimido/fundido nesta geração).
			const _duplicatasConfirmadas = [];
			const _duplicatasProvaveis = [];
			// Alimentam o auto-teste (executarAutoTeste) com o que a geração vê e o resultado final não mostra.
			const _nfeRejeitadas = [];  // NF-e rejeitadas pela SEFAZ deixadas de fora
			const _falhasLeitura = [];  // leituras do banco que falharam sem derrubar a geração
			const _dedupAmbiguos = [];  // grupos de NF-e de mesmo valor/data mantidos separados
			const _dedupFundidas = [];   // NF-e fundidas por virem das duas tabelas com números diferentes

			const _gerenciaisAbsorvidasPorDocFiscal = new Map(); // gerencial (id) -> {docNumero, docModelo}
			// Chaves "dt|número" de documentos fiscais que JÁ têm vínculo pela coluna
			// GERENCIAL — não entram na reconciliação final por valor (v3.8.3).
			const _docsComVinculo = new Set();
			if (validCols.includes("GERENCIAL")) {
				for (const n of rNfce.rows) {
					const _modeloDoc = Number(n.MODELO || 0);
					if (_modeloDoc !== 65 && _modeloDoc !== 55) continue; // só documento fiscal válido conta
					if (n.CANC === 'S' || n.CANC === 'T' || n.SIT === 'C' || n.EMI === 'C') continue; // o próprio doc não pode estar cancelado/rejeitado
					const _gVal = String(n.VAL_GERENCIAL || "").trim().replace(/^0+/, "");
					if (_gVal) {
						const _dtDoc = toISO(n.DATA);
						for (const c of validCols) {
							const _idDoc = String(n["VAL_" + c] || "").trim().replace(/^0+/, "");
							if (_idDoc && _idDoc !== _gVal) _docsComVinculo.add(_dtDoc + "|" + _idDoc);
						}
					}
					if (!_gVal || _gerenciaisAbsorvidasPorDocFiscal.has(_gVal)) continue;
					const _docNumero = validCols.map(c => String(n["VAL_" + c] || "").trim().replace(/^0+/, "")).find(v => v && v !== _gVal) || "?";
					_gerenciaisAbsorvidasPorDocFiscal.set(_gVal, { docNumero: _docNumero, docModelo: _modeloDoc });
				}
			}

			// SITUAÇÃO NO hora-fixada-cache.json (v3.8.0): a venda que já tinha hora
			// fixada e depois foi CANCELADA ou CONVERTIDA (gerencial → NFC-e/NF-e)
			// continuava no arquivo como se estivesse ativa. Aqui cada linha do dia
			// diz a situação da SUA chave (data|número próprio = ids[0], a mesma
			// chave do cache); a gravação no fim só atualiza chaves que já existem.
			const _tipoDoModelo = (m) => m === 65 ? "nfce" : m === 55 ? "nfe" : m === 99 ? "gerencial" : "desconhecido";
			const _situacaoCache = _horaSituacoes;
			for (const n of rNfce.rows) {
				const _idsL = validCols.map(c => String(n["VAL_" + c] || "").trim().replace(/^0+/, "")).filter(Boolean);
				const _idPr = _idsL[0];
				if (!_idPr) continue;
				const _ch = toISO(n.DATA) + "|" + _idPr;
				const _mod = Number(n.MODELO || 65);
				// Mesmo critério do laço principal: gerencial com documento fiscal
				// válido apontando para QUALQUER um dos seus números.
				const _dest = _mod === 99 ? _idsL.map(i => _gerenciaisAbsorvidasPorDocFiscal.get(i)).find(Boolean) : null;
				let _sit = null;
				// O vínculo GERENCIAL (documento válido) vem primeiro: o PDV pode marcar
				// a gerencial de origem como cancelada ('S') ao converter.
				if (_dest || n.CANC === 'T') {
					_sit = { situacao: "convertida" };
					if (_dest) _sit.convertidaEm = { tipo: _tipoDoModelo(_dest.docModelo), numero: String(_dest.docNumero) };
				} else if (n.CANC === 'S' || n.SIT === 'C' || n.EMI === 'C') {
					_sit = { situacao: "cancelada" };
				}
				// Mais de uma linha com a mesma chave: cancelada/convertida prevalece.
				if (!_situacaoCache.has(_ch) || _sit) _situacaoCache.set(_ch, _sit);
			}

			for (const n of rNfce.rows) {
				if (n.CANC === 'S' || n.CANC === 'T' || n.SIT === 'C' || n.EMI === 'C') continue; 
				const totalNum = Number(n.TOTAL || 0);
				// CAUSA RAIZ (v2.7.1) do "venda convertida aparecendo como Gerencial":
				// aqui havia "if (totalNum <= 0) continue;", que DESCARTAVA a nota
				// antes mesmo de ela entrar em mapVendas/idIndex.
				// Uma gerencial convertida em NFC-e gera, na tabela nfce, uma linha
				// modelo 65 com a coluna GERENCIAL preenchida — mas com TOTAL, STATUS
				// e chave ainda VAZIOS enquanto a autorização não volta da SEFAZ.
				// Descartada aqui, essa linha não existia no idIndex; o pagamento
				// correspondente não encontrava a venda e caía no "else" do Pass 2,
				// que fabrica um registro-fantasma com modelo 99 — exatamente a
				// "venda Gerencial" com número da faixa da NFC-e que aparecia na tela.
				//
				// CORREÇÃO DO ESCOPO (v2.7.4): o relaxamento acima vale APENAS para
				// documento fiscal (modelo 65/NFC-e e 55/NF-e), que é o único que
				// espera autorização da SEFAZ. A v2.7.1 relaxou para TODO modelo, e
				// isso trouxe de volta gerenciais (modelo 99) sem total que o filtro
				// original corretamente escondia — as ABERTAS (venda ainda em
				// andamento no caixa) e as CANCELADAS cujo status não está refletido
				// na coluna "cancelado" lida aqui. Elas reapareciam na lista com
				// total vindo dos itens do ALTERACA e, pior, rotuladas como
				// "aguardando autorização", conceito que não existe para gerencial.
				// Gerencial sem total volta a ser descartada, como antes.
				const _modeloLinha = Number(n.MODELO || 65);
				const _ehDocFiscal = _modeloLinha === 65 || _modeloLinha === 55;
				if (totalNum <= 0 && !_ehDocFiscal) continue;

				const ids = [];
				for (const c of validCols) {
					const val = String(n["VAL_" + c] || "").trim().replace(/^0+/, "");
					if (val && !ids.includes(val)) ids.push(val);
				}
				if (ids.length === 0) continue;

				// Gerencial (modelo 99) já convertida em documento fiscal válido, mesmo
				// que a própria linha da gerencial não esteja com CANC='T' — ver
				// comentário completo em _gerenciaisAbsorvidasPorDocFiscal acima.
				// Restrito a modelo 99 de propósito: um documento fiscal nunca deve
				// ser descartado por essa checagem, só a gerencial de origem.
				if (_modeloLinha === 99) {
					const _docAbsorvente = ids.map(id => _gerenciaisAbsorvidasPorDocFiscal.get(id)).find(Boolean);
					if (_docAbsorvente) {
						_duplicatasConfirmadas.push({
							gerencial: ids[0], docNumero: _docAbsorvente.docNumero, docModelo: _docAbsorvente.docModelo,
							// Campos extras (v2.9.0) — permitem ao cliente reconstituir a linha
							// da gerencial na tabela se o usuário escolher "manter" no painel
							// Duplicatas, sem precisar refazer os joins de PAGAMENT/ITENS.
							dt: toISO(n.DATA), hora: String(n.HORA || "").trim(),
							caixa: String(n.CAIXA || "").trim(),
							vendedor: String(n.VENDEDOR_NFCE || "").trim(),
							cliente: String(n.CLI_NOME || "").trim(),
							natureza: String(n.NAT_OP || "").trim(),
							total: totalNum
						});
						continue;
					}
				}

				const primaryId = ids[0];
				// toISO() normaliza Date JS e strings para YYYY-MM-DD
				// evita mismatch quando NFCE.data é TIMESTAMP e PAGAMENT.data é DATE
				const dt = toISO(n.DATA);
				const key = dt + "|" + primaryId;

				let caixa = String(n.CAIXA ?? "").trim();
				if (/^\d+$/.test(caixa) && caixa.length > 0 && caixa.length < 3) caixa = caixa.padStart(3, "0");

				// Herda identificação da gerencial de origem enquanto a NFC-e ainda
				// não foi autorizada (ver _origemConvertida acima). Só preenche o que
				// está VAZIO — dado já vindo da própria linha fiscal sempre prevalece.
				let _vendedorNf = String(n.VENDEDOR_NFCE || "").trim();
				let _horaNf     = String(n.HORA || "").trim();
				let _natNf      = String(n.NAT_OP || "").trim();
				let _cliNf      = String(n.CLI_NOME || "").trim();
				if (!_vendedorNf || !_horaNf || !_natNf) {
					for (const id of ids) {
						const _org = _origemConvertida.get(id);
						if (!_org) continue;
						if (!_vendedorNf && _org.vendedor) _vendedorNf = _org.vendedor;
						if (!_horaNf     && _org.hora)     _horaNf     = _org.hora;
						if (!_natNf      && _org.natureza) _natNf      = _org.natureza;
						if (!_cliNf      && _org.cliente)  _cliNf      = _org.cliente;
						break;
					}
				}

				mapVendas.set(key, {
					_dtKey: dt,
					vendedor: _vendedorNf,
					modelo: Number(n.MODELO || 65),
					numero: primaryId,
					caixa: caixa,
					hora: _horaNf,
					cliente: _cliNf,
					natureza: _natNf,
					total_nfce: totalNum,
					total_pag: 0,
					formas: [],
					// Marca a venda cuja NFC-e/NF-e ainda não foi autorizada pela SEFAZ
					// (TOTAL/STATUS/chave vazios na tabela nfce). Usado para exibir
					// um rótulo explicativo no lugar de "(sem vendedor)" / "não
					// identificado" enquanto os dados fiscais não chegam.
					// Restrito a documento fiscal de propósito: gerencial (modelo 99)
					// nunca passa por autorização da SEFAZ, então nunca deve receber
					// esse rótulo (ver correção de escopo acima).
					pendente_autorizacao: totalNum <= 0 && _ehDocFiscal,
					_fonte: "nfce" // usado só pela deduplicação de NF-e (ver "DEDUPLICAÇÃO NF-e")
				});

				for (const id of ids) idIndex.set(dt + "|" + id, key);
			}

			// ── VENDAS: NF-e modelo 55 ────────────────────────────────────────
			// Inserido ANTES do PAGAMENT para que idIndex tenha NSU→key
			// quando PAGAMENT tentar linkar (PAGAMENT.PEDIDO = VENDAS.NSU stripped).
			const _vendaNfeKey = new Map();
			// Reconciliação heurística Gerencial↔NF-e (v2.7.7) — populada abaixo,
			// consumida logo após o try/catch desta seção. Ver comentário completo
			// no ponto de uso.
			const _novasNfeParaReconciliar = [];
			const _aliasesGerencialAbsorvida = new Set(); // chaves "dt|pedido" cujo ALTERACA deve ser ignorado
			function _horaParaMinutos(h) {
				const s = String(h || "").trim();
				const m = s.match(/^(\d{1,2}):(\d{2})/);
				if (!m) return null;
				const hh = parseInt(m[1], 10), mm = parseInt(m[2], 10);
				if (isNaN(hh) || isNaN(mm)) return null;
				return hh * 60 + mm;
			}
			try {
				const _camV = await camposTabela("VENDAS");
				if (_camV.size > 0 && _camV.has("NUMERONF") && _camV.has("TOTAL")) {
					const _cVd  = _camV.has("SAIDAD")      ? "cast(v.SAIDAD as date)"           : "cast(v.EMISSAO as date)";
					const _cVv  = _camV.has("VENDEDOR")    ? _txt("v.VENDEDOR", 60)            : "cast(null as varchar(60))";
					const _cVc  = _camV.has("CLIENTE")     ? _txt("v.CLIENTE", 80)             : "cast('' as varchar(80))";
					const _cVop = _camV.has("OPERACAO")    ? _txt("v.OPERACAO", 60)            : "cast('' as varchar(60))";
					const _cVh  = _camV.has("SAIDAH")      ? "cast(v.SAIDAH as varchar(8))"     : "cast('' as varchar(8))";
					const _cVn  = _camV.has("NSU")         ? "cast(v.NSU as varchar(20))"       : "cast(null as varchar(20))";
					const _cVm  = _camV.has("MODELO")      ? "cast(v.MODELO as varchar(5))"     : "'55'";
					const _cVcc = _camV.has("DATA_CANCEL") ? "v.DATA_CANCEL"                    : "cast(null as date)";
					// NF-e REJEITADA pela SEFAZ (STATUS tipo "Rejeicao: ...", sem protocolo de
					// autorização) não é uma venda válida — quem continua valendo é a Gerencial
					// de origem, que nunca deixou de ser o documento da venda. Sem este filtro,
					// a rejeitada era contada JUNTO com a Gerencial (duplicidade + total inflado).
					// Coluna lida condicionalmente (camposTabela) para não quebrar em bases
					// onde STATUS não exista; filtro final é feito em JS abaixo (evita
					// depender de função de acentuação do Firebird na cláusula WHERE).
					const _cVstat = _camV.has("STATUS") ? _txt("v.STATUS", 200) : "cast(null as varchar(200))";
					const _rV = await query(db, `
						SELECT ${_cVd}  as DATA_V,
						       cast(v.NUMERONF as varchar(30)) as NF_NUM,
						       v.TOTAL  as TOTAL_V,
						       ${_cVv}  as VEND_V,
						       ${_cVc}  as CLI_V,
						       ${_cVop} as OP_V,
						       ${_cVh}  as HORA_V,
						       ${_cVn}  as NSU_V,
						       ${_cVcc} as CANCEL_V,
						       ${_cVstat} as STATUS_V
						FROM VENDAS v
						WHERE ${_cVd} BETWEEN cast(? as date) AND cast(? as date)
						  AND ${_cVm} = '55'
						  AND v.TOTAL > 0
					`, [dataInicioISO, dataFimISO]);
					tick("VENDAS NF-e");
					if (_rV.e) _falhasLeitura.push({ fonte: "VENDAS (NF-e)", detalhe: String(_rV.e.message || _rV.e) });
					if (!_rV.e && _rV.rows) {
						for (const vr of _rV.rows) {
							const _vTotal = Number(vr.TOTAL_V || 0);
							if (_vTotal <= 0) continue;
							// NF-e cancelada (antes filtrada no SQL): fica fora do relatório
							// como sempre, e a entrada dela no cache de hora ganha a situação.
							if (vr.CANCEL_V) {
								const _dtC = toISO(vr.DATA_V);
								const _nfC = String(vr.NF_NUM || "").trim();
								if (_dtC && _nfC) {
									_situacaoCache.set(_dtC + "|" + numeroNfeParaExibir(_nfC), { situacao: "cancelada" });
									_situacaoCache.set(_dtC + "|" + (_nfC.replace(/^0+/, "") || _nfC), { situacao: "cancelada" });
								}
								continue;
							}
							// Descarta NF-e rejeitada pela SEFAZ (ex.: "Rejeicao: Informado Cupom
							// Fiscal referenciado") — comparação em maiúsculas e sem acento para
							// cobrir "Rejeição"/"Rejeicao" e variações de charset do Firebird.
							const _statusNorm = String(vr.STATUS_V || "")
								.toUpperCase()
								.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
							if (_statusNorm.startsWith("REJEI")) {
								_nfeRejeitadas.push({ numero: numeroNfeParaExibir(vr.NF_NUM), total: _vTotal, status: String(vr.STATUS_V || "").trim() });
								continue;
							}
							const _nfRaw = String(vr.NF_NUM || "").trim();
							const _nfExib = numeroNfeParaExibir(_nfRaw);
							// SAIDAD via cast(…as date) pode retornar objeto Date JS cujo
						// .toString() é "Wed Apr 08 2026…" — usar toISO() garante YYYY-MM-DD.
						const _dtV = toISO(vr.DATA_V);
							if (!_dtV || !/^\d{4}-\d{2}-\d{2}$/.test(_dtV)) continue;
							const _keyV = _dtV + "|" + _nfExib;
							// Chave stripped (sem zeros à esquerda) — usada pelo PAGAMENT e às vezes
							// pela tabela NFCE. Sem este alias PAGAMENT cria linha duplicada de
							// "Recebimento de Título / Conta" para o mesmo cupom NF-e.
							const _nfStripped = _nfRaw.replace(/^0+/, "") || _nfRaw;
							const _keyStripped = _dtV + "|" + _nfStripped;

							// Caso A: NFCE já cadastrou esta NF-e com a chave stripped → mescla
							if (mapVendas.has(_keyStripped)) {
								const _ex = mapVendas.get(_keyStripped);
								if (!_ex.cliente)  _ex.cliente  = String(vr.CLI_V  || "").trim();
								if (!_ex.natureza) _ex.natureza = String(vr.OP_V   || "").trim();
								if ((!_ex.vendedor || _ex.vendedor === "?") && String(vr.VEND_V || "").trim())
									_ex.vendedor = String(vr.VEND_V).trim();
								// SAIDAH = hora de fechamento/lançamento real da venda (≠ hora de abertura do NFCE)
								const _hV = String(vr.HORA_V || "").trim().substring(0, 5);
								if (_hV && !_ex.horaFech) _ex.horaFech = _hV;
								idIndex.set(_keyV, _keyStripped);
								_vendaNfeKey.set(_nfRaw, _keyStripped);
								continue;
							}
							if (mapVendas.has(_keyV)) continue;
							const _nsuStr = String(vr.NSU_V || "").trim().replace(/^0+/, "");
							mapVendas.set(_keyV, {
								_dtKey: _dtV, vendedor: String(vr.VEND_V || "").trim(),
								modelo: 55, numero: _nfExib, caixa: "",
								hora: String(vr.HORA_V || "").trim().substring(0, 8),
								cliente: String(vr.CLI_V || "").trim(),
								natureza: String(vr.OP_V || "").trim(),
								total_nfce: _vTotal, total_pag: 0, formas: [],
								_fonte: "vendas" // usado só pela deduplicação de NF-e
							});
							idIndex.set(_keyV, _keyV);
							// Alias stripped → chave principal: PAGAMENT busca com número sem zeros
							if (_keyStripped !== _keyV) idIndex.set(_keyStripped, _keyV);
							if (_nsuStr) idIndex.set(_dtV + "|" + _nsuStr, _keyV);
							_vendaNfeKey.set(_nfRaw, _keyV);
							// Candidata para reconciliação heurística Gerencial↔NF-e (ver abaixo,
							// logo após este bloco try/catch) — NF-e AUTORIZADA (já filtramos
							// rejeitada acima) que não achou par direto na tabela nfce. Pode ser
							// o destino de uma Gerencial convertida sem nenhum vínculo gravado
							// no banco (schema desta versão do SmallSoft não grava referência
							// cupom↔NF-e em nenhuma coluna nem no XML — confirmado em diagnóstico).
							_novasNfeParaReconciliar.push({ key: _keyV, dt: _dtV, total: _vTotal, horaMin: _horaParaMinutos(vr.HORA_V) });
						}
					}
				}
			} catch(eV) { console.log("AVISO VENDAS: " + eV.message); _falhasLeitura.push({ fonte: "VENDAS (NF-e)", detalhe: String(eV.message || eV) }); }

			// ── Reconciliação Gerencial → NF-e sem vínculo no banco (v2.7.9) ──────────
			// CONTEXTO: para conversão Gerencial→NFC-e (mesma tabela nfce) existe vínculo
			// AUTORITATIVO — a coluna GERENCIAL (ver _gerenciaisAbsorvidasPorDocFiscal
			// acima, v2.7.8) — que resolve o caso sem qualquer chute.
			// Para conversão Gerencial→NF-e (modelo 55, tabela VENDAS externa) o schema
			// deste SmallSoft não grava vínculo nenhum — nem coluna, nem referência no XML.
			// REGRA DE NEGÓCIO (definida pelo usuário, v2.7.9): essas gerenciais são as
			// mesmas usadas pela automação do filtro [proibidos] (marcas da lista em
			// proibidosPadrao) — convertidas manualmente por fora do fluxo integrado, por
			// isso nunca terão vínculo de coluna. Nesse caso específico, valor idêntico no
			// mesmo dia é o sinal correto e deve SEMPRE prevalecer: a NF-e é mantida, a
			// Gerencial é suprimida.
			// TRAVA DE SEGURANÇA mantida (evita o problema que quase aconteceu — R$118,75
			// é preço de produto comum e se repete no dia): cada NF-e só pode absorver NO
			// MÁXIMO 1 gerencial. Com várias gerenciais candidatas ao mesmo valor, casa a
			// mais próxima em horário com cada NF-e disponível, uma de cada vez, e nunca
			// deixa duas gerenciais desaparecerem em cima do mesmo documento.
			const TOLERANCIA_VALOR = 0.01;      // R$ — mesma régua de arredondamento do resto do sistema
			const TOLERANCIA_MINUTOS = 20;      // janela de emissão da NF-e após o fechamento da gerencial
			// Vendedores diferentes = vendas diferentes (v3.8.2). Só vale quando os DOIS
			// são conhecidos: vazio, "?" e rótulos como "(aguardando autorização)" — a
			// NFC-e convertida chega sem vendedor até a SEFAZ autorizar — não descartam.
			const _vendedoresDiferentes = (a, b) => {
			    const norm = (v) => String(v == null ? "" : v).trim().toUpperCase()
			        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
			    const x = norm(a), y = norm(b);
			    const conhecido = (v) => v !== "" && v !== "?" && !v.startsWith("(");
			    return conhecido(x) && conhecido(y) && x !== y;
			};
			// Documentos (chave do mapVendas) que já absorveram 1 gerencial nesta
			// reconciliação — a passada final (v3.8.3) não os usa de novo.
			const _docsQueAbsorveram = new Set();
			if (_novasNfeParaReconciliar.length > 0) {
				const _nfeJaAbsorveu = new Set(); // key da NF-e -> já usada, não pode absorver 2ª gerencial
				// Ordena gerenciais por horário para casar de forma determinística
				// (mais cedo primeiro) quando há disputa pela mesma NF-e.
				const _gerenciais99 = [];
				for (const [gerKey, gerVenda] of mapVendas) {
					if (gerVenda.modelo !== 99) continue;
					const gerHoraMin = _horaParaMinutos(gerVenda.hora);
					if (gerHoraMin === null) continue;
					_gerenciais99.push({ gerKey, gerVenda, gerHoraMin });
				}
				_gerenciais99.sort((a, b) => a.gerHoraMin - b.gerHoraMin);

				for (const { gerKey, gerVenda, gerHoraMin } of _gerenciais99) {
					const candidatas = _novasNfeParaReconciliar.filter(c => {
						if (_nfeJaAbsorveu.has(c.key)) return false; // já usada por outra gerencial
						// Mesma data/valor mas vendedores diferentes: são duas vendas — absorver
						// a gerencial tiraria uma venda real do total do dia.
						const _alvoC = mapVendas.get(c.key);
						if (_alvoC && _vendedoresDiferentes(gerVenda.vendedor, _alvoC.vendedor)) return false;
						if (c.dt !== gerVenda._dtKey) return false;
						if (Math.abs(c.total - gerVenda.total_nfce) > TOLERANCIA_VALOR) return false;
						if (c.horaMin === null) return false;
						const diff = c.horaMin - gerHoraMin; // NF-e sempre emitida DEPOIS do fechamento
						return diff >= 0 && diff <= TOLERANCIA_MINUTOS;
					});
					if (candidatas.length === 0) continue;
					// Mais de uma disponível: escolhe a mais próxima em horário (menor diff).
					candidatas.sort((a, b) => (a.horaMin - gerHoraMin) - (b.horaMin - gerHoraMin));
					const escolhida = candidatas[0];
					const alvo = mapVendas.get(escolhida.key);
					if (!alvo) continue;
					// Herda identificação da gerencial só onde a NF-e ainda estiver vazia —
					// dado fiscal já presente na NF-e sempre prevalece.
					if (!alvo.vendedor && gerVenda.vendedor) alvo.vendedor = gerVenda.vendedor;
					if (!alvo.cliente  && gerVenda.cliente)  alvo.cliente  = gerVenda.cliente;
					alvo._gerencialOrigemNumero = gerVenda.numero;
					_nfeJaAbsorveu.add(escolhida.key);
					_docsQueAbsorveram.add(escolhida.key);
					// CORREÇÃO (v3.0.0) — recebimento duplicado: antes, o idIndex da gerencial
					// era apagado. Os pagamentos dela (PAGAMENT) deixavam de achar a venda e o
					// Pass 2 criava um "recebimento fantasma" (modelo 99, is_recebimento) com o
					// valor cheio — a mesma venda contada duas vezes no total do dia. Agora
					// TODOS os aliases que apontavam para a gerencial passam a apontar para a
					// NF-e: o pagamento é absorvido por ela. Os itens do ALTERACA dessa
					// gerencial são descartados (_aliasesGerencialAbsorvida) porque a NF-e já
					// traz os próprios itens via ITENS001 — senão apareceriam em dobro.
					for (const [alias, alvoKey] of [...idIndex.entries()]) {
						if (alvoKey === gerKey) { idIndex.set(alias, escolhida.key); _aliasesGerencialAbsorvida.add(alias); }
					}
					mapVendas.delete(gerKey);
					_situacaoCache.set(gerKey, { situacao: "convertida", convertidaEm: { tipo: "nfe", numero: String(alvo.numero).replace(/^0+/, "") || String(alvo.numero) } });
					const _obs = candidatas.length > 1 ? ` (${candidatas.length} candidatas disponíveis, escolhida a mais próxima)` : "";
					console.log(`RECONCILIACAO: Gerencial ${gerVenda.numero} absorvida pela NF-e ${alvo.numero} (mesma data/valor, ${escolhida.horaMin - gerHoraMin}min depois)${_obs}.`);
					_duplicatasProvaveis.push({
						gerencial: gerVenda.numero, docNumero: alvo.numero, docModelo: 55, diffMin: escolhida.horaMin - gerHoraMin,
						ambiguo: candidatas.length > 1,
						// Campos extras (v2.9.0) — ver comentário em _duplicatasConfirmadas.push acima.
						dt: gerVenda._dtKey, hora: gerVenda.hora, caixa: gerVenda.caixa,
						vendedor: gerVenda.vendedor, cliente: gerVenda.cliente,
						natureza: gerVenda.natureza, total: gerVenda.total_nfce
					});
				}
			}

			// ── Aguarda as 2 queries paralelas ──────────────────────────────────────────
			// Main conn já terminou NFCE+VENDAS; PAGAMENT é o bottleneck (~70ms sem GROUP BY).
			const [rPag, rrAlt] = await Promise.all([_pPag, _pAlt]);
			tick("queries paralelas prontas");
			if (rPag.e) {
				// PRECISÃO FIX (v2.6.4): mesmo caso do detach em rNfce acima — sem o
				// try/catch, uma falha ao encerrar a conexão escondia a mensagem que
				// explica por que a consulta PAGAMENT falhou.
				tentarSilencioso(() => db.detach());
				console.log("Erro na consulta PAGAMENT: " + String(rPag.e.message || rPag.e));
				process.exit(1);
			}
			// ── Processa linhas brutas de pagament em dois passes ────────────────────────
			// Pass 1: separa forma='00' (tot real) das demais, agrupando por data+pedido.
			// Pass 2: insere grupos no mapVendas.
			// Substitui GROUP BY + list() no SQL pelo JS (mais rápido no total).
			const _tot00Sums  = new Map(); // key → abs(sum(valor)) para forma='00'
			const _pagGroups  = new Map(); // key → {ped, vendedor, total, formas, formasValores}
			for (const p of rPag.rows) {
				const dt        = toISO(p.DATA);
				const ped0      = String(p.PEDIDO  || "").trim().replace(/^0+/, "");
				const valor     = Number(p.VALOR   || 0);
				const formaPref = String(p.FORMA_PREF || "").trim();
				// Para pedido vazio inclui vendedor na chave, replicando o GROUP BY
				// (data, pedido, vendedor) do SQL original — mantém avulsos separados por vendedor.
				const key0      = ped0 ? (dt + "|" + ped0) : (dt + "||v:" + String(p.VENDEDOR || "").trim());

				if (formaPref === "00" && valor < 0) {
					// Entrada de total real (balanceador negativo do SmallSoft)
					_tot00Sums.set(key0, (_tot00Sums.get(key0) || 0) + Math.abs(valor));
					continue;
				}
				if (valor <= 0) continue;

				const formaNomeRaw = String(p.FORMA_NOME || "").trim();
				const formaNome    = formaNomeRaw.replace(/^cartao(?: +|$)/i, "").trim() || formaNomeRaw;
				const vendPag      = String(p.VENDEDOR   || "").trim();

				if (!_pagGroups.has(key0)) {
					_pagGroups.set(key0, { ped: ped0, vendedor: vendPag, total: 0,
					                       formas: [], formasValores: new Map() });
				}
				const grp = _pagGroups.get(key0);
				grp.total += valor;
				grp.formas.push(formaNome);
				grp.formasValores.set(formaNome, (grp.formasValores.get(formaNome) || 0) + valor);
				if (!grp.vendedor && vendPag) grp.vendedor = vendPag;
			}

			// Mapa: "YYYY-MM-DD|pedStripped" → total real (abs do '00')
			const _tot00Map = new Map();
			for (const [k, v] of _tot00Sums) { if (v > 0) _tot00Map.set(k, v); }

			// ── Pass 2: insere grupos no mapVendas ───────────────────────────────────────
			let contadorAvulso = 0;
			for (const [key0, grp] of _pagGroups) {
				const dt    = key0.split("|")[0];
				let   ped   = grp.ped;
				const valor = grp.total;
				if (valor <= 0) continue;

				if (!ped) { contadorAvulso++; ped = "REC-" + contadorAvulso; }
				const searchKey  = dt + "|" + ped;
				const primaryKey = idIndex.get(key0) || idIndex.get(searchKey);

				if (primaryKey && mapVendas.has(primaryKey)) {
					const v = mapVendas.get(primaryKey);
					v.total_pag += valor;
					v.formas.push(...grp.formas);
					if (!v.formasValores) v.formasValores = new Map();
					for (const [f, fv] of grp.formasValores)
						v.formasValores.set(f, (v.formasValores.get(f) || 0) + fv);
					if (v.modelo !== 55 && grp.vendedor && grp.vendedor !== "?") v.vendedor = grp.vendedor;
				} else {
					mapVendas.set(searchKey, {
						_dtKey: dt, vendedor: grp.vendedor, modelo: 99, numero: ped, caixa: "",
						total_nfce: 0, total_pag: valor, formas: grp.formas,
						formasValores: grp.formasValores, is_recebimento: true
					});
					idIndex.set(searchKey, searchKey);
				}
			}

			// ── RECONCILIAÇÃO: recebimento-fantasma de venda CONVERTIDA ─────────
			// (v2.7.0) Quando uma gerencial é CONVERTIDA em NFC-e/NF-e, os
			// pagamentos passam a apontar para o número do documento fiscal. Se o
			// casamento do Pass 2 falhar (idIndex não encontra a venda por
			// key0/searchKey), o "else" acima cria um registro-fantasma com
			// modelo 99 + is_recebimento — que aparecia na tela como uma venda à
			// parte, com o número da faixa da NFC-e (ex: 122158) e "Recebimento de
			// Título / Conta" nos itens. Pior que o visual: como
			// finalTotal = total_nfce > 0 ? total_nfce : total_pag, o fantasma
			// entrava no total do dia com o valor cheio, DUPLICANDO uma venda que
			// o documento fiscal já contabilizava.
			// Aqui esses fantasmas são reconciliados: se existir um documento
			// fiscal real de MESMO DIA e MESMO NÚMERO, o fantasma é absorvido por
			// ele (formas de pagamento preservadas) e removido da lista.
			// Seguro nos dois cenários possíveis:
			//   - documento fiscal existe  → fantasma some, valor contado uma vez;
			//   - não existe (recebimento avulso de verdade, sem conversão) → o
			//     registro é mantido intacto, nada é perdido.
			// A comparação normaliza zeros à esquerda porque numeração gerencial é
			// zero-padded e a fiscal não.
			{
				const _normNum = n => String(n || "").trim().replace(/^0+/, "");
				const _fiscalPorNumero = new Map(); // "dt|numero" → chave da venda real
				for (const [k, v] of mapVendas.entries()) {
					if (v.is_recebimento) continue;
					const n = _normNum(v.numero);
					if (!n) continue;
					_fiscalPorNumero.set((v._dtKey || "") + "|" + n, k);
				}
				let _absorvidos = 0;
				for (const [k, v] of [...mapVendas.entries()]) {
					if (!v.is_recebimento) continue;
					const n = _normNum(v.numero);
					if (!n) continue;
					const kAlvo = _fiscalPorNumero.get((v._dtKey || "") + "|" + n);
					if (!kAlvo || kAlvo === k) continue;
					const alvo = mapVendas.get(kAlvo);
					if (!alvo) continue;
					// Absorve o pagamento no documento fiscal. Quando o fiscal já tem
					// total_nfce > 0, somar total_pag é inócuo (finalTotal prefere
					// total_nfce); quando não tem, é justamente o que dá o valor certo.
					alvo.total_pag = (alvo.total_pag || 0) + (v.total_pag || 0);
					if (v.formas && v.formas.length) alvo.formas.push(...v.formas);
					if (v.formasValores) {
						if (!alvo.formasValores) alvo.formasValores = new Map();
						for (const [f, fv] of v.formasValores)
							alvo.formasValores.set(f, (alvo.formasValores.get(f) || 0) + fv);
					}
					mapVendas.delete(k);
					_absorvidos++;
				}
				if (_absorvidos && _DEBUG_LOG) {
					console.log(`  >> reconciliacao: ${_absorvidos} recebimento(s) de venda convertida absorvido(s) pelo documento fiscal`);
				}
			}


			const altMap      = new Map();
			const vendAltMap  = new Map();
			const horaAltMap  = new Map();
			const altTotalMap = new Map(); // soma itens não-cancelados (total real)
			const altItensMap = new Map(); // detalhes completos: {desc,qtd,total,cancelado}

			if (rrAlt.e) _falhasLeitura.push({ fonte: "ALTERACA (itens das gerenciais)", detalhe: String(rrAlt.e.message || rrAlt.e) });
			if (!rrAlt.e && rrAlt.rows && rrAlt.rows.length) {
				for (const row of rrAlt.rows) {
					const ped = String(row.PED ?? "").trim().replace(/^0+/, "");
					if (!ped) continue;

					const searchKey  = toISO(row.DATA) + "|" + ped;
					if (_aliasesGerencialAbsorvida.has(searchKey)) continue; // itens vêm do ITENS001 da NF-e que absorveu a gerencial
					const primaryKey = idIndex.get(searchKey) || searchKey;

					const vAlt = String(row.VENDEDOR_ALT || "").trim();
					if (vAlt && vAlt !== "?" && !vendAltMap.has(primaryKey)) vendAltMap.set(primaryKey, vAlt);

					const hAlt = String(row.HORA_ALT || "").trim();
					if (hAlt && !horaAltMap.has(primaryKey)) horaAltMap.set(primaryKey, hAlt);

					const desc        = String(row.DESCRICAO || "").trim();
					const isCancelado = /cancelad/i.test(desc) || desc === "<CANCELADO>";
					const qtd         = fmtQtd(row.QUANTIDADE);
					const itemTotal   = (_temPrecoAlt && row.TOTAL_ITEM !== null && row.TOTAL_ITEM !== undefined)
						? Number(row.TOTAL_ITEM) : null;

					// Acumula total real (excluindo cancelados)
					if (!isCancelado && itemTotal !== null && Number.isFinite(itemTotal)) {
						altTotalMap.set(primaryKey, (altTotalMap.get(primaryKey) || 0) + itemTotal);
					}

					if (!desc) continue;

					// altItensMap — apenas itens não-cancelados (cancelados ignorados globalmente)
					if (!isCancelado) {
						if (!altItensMap.has(primaryKey)) altItensMap.set(primaryKey, []);
						altItensMap.get(primaryKey).push({
							desc,
							qtd,
							total: (itemTotal !== null && Number.isFinite(itemTotal)) ? itemTotal : null,
							cancelado: false
						});
					}

					// altMap (string) — chips e busca: também exclui cancelados
					if (!isCancelado) {
						if (!altMap.has(primaryKey)) altMap.set(primaryKey, []);
						altMap.get(primaryKey).push(qtd + "x " + desc);
					}
				}
			}

			// ── ITENS001: itens das NF-e ────────────────────────────────────
			try {
				if (_vendaNfeKey && _vendaNfeKey.size > 0) {
					const _camI = await camposTabela("ITENS001");
					if (_camI.has("NUMERONF") && _camI.has("DESCRICAO")) {
						const _cIq  = _camI.has("QUANTIDADE") ? "cast(i.QUANTIDADE as double precision)" : "1";
						// Campo de preço: TOTAL > PRECO*QTD > UNITARIO*QTD > null
						const _cIp  = _camI.has("TOTAL")     ? "cast(i.TOTAL as double precision)"
						            : _camI.has("PRECO")     ? "cast(i.PRECO as double precision) * " + (_camI.has("QUANTIDADE") ? "cast(i.QUANTIDADE as double precision)" : "1")
						            : _camI.has("UNITARIO") ? "cast(i.UNITARIO as double precision) * " + (_camI.has("QUANTIDADE") ? "cast(i.QUANTIDADE as double precision)" : "1")
						            : "cast(null as double precision)";
						const _rI = await query(db, `
							SELECT cast(i.NUMERONF as varchar(30)) as NF_I,
							       ${_txt("i.DESCRICAO", 120)} as DESC_I,
							       ${_cIq} as QTD_I,
							       ${_cIp} as PRECO_I
							FROM ITENS001 i
							INNER JOIN VENDAS v ON v.NUMERONF = i.NUMERONF
							WHERE cast(v.SAIDAD as date) BETWEEN cast(? as date) AND cast(? as date)
							  AND cast(v.MODELO as varchar(5)) = '55'
							  AND v.TOTAL > 0
						`, [dataInicioISO, dataFimISO]);
						tick("ITENS001");
						if (_rI.e) _falhasLeitura.push({ fonte: "ITENS001 (itens das NF-e)", detalhe: String(_rI.e.message || _rI.e) });
						if (!_rI.e && _rI.rows) {
							for (const it of _rI.rows) {
								const _nfI   = String(it.NF_I   || "").trim();
								const _descI = String(it.DESC_I || "").trim();
								if (!_descI) continue;
								const _keyI  = _vendaNfeKey.get(_nfI);
								if (!_keyI) continue;
								const _qtdI  = fmtQtd(it.QTD_I || 1);
								const _precoI = (it.PRECO_I !== null && it.PRECO_I !== undefined)
								? Number(it.PRECO_I) : null;
								// altMap (string) — chips e busca
								if (!altMap.has(_keyI)) altMap.set(_keyI, []);
								altMap.get(_keyI).push(_qtdI + "x " + _descI);
								// altItensMap — detalhes com preço para o modal
								if (!altItensMap.has(_keyI)) altItensMap.set(_keyI, []);
								altItensMap.get(_keyI).push({
									desc: _descI, qtd: _qtdI,
									total: (_precoI !== null && Number.isFinite(_precoI)) ? _precoI : null,
									cancelado: false
								});
							}
						}
					}
				}
			} catch(eI) { console.log("AVISO ITENS001: " + eI.message); _falhasLeitura.push({ fonte: "ITENS001 (itens das NF-e)", detalhe: String(eI.message || eI) }); }

			// ── DEDUPLICAÇÃO NF-e ──────────────────────────────────────────────
			// Problema: NFCE e VENDAS podem gerar duas entradas para a mesma NF-e
			// quando os números não batem exatamente após normalização de zeros.
			// Estratégia: agrupar entradas modelo=55 por (data + total arredondado),
			// e quando há par com mesmo total, mesclar a menos completa na mais
			// completa (mais campos preenchidos = ganha), removendo a duplicada.
			// Entradas is_recebimento nunca participam da deduplicação.
			{
				const _nfe55 = [];
				for (const [k, v] of mapVendas.entries()) {
					if (v.modelo === 55 && !v.is_recebimento) _nfe55.push([k, v]);
				}
				// Agrupa por data + total arredondado (centavos)
				const _grpNfe = new Map();
				for (const [k, v] of _nfe55) {
					const _gk = (v._dtKey||"") + "|" + Math.round((v.total_nfce||v.total_pag||0)*100);
					if (!_grpNfe.has(_gk)) _grpNfe.set(_gk, []);
					_grpNfe.get(_gk).push([k, v]);
				}
				for (const [, pares] of _grpNfe.entries()) {
					if (pares.length < 2) continue;
					// CORREÇÃO (v3.0.0) — perda de venda: antes, QUALQUER grupo de NF-e com
					// mesma data + mesmo valor era fundido num único registro. Duas NF-e
					// DISTINTAS com o mesmo total no dia (comum em varejo: produto de preço
					// fixo, ex.: R$ 90,00 vendido duas vezes, clientes e horários diferentes)
					// viravam uma só, e o valor da outra sumia do total do dia. A fusão só é
					// legítima para o caso que este bloco foi criado para resolver: a MESMA
					// NF-e vinda de duas fontes (tabela nfce + tabela VENDAS) com números que
					// não casam. Portanto só funde o par 1-para-1 {1 da nfce, 1 de VENDAS};
					// qualquer outro arranjo é ambíguo e NADA é removido.
					const _daNfce   = pares.filter(([, pv]) => pv._fonte === "nfce").length;
					const _daVendas = pares.filter(([, pv]) => pv._fonte === "vendas").length;
					if (pares.length !== 2 || _daNfce !== 1 || _daVendas !== 1) {
						_dedupAmbiguos.push(pares.map(([k]) => k));
						console.log("AVISO DEDUP NF-e: " + pares.length + " NF-e com mesma data/valor (" + pares.map(([k]) => k).join(", ") + ") — mantidas separadas: não há como provar que são o mesmo documento.");
						continue;
					}
					// Pontua cada entrada: +1 por campo preenchido relevante
					const pontos = pares.map(([k, v]) =>
						(v.cliente  ? 2 : 0) +
						(v.natureza ? 2 : 0) +
						(v.hora     ? 1 : 0) +
						(v.vendedor && v.vendedor !== "?" ? 1 : 0) +
						(v.formas && v.formas.length > 0 ? 1 : 0)
					);
					// Ordena: mais completo primeiro
					const ordenados = pares.map((p, i) => ({p, pt: pontos[i]}))
						.sort((a, b) => b.pt - a.pt);
					const [principal] = ordenados[0].p;
					const pvPrincipal = mapVendas.get(principal);
					// Mescla dados dos duplicados para o principal e remove os extras
					for (let di = 1; di < ordenados.length; di++) {
						const [kDup, vDup] = ordenados[di].p;
						if (!pvPrincipal.cliente  && vDup.cliente)  pvPrincipal.cliente  = vDup.cliente;
						if (!pvPrincipal.natureza && vDup.natureza) pvPrincipal.natureza = vDup.natureza;
						if (!pvPrincipal.hora     && vDup.hora)     pvPrincipal.hora     = vDup.hora;
						if ((!pvPrincipal.vendedor || pvPrincipal.vendedor === "?") && vDup.vendedor && vDup.vendedor !== "?")
							pvPrincipal.vendedor = vDup.vendedor;
						if (vDup.formas && vDup.formas.length > 0)
							pvPrincipal.formas.push(...vDup.formas);
						// Propaga valores por forma do duplicado
						if (vDup.formasValores) {
							if (!pvPrincipal.formasValores) pvPrincipal.formasValores = new Map();
							for (const [f, fv] of vDup.formasValores)
								pvPrincipal.formasValores.set(f, (pvPrincipal.formasValores.get(f) || 0) + fv);
						}
						// Transfere itens do altMap se o principal não tem
						if (!altMap.has(principal) && altMap.has(kDup))
							altMap.set(principal, [...(altMap.get(kDup) || [])]); // spread: sem array compartilhado
						_dedupFundidas.push({ de: kDup, para: principal, total: vDup.total_nfce || vDup.total_pag || 0 });
						console.log("DEDUP NF-e: mesclado " + kDup + " → " + principal);
						mapVendas.delete(kDup);
					}
				}
			}

			// Venda que vai para a tela é ATIVA no cache de hora, mesmo que outra linha
			// com a mesma chave (número repetido, NFC-e ainda sem número próprio)
			// esteja cancelada/convertida. "Recebimento" (pagamento sem venda) não
			// conta: sobra de uma gerencial cancelada não a faz parecer ativa.
			for (const [k, v] of mapVendas) if (!v.is_recebimento && _situacaoCache.get(k)) _situacaoCache.set(k, null);

			const linhas = [];
			const _chaveLinha = new Map(); // linha -> chave do mapVendas ("dt|número"), uso interno


			// _normForma fora do loop — evita recriar a função a cada iteração
			const _normForma = s => String(s || "").replace(/^cartao(?: +|$)/i, "").trim();
			for (const [key, v] of mapVendas.entries()) {
				// Para Gerencial (modelo 99): o total SEMPRE vem da soma real dos itens
				// do ALTERACA (exclui cancelados) quando disponível — é o valor cobrado
				// após todas as alterações/cancelamentos de itens. total_nfce pode refletir
				// o valor original da abertura do cupom, ANTES de alterações.
				// Fallback 1: abs('00 Total') do PAGAMENT, se maior que o atual.
				// Fallback 2: total_nfce (campo da tabela NFCE), como último recurso.
				// NFC-e (65) e NF-e (55) têm total_nfce confiável — não corrigidos aqui.
				if (v.modelo === 99) {
					const _tAlt = altTotalMap.get(key);
					const _t00  = _tot00Map.get(key);
					if (_tAlt && _tAlt > 0) {
						// Soma de itens ALTERACA é sempre preferida — é o valor real cobrado
						v.total_nfce = 0;
						v.total_pag  = _tAlt;
					} else {
						// Sem itens com preço no ALTERACA — tenta abs('00') do PAGAMENT
						const _base = v.total_nfce > 0 ? v.total_nfce : v.total_pag;
						if (_t00 && _t00 > _base) {
							v.total_nfce = 0;
							v.total_pag  = _t00;
						}
						// Caso contrário, mantém total_nfce (campo da tabela)
					}
				}
				let finalTotal = v.total_nfce > 0 ? v.total_nfce : v.total_pag;
				if (finalTotal <= 0) continue;

				let finalVendedor = v.vendedor;
				if (!finalVendedor || finalVendedor === "?") finalVendedor = vendAltMap.get(key) || "";
				// RÓTULO (v2.7.3): quando a NFC-e ainda não foi autorizada pela SEFAZ,
				// "(sem vendedor)" dá a entender que a informação não existe — quando
				// na verdade ela só ainda não chegou. Um rótulo explícito evita que o
				// operador ache que a venda está com problema ou incompleta.
				if (!finalVendedor || finalVendedor === "?") {
					finalVendedor = v.pendente_autorizacao ? "(aguardando autorização)" : "(sem vendedor)";
				}


				let numeroDisplay = v.numero;
				if (/^\d+$/.test(numeroDisplay) && numeroDisplay.length < 6) numeroDisplay = numeroDisplay.padStart(6, "0");

				let tItens = "";
				if (v.is_recebimento) {
					tItens = "⤷ Recebimento de Título / Conta";
				} else {
					const arrItens = altMap.get(key);
					if (arrItens && arrItens.length) {
						tItens = arrItens.map(i => "⤷ " + i).join("\n");
					}
				}

				let finalHora = v.hora || horaAltMap.get(key) || "";

				// ── Correção de relógio do PDV ────────────────────────────────────────
				// Regra (v2.7.5), igual nos dois lados do sistema:
				//   diffMin > 0            → futuro    : corrige para a hora atual
				//   0 ≥ diff ≥ −3min       → range ok  : aceita como está, grava OK no cache
				//   −3min > diff ≥ −60min  → corrigível: corrige para a hora atual
				//   diff < −60min          → ignorado  : fora da janela, sem ação
				// A janela de 1 hora casa com _HORA_GERENCIAL_JANELA_MS de
				// servidor-relatorio.js — se os dois divergirem, existe uma faixa em
				// que um lado corrige e o outro não, e a venda parece "pular" de
				// horário conforme quem processou por último.
				if (finalHora && v._dtKey === _hojeISO) {
					const _hh5 = String(finalHora).substring(0, 5);
					if (/^\d{2}:\d{2}$/.test(_hh5)) {
						const _toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
						const _diffMin = _toMin(_hh5) - _toMin(horaGeradaBR);
						// FORMATO FIX: _horaCache guarda {tipo,hora} (ou string solta legada)
						// — ver _normalizarEntradaHoraCache. "tipo" identifica a categoria da
						// venda (nfc-e/nf-e/gerencial) para permitir ordenar o arquivo do
						// cache por categoria ao salvar (_ordenarHoraCache).
						const _cachedRaw = _horaCache[key];
						const _cached = _cachedRaw !== undefined ? _normalizarEntradaHoraCache(_cachedRaw) : null;
						const _tipoVenda = v.modelo === 65 ? "nfce" : v.modelo === 55 ? "nfe" : v.modelo === 99 ? "gerencial" : "desconhecido";
						// MIGRAÇÃO (v2.6.5): entradas gravadas por versões anteriores são
						// strings soltas ("HH:MM" / "OK"), sem o campo "tipo". Elas continuam
						// sendo lidas corretamente (_normalizarEntradaHoraCache trata os dois
						// formatos), mas nunca eram reescritas — porque, uma vez que a chave
						// existe, os ramos abaixo só a consultam, nunca a atualizam. Resultado:
						// o arquivo ficava misturado (metade string, metade objeto) até a
						// virada do dia purgar as antigas, e as legadas caíam no fim da
						// ordenação por serem "desconhecido". Aqui a entrada legada é
						// promovida ao formato novo aproveitando o tipo real desta venda, que
						// só este ponto do código conhece (v.modelo). O valor da hora é
						// preservado exatamente como estava — a migração é só de formato,
						// nunca altera o horário já fixado.
						if (_cached && _cached.tipo === "desconhecido" && _tipoVenda !== "desconhecido") {
							_definirHoraCache(key, { tipo: _tipoVenda, hora: _cached.hora });
							_cached.tipo = _tipoVenda;
						}
						if (_cached && _cached.hora === HORA_CACHE_OK) {
							/* range ok verificado — usa hora original sem reverificação */
						} else if (_cached && /^\d{2}:\d{2}/.test(_cached.hora)) {
							// PRECISÃO FIX (v2.6.6): antes bastava "_cached.hora" ser truthy
							// para o valor virar a hora exibida. Isso quebra assim que o cache
							// ganha qualquer MARCADOR que não seja horário — como o
							// "CANCELADA" introduzido em servidor-relatorio.js v2.7.0 para
							// registrar gerenciais canceladas/convertidas sem deixar buraco na
							// numeração: a tela mostraria literalmente "CANCELADA" na coluna de
							// hora. Exigir o formato HH:MM é uma regra genérica — protege
							// contra este e qualquer marcador futuro, sem precisar listar cada
							// um aqui.
							finalHora = _cached.hora;
						} else if (_cached && _cached.hora && _cached.hora !== HORA_CACHE_OK) {
							/* marcador não-horário (ex: CANCELADA) — mantém a hora original da venda */
						} else if (_diffMin > 0) {
							_correcoesHora.push({ tipo: _tipoVenda, numero: v.numero, de: _hh5, para: horaGeradaBR });
							finalHora = horaGeradaBR; _definirHoraCache(key, { tipo: _tipoVenda, hora: horaGeradaBR });
						} else if (_diffMin >= -TOLERANCIA_RELOGIO_MIN || _LINHA_DE_BASE) {
							_definirHoraCache(key, { tipo: _tipoVenda, hora: HORA_CACHE_OK });
						} else if (_diffMin >= -MAXIMO_ATRASO_MIN) {
							_correcoesHora.push({ tipo: _tipoVenda, numero: v.numero, de: _hh5, para: horaGeradaBR });
							finalHora = horaGeradaBR; _definirHoraCache(key, { tipo: _tipoVenda, hora: horaGeradaBR });
						}
						// else: diff < −MAXIMO_ATRASO_MIN → ignora silenciosamente
					}
				}

				// TIPO FIX (v2.6.9): antes o tipo exibido vinha SÓ do modelo, então
				// qualquer registro com modelo 99 aparecia como "Gerencial". Depois
				// de CONVERTER uma gerencial em NFC-e/NF-e, o recebimento que sobra
				// (is_recebimento) continuava com modelo 99 e era mostrado como mais
				// uma venda "Gerencial" — mas com número da faixa da NFC-e (ex:
				// 122156) e itens "Recebimento de Título / Conta". O resultado era
				// confuso: vendas que já viraram documento fiscal reaparecendo como
				// gerenciais na lista, inflando a contagem do tipo.
				// O projeto JÁ tinha a definição correta de "gerencial real" — em
				// #copiarGerencial: modelo 99 + NÃO is_recebimento + número zero-
				// padded. Ela só não estava sendo aplicada à coluna TIPO da tabela.
				// Agora está, para que a tela e o botão de copiar concordem.
				const _ehGerencialReal = v.modelo === 99 && !v.is_recebimento;
				const tipoStr = v.modelo === 65 ? "nfc-e"
					: v.modelo === 99 ? (_ehGerencialReal ? "gerencial" : "recebimento")
					: "nf-e";
				// RÓTULO (v2.7.3): mesmo raciocínio do vendedor — enquanto a NFC-e não
				// é autorizada, "não identificado" sugere dado ausente/errado, quando
				// é apenas dado que ainda não chegou da SEFAZ.
				const _semFormaLabel = v.pendente_autorizacao ? "aguardando autorização" : "não identificado";
				const finalPagsDisplay = v.modelo === 55
					? (v.natureza || (v.formas.length > 0 ? [...new Set(v.formas)].map(_normForma).filter(Boolean).join(" | ") : _semFormaLabel))
					: (v.formas.length > 0 ? [...new Set(v.formas)].map(_normForma).filter(Boolean).join(" | ") : _semFormaLabel);

				linhas.push({
					_dtKey: v._dtKey,
					vendedor: finalVendedor,
					modelo: v.modelo,
					tipo: tipoStr,
					numero: numeroDisplay,
					caixa: v.caixa,
					hora: finalHora,
					cliente: v.cliente || "",
					natureza: v.natureza || "",
					total: finalTotal,
					pagamentos: finalPagsDisplay,
					itens: tItens,
					// Detalhes por item com preço — exibido no modal
					itensDetalhe: altItensMap.get(key) || [],
					// Valores por forma de pagamento { PIX: 100.50, Dinheiro: 39.50 }
					// Keys normalizadas: "Cartao DEBITO" → "DEBITO"
					formasValores: v.formasValores
						? Object.fromEntries(
							[...v.formasValores.entries()].reduce((acc, [f, fv]) => {
								const fn = String(f).replace(/^cartao(?: +|$)/i, "").trim() || f;
								acc.set(fn, (acc.get(fn) || 0) + fv);
								return acc;
							}, new Map())
						  )
						: {},
					// Preservado para impedir reclassificação indevida como NF-e
					is_recebimento: !!v.is_recebimento
				});
				_chaveLinha.set(linhas[linhas.length - 1], key);
			}
			
			linhas.sort((a, b) => {
				const hA = String(a.hora || "");
				const hB = String(b.hora || "");
				if (hA > hB) return -1; if (hA < hB) return 1;
				const vA = a.vendedor.toLowerCase(), vB = b.vendedor.toLowerCase();
				if (vA < vB) return -1; if (vA > vB) return 1;
				if (a.modelo < b.modelo) return -1; if (a.modelo > b.modelo) return 1;
				if (a.numero > b.numero) return -1; if (a.numero < b.numero) return 1;
				return 0;
			});

			// Reclassifica como NF-e (55) entradas com modelo incorreto no banco.
			//
			// Casos cobertos:
			//   A) MODELO=55 no banco → já correto, pula.
			//   B) MODELO=NULL→coalesce→65 (NFC-e) OU MODELO=99 (Gerencial)
			//      com campo natureza preenchido → NF-e sem MODELO correto.
			//   C) Qualquer modelo com forma de pagamento contendo variante de "NF-e"
			//      (NF-E, NFE, NF/E, NF.E, NF E) → NF-e declarada na forma.
			//
			// Não restringe por x.modelo===99 — MODELO=NULL chega como 65 via coalesce.
			const _reNfe = /\bNF[-.\s]?E\b/i;
			for (const x of linhas) {
				if (x.modelo === 55) continue; // já correto — pula
				// Recebimentos de PAGAMENT sem vínculo não são NF-e — forma "Dinheiro NF-e"
				// é apenas o nome da forma de pagamento, não indica que é uma NF-e nova.
				if (x.is_recebimento) continue;

				// Caso B: natureza preenchida (campo exclusivo de NF-e)
				if (x.natureza && String(x.natureza).trim()) {
					x.modelo = 55;
					x.tipo   = "nf-e";
					if (!x.pagamentos || x.pagamentos === "NÃO DECLARADO") {
						x.pagamentos = String(x.natureza).trim();
					}
					continue;
				}

				// Caso C: forma menciona NF-e em qualquer variante
				// Normaliza tokens (remove hifens/pontos) para cobrir: NF-E, NFE, NF.E, NF/E
				const _formaBruta = String(x.pagamentos || "");
				const _tokensNorm = _formaBruta
					.split(/[\s|,/]+/)
					.map(s => s.trim().toUpperCase().replace(/[-.]/g, ""))
					.filter(Boolean);
				if (_reNfe.test(_formaBruta) || _tokensNorm.includes("NFE")) {
					x.modelo = 55;
					x.tipo   = "nf-e";
				}
			}

			// ── Reconciliação FINAL Gerencial → NFC-e/NF-e (v3.8.3) ──────────────────
			// A reconciliação acima roda antes de PAGAMENT/ALTERACA e compara o
			// NFCE.TOTAL/NFCE.HORA BRUTOS da gerencial. Só que o total exibido da
			// gerencial vem da soma dos itens do ALTERACA (ou do PAGAMENT) e a hora
			// pode vir do ALTERACA: o auto-teste (que olha o resultado final) via o
			// par e a reconciliação não — caso real: gerencial 062418 × NF-e 000306,
			// R$ 1215,51, mesmo vendedor, convertida no SmallSoft e ainda listada aqui.
			// Esta passada aplica o MESMO critério do auto-teste às LINHAS FINAIS:
			// mesma data, mesmo valor (±0,01), documento fiscal emitido 0–20 min
			// DEPOIS, vendedores não diferentes. Travas mantidas: cada documento
			// absorve no máximo 1 gerencial (a mais cedo vence; empate de candidatos
			// fica marcado como ambíguo) e documento que já tem vínculo pela coluna
			// GERENCIAL ou já absorveu uma gerencial não entra. O documento fiscal
			// SEMPRE prevalece; a gerencial sai da lista e da soma e vai para o painel
			// Duplicatas, onde o usuário pode escolher manter as duas ou só a gerencial.
			{
				const _ehDocFiscal = (l) => (l.modelo === 65 || l.modelo === 55) && !l.is_recebimento;
				const _docsLivres = linhas.filter((l) => {
					if (!_ehDocFiscal(l)) return false;
					const k = _chaveLinha.get(l);
					return !_docsComVinculo.has(k) && !_docsQueAbsorveram.has(k);
				});
				const _gersFinais = linhas
					.filter((l) => l.modelo === 99 && !l.is_recebimento && Number(l.total) > 0)
					.map((l) => ({ l, m: _horaParaMinutos(l.hora) }))
					.filter((g) => g.m !== null)
					.sort((a, b) => a.m - b.m);
				// Rótulos que o gerador usa quando NÃO há forma de pagamento conhecida.
				const _semForma = (p) => {
					const t = String(p || "").trim().toLowerCase();
					return t === "" || t === "não identificado" || t === "aguardando autorização" || t === "não declarado";
				};
				const _vendConhecido = (v) => { const t = String(v || "").trim(); return t !== "" && t !== "?" && !t.startsWith("("); };
				// Itens normalizados (descrição sem acento, maiúscula, 20 primeiros caracteres —
				// ALTERACA e ITENS001 podem truncar diferente). Os DOIS lados com itens e
				// NENHUM em comum = vendas diferentes, mesmo com valor/vendedor/horário iguais.
				const _descsItens = (l) => new Set((Array.isArray(l.itensDetalhe) ? l.itensDetalhe : [])
					.filter((it) => it && !(Number.isFinite(Number(it.total)) && it.total !== null && Number(it.total) < 0))
					.map((it) => String(it.desc || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
						.toUpperCase().replace(/\s+/g, " ").trim().slice(0, 20))
					.filter((d) => d && !/\b(DESCONTO|ACRESCIMO)\b/.test(d)));
				const _itensIncompativeis = (a, b) => {
					const x = _descsItens(a), y = _descsItens(b);
					if (x.size === 0 || y.size === 0) return false;
					for (const dsc of x) if (y.has(dsc)) return false;
					return true;
				};
				const _remover = new Set();
				const _docUsado = new Set();
				for (const { l: g, m: gm } of _gersFinais) {
					const _cands = [];
					for (const d of _docsLivres) {
						if (_docUsado.has(d)) continue;
						if (d._dtKey !== g._dtKey) continue;
						if (Math.abs(Number(d.total) - Number(g.total)) > TOLERANCIA_VALOR) continue;
						const dm = _horaParaMinutos(d.hora);
						if (dm === null) continue;
						const diff = dm - gm; // documento fiscal sempre emitido DEPOIS da gerencial
						if (diff < 0 || diff > TOLERANCIA_MINUTOS) continue;
						if (_vendedoresDiferentes(g.vendedor, d.vendedor)) continue;
						if (_itensIncompativeis(g, d)) continue;
						_cands.push({ d, diff });
					}
					if (_cands.length === 0) continue;
					_cands.sort((a, b) => a.diff - b.diff);
					const { d, diff } = _cands[0];
					_docUsado.add(d);
					_remover.add(g);
					// Dado fiscal presente no documento prevalece; da gerencial só entra
					// o que o documento não tem (vendedor, cliente, pagamento, itens).
					if (!_vendConhecido(d.vendedor) && _vendConhecido(g.vendedor)) d.vendedor = g.vendedor;
					if (!String(d.cliente || "").trim() && g.cliente) d.cliente = g.cliente;
					const _docTemForma = d.formasValores && Object.keys(d.formasValores).length > 0;
					if (!_docTemForma && g.formasValores && Object.keys(g.formasValores).length > 0) {
						d.formasValores = { ...g.formasValores };
						if (_semForma(d.pagamentos) && !_semForma(g.pagamentos)) d.pagamentos = g.pagamentos;
					}
					if ((!Array.isArray(d.itensDetalhe) || d.itensDetalhe.length === 0) && Array.isArray(g.itensDetalhe) && g.itensDetalhe.length > 0) {
						d.itensDetalhe = g.itensDetalhe.slice();
						if (!d.itens && g.itens) d.itens = g.itens;
					}
					const _gerKey = _chaveLinha.get(g);
					const _numDoc = String(d.numero || "").replace(/^0+/, "") || String(d.numero || "");
					if (_gerKey) _situacaoCache.set(_gerKey, { situacao: "convertida", convertidaEm: { tipo: _tipoDoModelo(d.modelo), numero: _numDoc } });
					const _rotDoc = d.modelo === 65 ? "NFC-e" : "NF-e";
					const _obs = _cands.length > 1 ? ` (${_cands.length} candidatas, escolhida a mais próxima)` : "";
					console.log(`RECONCILIACAO: Gerencial ${g.numero} absorvida pela ${_rotDoc} ${d.numero} (valores finais: mesma data/valor/vendedor, ${diff}min depois)${_obs}.`);
					_duplicatasProvaveis.push({
						gerencial: g.numero, docNumero: d.numero, docModelo: d.modelo, diffMin: diff,
						ambiguo: _cands.length > 1,
						dt: g._dtKey, hora: g.hora, caixa: g.caixa,
						vendedor: g.vendedor, cliente: g.cliente,
						natureza: g.natureza, total: g.total,
						// Pagamento/itens reais da gerencial — permitem ao painel Duplicatas
						// reconstituí-la completa se o usuário escolher mantê-la.
						pagamentos: g.pagamentos, formasValores: g.formasValores || {},
						itens: g.itens, itensDetalhe: Array.isArray(g.itensDetalhe) ? g.itensDetalhe : []
					});
				}
				if (_remover.size > 0) {
					for (let i = linhas.length - 1; i >= 0; i--) if (_remover.has(linhas[i])) linhas.splice(i, 1);
				}
			}

			// ── NFC-e reemitida como NF-e (v3.8.4) ───────────────────────────────────
			// Caso real: NFC-e 125636 (vendedor A, 16:17, crédito, R$ 453,35) e NF-e 000307
			// (cliente identificado, sem vendedor, R$ 453,35) com os MESMOS 3 itens — o cliente
			// pediu nota com nome/CPF e a venda foi refeita como NF-e. As duas eram
			// somadas. Diferente da gerencial, aqui os DOIS são documentos fiscais e a
			// emissão da NF-e pode ser bem depois; por isso a régua é mais forte:
			// mesma data, mesmo valor (±0,01) e a MESMA lista de itens (descrição
			// normalizada, com repetição; os dois lados precisam ter itens). Não pode
			// haver vendedores diferentes (cliente não é critério: a NFC-e costuma
			// trazer CPF/"consumidor" e a NF-e o nome completo). A
			// hora NÃO é critério (v3.8.6): a da NF-e é a de saída, que pode ser
			// anterior à emissão. Descontos/acréscimos não contam como item. Cada
			// NF-e absorve no máximo 1 NFC-e (a de horário mais próximo). A NF-e
			// prevalece e herda vendedor, hora e formas de pagamento que não tiver; a
			// NFC-e vai para o painel Duplicatas (manter as duas / só uma delas).
			{
				const _normTxt = (v) => String(v == null ? "" : v).normalize("NFD").replace(/[̀-ͯ]/g, "")
					.toUpperCase().replace(/\s+/g, " ").trim();
				// Só PRODUTOS entram na comparação: linha de desconto/acréscimo (valor
				// negativo ou descrição DESCONTO/ACRESCIMO) existe na NFC-e e não na NF-e
				// — caso real 125636 × 000307 (desconto de 5%) não casava por causa dela.
				const _ehProduto = (it) => {
					if (!it) return false;
					if (it.total !== null && it.total !== undefined && Number.isFinite(Number(it.total)) && Number(it.total) < 0) return false;
					return !/\b(DESCONTO|ACRESCIMO)\b/.test(_normTxt(it.desc));
				};
				const _assinaturaItens = (l) => (Array.isArray(l.itensDetalhe) ? l.itensDetalhe : [])
					.filter(_ehProduto)
					.map((it) => _normTxt(it.desc).slice(0, 20)).filter(Boolean).sort().join("\u0001");
				const _vendConhecido = (v) => { const t = String(v || "").trim(); return t !== "" && t !== "?" && !t.startsWith("("); };
				const _nfces = linhas.filter((l) => l.modelo === 65 && !l.is_recebimento && Number(l.total) > 0)
					.map((l) => ({ l, ass: _assinaturaItens(l), m: _horaParaMinutos(l.hora) }))
					.filter((x) => x.ass !== "")
					.sort((a, b) => (a.m === null ? 1e9 : a.m) - (b.m === null ? 1e9 : b.m));
				const _nfes = linhas.filter((l) => l.modelo === 55 && !l.is_recebimento && Number(l.total) > 0)
					.map((l) => ({ l, ass: _assinaturaItens(l), m: _horaParaMinutos(l.hora) }))
					.filter((x) => x.ass !== "");
				const _removerNfce = new Set();
				const _nfeUsada = new Set();
				for (const n of _nfces) {
					const _cands = [];
					for (const e of _nfes) {
						if (_nfeUsada.has(e.l)) continue;
						if (e.l._dtKey !== n.l._dtKey) continue;
						if (Math.abs(Number(e.l.total) - Number(n.l.total)) > TOLERANCIA_VALOR) continue;
						if (e.ass !== n.ass) continue;
						if (_vendedoresDiferentes(n.l.vendedor, e.l.vendedor)) continue;
						_cands.push({ e, diff: (n.m !== null && e.m !== null) ? e.m - n.m : null });
					}
					if (_cands.length === 0) continue;
					// Mais próxima em horário primeiro; sem hora vai para o fim.
					_cands.sort((a, b) => (a.diff === null ? 1e9 : a.diff) - (b.diff === null ? 1e9 : b.diff));
					const { e, diff } = _cands[0];
					const doc = e.l, nf = n.l;
					_nfeUsada.add(doc);
					_removerNfce.add(nf);
					if (!_vendConhecido(doc.vendedor) && _vendConhecido(nf.vendedor)) doc.vendedor = nf.vendedor;
					if (!String(doc.cliente || "").trim() && nf.cliente) doc.cliente = nf.cliente;
					if (_horaParaMinutos(doc.hora) === null && nf.hora) doc.hora = nf.hora;
					const _docTemForma = doc.formasValores && Object.keys(doc.formasValores).length > 0;
					if (!_docTemForma && nf.formasValores && Object.keys(nf.formasValores).length > 0) doc.formasValores = { ...nf.formasValores };
					const _nfceKey = _chaveLinha.get(nf);
					const _numDoc = String(doc.numero || "").replace(/^0+/, "") || String(doc.numero || "");
					if (_nfceKey) _situacaoCache.set(_nfceKey, { situacao: "convertida", convertidaEm: { tipo: "nfe", numero: _numDoc } });
					// Gerencial que esta NFC-e já tinha absorvido passa a apontar para a NF-e
					// (senão "manter apenas a gerencial" procuraria uma NFC-e que saiu).
					const _numNf = String(nf.numero || "").replace(/^0+/, "");
					for (const dp of _duplicatasProvaveis.concat(_duplicatasConfirmadas)) {
						if (Number(dp.docModelo) === 65 && String(dp.docNumero || "").replace(/^0+/, "") === _numNf && (!dp.dt || dp.dt === nf._dtKey)) {
							dp.docNumero = doc.numero; dp.docModelo = 55;
						}
					}
					const _obs = _cands.length > 1 ? ` (${_cands.length} candidatas, escolhida a mais próxima)` : "";
					console.log(`RECONCILIACAO: NFC-e ${nf.numero} absorvida pela NF-e ${doc.numero} (mesma data/valor/itens${diff !== null ? ", " + diff + "min depois" : ""})${_obs}.`);
					_duplicatasProvaveis.push({
						gerencial: nf.numero, origemModelo: 65, docNumero: doc.numero, docModelo: 55,
						diffMin: diff, ambiguo: _cands.length > 1, criterio: "itens",
						dt: nf._dtKey, hora: nf.hora, caixa: nf.caixa,
						vendedor: nf.vendedor, cliente: nf.cliente,
						natureza: nf.natureza, total: nf.total,
						pagamentos: nf.pagamentos, formasValores: nf.formasValores || {},
						itens: nf.itens, itensDetalhe: Array.isArray(nf.itensDetalhe) ? nf.itensDetalhe : []
					});
				}
				if (_removerNfce.size > 0) {
					for (let i = linhas.length - 1; i >= 0; i--) if (_removerNfce.has(linhas[i])) linhas.splice(i, 1);
				}
			}

			const totaisDia = { ok: true, gerencial: 0, nfce: 0, nfe: 0, geral: 0, selecionado: 0, qtd_gerencial: 0, qtd_nfce: 0, qtd_nfe: 0, modelos: [] };
			const mpVend = new Map();

			for (const x of linhas) {
				if (!mpVend.has(x.vendedor)) {
					mpVend.set(x.vendedor, { vendedor: x.vendedor, gerencial: 0, nfce: 0, nfe: 0, geral: 0, qtd: 0 });
				}
				const v = mpVend.get(x.vendedor);
				v.qtd++;
				v.geral += x.total;
				if (x.modelo === 99)      v.gerencial += x.total;
				else if (x.modelo === 65) v.nfce      += x.total;
				else if (x.modelo === 55) v.nfe       += x.total;

				totaisDia.geral += x.total;
				if (x.modelo === 99)      { totaisDia.gerencial += x.total; totaisDia.qtd_gerencial++; }
				else if (x.modelo === 65) { totaisDia.nfce      += x.total; totaisDia.qtd_nfce++; }
				else if (x.modelo === 55) { totaisDia.nfe       += x.total; totaisDia.qtd_nfe++; }
			}

			for (const campo of ["gerencial", "nfce", "nfe", "geral"]) {
				totaisDia[campo] = arredondarCentavos(totaisDia[campo]);
				for (const vt of mpVend.values()) vt[campo] = arredondarCentavos(vt[campo]);
			}
			totaisDia.selecionado = totaisDia.geral;
			if (totaisDia.gerencial > 0) totaisDia.modelos.push({modelo: 99, total: totaisDia.gerencial});
			if (totaisDia.nfce      > 0) totaisDia.modelos.push({modelo: 65, total: totaisDia.nfce});
			if (totaisDia.nfe       > 0) totaisDia.modelos.push({modelo: 55, total: totaisDia.nfe});

			const vendTotaisDia = [...mpVend.values()].sort((a, b) => a.vendedor.localeCompare(b.vendedor, "pt-BR", { sensitivity: "base" }));
			// vendedores derivado de vendTotaisDia (já ordenado) — sem 2º spread+sort
			const vendedores = vendTotaisDia.map(v => ({ vendedor: v.vendedor, qtd: v.qtd, total: v.geral }));

			const totalGeral = totaisDia.geral;
			const qtdGeral = linhas.length;

			// ── AUTO-TESTE: roda sobre o resultado final, nunca derruba a geração ──────────
			let _resultadoAutoTeste;
			try {
				_resultadoAutoTeste = executarAutoTeste({
					linhas, totais: { qtd: qtdGeral, total: totalGeral }, totaisDia, vendTotaisDia,
					duplicatas: { confirmadas: _duplicatasConfirmadas, provaveis: _duplicatasProvaveis },
					nfeRejeitadas: _nfeRejeitadas, falhasLeitura: _falhasLeitura, dedupAmbiguos: _dedupAmbiguos, dedupFundidas: _dedupFundidas,
					toleranciaMinutos: TOLERANCIA_MINUTOS
				});
			} catch (eAuto) {
				_resultadoAutoTeste = { verificacoes: 0, achados: [{ nivel: "aviso", codigo: "AUTOTESTE_FALHOU", msg: "O auto-teste não conseguiu rodar: " + String((eAuto && eAuto.message) || eAuto) }] };
			}
			tentarSilencioso(() => registrarAutoTeste(_resultadoAutoTeste, { chave: dataInicioISO + "|" + dataFimISO, debug: _DEBUG_LOG }));
			const dados = {
				data: dataInicioISO === dataFimISO ? dataInicioISO : `${dataInicioISO} a ${dataFimISO}`,
				gerado_ts: Date.now(),
				totais: { qtd: qtdGeral, total: totalGeral },
				vendedores,
				vendTotaisDia,
				vendas: linhas,
				totaisDia,
				// Proibidos embutidos no HTML para eliminar o "flash" na primeira
				// renderização — o browser usa este valor imediatamente sem esperar
				// o fetch /api/proibidos (que ainda é feito para pegar updates posteriores).
				proibidosServidor: cfgProibidos,
				// Duplicatas Gerencial↔documento fiscal suprimidas/fundidas nesta geração
				// (ver painel "Duplicatas" no HTML) — puramente informativo/auditoria,
				// não afeta o cálculo já feito acima.
				duplicatas: { confirmadas: _duplicatasConfirmadas, provaveis: _duplicatasProvaveis },
				// Resultado do auto-teste desta geração — o navegador mostra botão + caixa de mensagem se houver alerta.
				autoteste: { versao: SCRIPT_VERSION, verificacoes: _resultadoAutoTeste.verificacoes, achados: _resultadoAutoTeste.achados }
			};
			const dadosJSON = _jsonParaScript(dados);
			tick("JSON montado — gerando HTML...");
			// Lista de temas embutida no HTML (mesmo escape do dadosJSON: "<" vira \u003c).
			const temasJSON = JSON.stringify(TEMAS_RELATORIO).replace(/</g, "\\u003c");
			const temasIdsJSON = JSON.stringify(TEMAS_RELATORIO.map(t => t.id)).replace(/</g, "\\u003c");
			const temasClarosJSON = JSON.stringify(TEMAS_LEGADOS_CLAROS).replace(/</g, "\\u003c");
			const html = String.raw`<!doctype html><!-- gerar-relatorio-html.js v${SCRIPT_VERSION} --><html lang="pt-br" data-report-version="${SCRIPT_VERSION}"><head><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="icon" href="/favicon.png"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Relatório ${escHtml(cfgAppName)} ${escHtml(dataBR)}</title>
<script>
      (function(){
        try {
          var TEMAS_VALIDOS = ${temasIdsJSON};
          var t = "";
          try { t = localStorage.getItem("fdb_theme") || ""; } catch (e1) {}
          if (!t) { try { t = (document.cookie.match(/(?:^|;\s*)fdb_theme=([^;]+)/) || [])[1] || ""; } catch (e2) {} }
          if (TEMAS_VALIDOS.indexOf(t) < 0) {
            // Tema que saiu (v3.9.0): os claros viram "Claro", o resto "Escuro" — e a troca é salva.
            var legado = t;
            t = ${temasClarosJSON}.indexOf(legado) >= 0 ? "light" : "ultra-dark";
            if (legado) {
              try { localStorage.setItem("fdb_theme", t); } catch (e3) {}
              try { document.cookie = "fdb_theme=" + t + ";path=/;max-age=31536000;SameSite=Strict"; } catch (e4) {}
            }
          }
          document.documentElement.setAttribute("data-theme", t);
        } catch(e){}
      })();
      // MODO LEVE (v3.10.0): decidido ANTES do primeiro desenho (sem piscar).
      // fdb_perf = "auto" (padrão) | "completo" | "leve" — escolha no menu Tema.
      // No automático: medição salva de visitas anteriores (fdb_perf_auto, vale
      // 7 dias), economia de dados, "reduzir movimento" do sistema ou hardware
      // fraco informado pelo navegador (memória/núcleos). O teste de desempenho
      // roda depois do carregamento (ver _perfMedir).
      window.__perfDecidir = function(){
        try {
          var h = document.documentElement, pref = "", leve = false, motivo = "";
          try { pref = localStorage.getItem("fdb_perf") || ""; } catch (e1) {}
          if (pref === "leve") { leve = true; motivo = "escolhido"; }
          else if (pref !== "completo") {
            var nv = navigator || {}, mem = Number(nv.deviceMemory) || 0, cpu = Number(nv.hardwareConcurrency) || 0, con = nv.connection || {};
            var med = null; try { med = JSON.parse(localStorage.getItem("fdb_perf_auto") || "null"); } catch (e2) {}
            var movel = /Android|iPhone|iPad|iPod|Mobile/i.test(String(nv.userAgent || ""));
            if (med && med.v === "leve" && Date.now() - Number(med.ts || 0) < 7 * 864e5) { leve = true; motivo = "medido"; }
            else if (con.saveData) { leve = true; motivo = "economia de dados"; }
            else if ((mem && mem <= 2) || (cpu && cpu <= 2) || (movel && ((mem && mem <= 3) || (cpu && cpu <= 4)))) { leve = true; motivo = "hardware"; }
            else { try { if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) { leve = true; motivo = "sistema"; } } catch (e3) {} }
          }
          h.setAttribute("data-perf", leve ? "leve" : "completo");
          h.setAttribute("data-perf-pref", pref === "leve" || pref === "completo" ? pref : "auto");
          if (motivo) h.setAttribute("data-perf-motivo", motivo); else h.removeAttribute("data-perf-motivo");
          return leve;
        } catch (e) { return false; }
      };
      window.__perfDecidir();
      // VISUALIZAÇÃO (v3.11.0): "simplificada" (padrão) ou "detalhada" — antes do 1º desenho.
      try { document.documentElement.setAttribute("data-vis", localStorage.getItem("fdb_vis") === "detalhada" ? "detalhada" : "simplificada"); } catch (e) { document.documentElement.setAttribute("data-vis", "simplificada"); }
      // RECARREGAMENTO AUTOMÁTICO (v3.19.0): venda nova/alterada → a tela recarrega sozinha.
      // A página anterior guardou rolagem e filtros (window.__antesRecarga); aqui a nova
      // marca data-recarga — sem animações de entrada nem contagem de valores — para não
      // "piscar", e window.__recargaInfo devolve rolagem e filtros (fim do script).
      try {
        var _rc = JSON.parse(sessionStorage.getItem("__recarga_auto__") || "null");
        sessionStorage.removeItem("__recarga_auto__");
        if (_rc && typeof _rc.ts === "number" && Date.now() - _rc.ts < 20000 && _rc.url === location.pathname + location.search) {
          document.documentElement.setAttribute("data-recarga", "1");
          window.__recargaInfo = _rc;
          // A rolagem é devolvida pelo próprio relatório (com a lista já desenhada); a
          // restauração do navegador, feita cedo demais, pararia antes do ponto certo.
          try { history.scrollRestoration = "manual"; } catch (e) {}
        }
      } catch (e) {}
      // TAMANHO DO TEXTO NO CELULAR (v3.18.0): "fdb_zoom_mob" = 0.8 a 1.4 (padrão 1). Só tem
      // efeito até 680 px (o CSS usa a variável só dentro do @media do celular).
      try { var _z = parseFloat(localStorage.getItem("fdb_zoom_mob")); if (_z >= 0.8 && _z <= 1.4) { document.documentElement.style.setProperty("--zoom-mob", String(_z)); document.documentElement.style.setProperty("--zoom-bar", String(Math.min(_z, 1.2))); } } catch (e) {}
      // No computador (v3.21.0): "fdb_zoom_pc", separado do celular — cada tela pede um tamanho.
      try { var _zp = parseFloat(localStorage.getItem("fdb_zoom_pc")); if (_zp >= 0.8 && _zp <= 1.4) document.documentElement.style.setProperty("--zoom-pc", String(_zp)); } catch (e) {}
      // RECARREGAR AO DETECTAR MUDANÇAS (v3.23.0): "fdb_recarga_auto" = "0" desliga neste
      // aparelho (padrão: ligado). Lido pelo script do servidor antes de recarregar.
      window.__recargaAutoDesligada = function() { try { return localStorage.getItem("fdb_recarga_auto") === "0"; } catch (e) { return false; } };
    </script>
<style>
:root {
  /* PERFORMANCE FIX (ajuste solicitado — foco em computadores mais fracos):
     --top-blur era 16-20px conforme o tema; backdrop-filter é uma das
     propriedades CSS mais pesadas de compor, e quanto maior o raio do
     blur, mais caro (o custo cresce mais rápido que o raio). Reduzido para
     10-12px nos três temas — ainda dá o efeito "vidro fosco", só que bem
     mais barato pra GPUs integradas/mais fracas. Mesmo raciocínio aplicado
     a thead (12px→6px, e consolidado de N células para 1 elemento só),
     .mhead (12px→8px), .mobileBar (20px→12px) e .ov (7px→6px), abaixo. */
  --bg-app: #09090b; --bg-panel: #18181b; --bg-hover: #27272a;
  --border: rgba(255, 255, 255, 0.08); --border-focus: rgba(255, 255, 255, 0.15);
  --text-main: #f4f4f5; --text-muted: #a1a1aa;
  --accent: #3b82f6; --accent-hover: #2563eb; --accent-bg: rgba(59, 130, 246, 0.1);
  --danger: #ef4444; --success: #10b981;
  /* v3.2.0 — antes eram cores fixas no código; agora por tema (padrão = valores antigos) */
  --on-accent: var(--text-main);
  --st-ok: #7ee787; --st-warn: #e3b341; --st-crit: #ff6b6b; --st-info: #8b949e;
  --line-soft: rgba(255, 255, 255, 0.06); --field-bg: rgba(255, 255, 255, 0.03); --field-border: rgba(255, 255, 255, 0.10);
  --top-bg: rgba(24, 24, 27, 0.75); --top-blur: blur(10px);
  --th-bg: rgba(24, 24, 27, 0.95); --mhead-bg: rgba(24, 24, 27, 0.95); --ov-bg: rgba(0, 0, 0, 0.7);
  --chip-bg: transparent; --chip-bg-hover: rgba(255,255,255,0.05);
  --scroll-thumb: rgba(255, 255, 255, 0.15); --scroll-thumb-hover: rgba(255, 255, 255, 0.25);
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px;
  --shadow-sm: 0 1px 2px 0 rgba(0,0,0,0.05); --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.1);
  --shadow-lg: 0 10px 25px -5px rgba(0,0,0,0.5), 0 8px 10px -6px rgba(0,0,0,0.3);
  /* SUAVIZAÇÃO (ajuste solicitado): era cubic-bezier(0.4, 0, 0.2, 1) — uma
     curva "padrão" mais mecânica/linear. Os dois temas realmente selecionáveis
     (ultra-dark e light, abaixo) já usavam a curva mais suave/elegante
     "ease-out" acentuada (0.16, 1, 0.3, 1) — como ambos sobrescrevem
     --easing com a mesma especificidade e vêm depois no CSS, a versão daqui
     de :root já não era usada na prática (só ficaria visível numa fresta de
     alguns milissegundos antes do script inline definir data-theme). Unificado
     para eliminar a inconsistência e garantir a curva elegante mesmo se um
     tema futuro esquecer de redeclarar --easing. */
  --easing: cubic-bezier(0.16, 1, 0.3, 1);
  /* Lista explícita em vez de "all": animar "all" faz o navegador monitorar
     TODAS as propriedades CSS do elemento (inclusive as que nunca mudam) e
     pode disparar transições indesejadas em mudanças não-visuais.
     PERFORMANCE FIX (ajuste solicitado — foco em computadores mais fracos):
     "border-radius" removido de --transition (usada por .badge/.item/
     .cardRow/tbody tr) — conferido contra TODOS os seletores :hover/:focus
     do arquivo e NENHUM desses elementos muda seu próprio border-radius.
     Mantido em --transition-fast porque tbody td PRECISA dele de verdade:
     tbody tr:hover td:first-child/:last-child arredondam os cantos via
     border-top/bottom-*-radius quando a linha é destacada — a forma
     "longhand" dessas propriedades não continha a substring "border-radius"
     na primeira checagem, por isso passou despercebido de início. */
  --transition: background 0.2s var(--easing), border-color 0.2s var(--easing), color 0.2s var(--easing), box-shadow 0.2s var(--easing), transform 0.2s var(--easing);
  --transition-fast: background 0.15s var(--easing), border-color 0.15s var(--easing), border-radius 0.15s var(--easing), color 0.15s var(--easing), box-shadow 0.15s var(--easing), transform 0.15s var(--easing);
  color-scheme: dark;
}
[data-theme="ultra-dark"] {
  --bg-app: #000000; --bg-panel: #0a0a0a; --bg-hover: #171717;
  --border: rgba(255, 255, 255, 0.08); --border-focus: rgba(255, 255, 255, 0.15);
  --text-main: #ededed; --text-muted: #a1a1aa;
  --accent: #0ea5e9; --accent-hover: #0284c7; --accent-bg: rgba(14, 165, 233, 0.12);
  --top-bg: rgba(10, 10, 10, 0.65); --top-blur: blur(12px);
  --th-bg: rgba(10, 10, 10, 0.85); --mhead-bg: rgba(10, 10, 10, 0.8); --ov-bg: rgba(0, 0, 0, 0.8);
  --chip-bg: rgba(255,255,255,0.03); --chip-bg-hover: rgba(255,255,255,0.06);
  --scroll-thumb: rgba(255, 255, 255, 0.1); --scroll-thumb-hover: rgba(255, 255, 255, 0.2);
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px;
  --shadow-sm: 0 1px 2px 0 rgba(0,0,0,0.05); --shadow-md: 0 4px 12px rgba(0,0,0,0.3);
  --shadow-lg: 0 20px 40px -10px rgba(0,0,0,0.8), 0 10px 15px -5px rgba(0,0,0,0.4);
  --easing: cubic-bezier(0.16, 1, 0.3, 1);
  color-scheme: dark;
}
[data-theme="light"] {
  --bg-app: #f8fafc; --bg-panel: #ffffff; --bg-hover: #f1f5f9;
  --border: rgba(0, 0, 0, 0.1); --border-focus: rgba(0, 0, 0, 0.2);
  --text-main: #0f172a; --text-muted: #64748b;
  --accent: #2563eb; --accent-hover: #1d4ed8; --accent-bg: rgba(37, 99, 235, 0.1);
  --top-bg: rgba(255, 255, 255, 0.75); --top-blur: blur(12px);
  --th-bg: rgba(255, 255, 255, 0.9); --mhead-bg: rgba(255, 255, 255, 0.9); --ov-bg: rgba(0, 0, 0, 0.4);
  --chip-bg: rgba(0,0,0,0.03); --chip-bg-hover: rgba(0,0,0,0.06);
  --scroll-thumb: rgba(0, 0, 0, 0.15); --scroll-thumb-hover: rgba(0, 0, 0, 0.25);
  --shadow-sm: 0 1px 2px 0 rgba(0,0,0,0.05); --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
  --shadow-lg: 0 20px 40px -10px rgba(0,0,0,0.12), 0 10px 15px -5px rgba(0,0,0,0.05);
  --st-ok: #15803d; --st-warn: #a16207; --st-crit: #b91c1c; --st-info: #57606a;
  --line-soft: rgba(0, 0, 0, 0.08); --field-bg: rgba(0, 0, 0, 0.03); --field-border: rgba(0, 0, 0, 0.15);
  --easing: cubic-bezier(0.16, 1, 0.3, 1);
  color-scheme: light;
}
/* ── TEMAS DE ESTILO (v3.9.0) ──────────────────────────────────────────────
   Cada tema tem DUAS partes:
   1. [data-theme="id"] { variáveis } — conjunto COMPLETO (nada herdado do :root por
      esquecimento). O mesmo seletor pinta a prévia do menu de temas.
   2. html[data-theme="id"] … — a FORMA: cantos, bordas, brilho, fundo da página, cards,
      tabela, lista de vendedores. Prefixo "html" para nunca atingir a prévia do menu.
   Lista/ordem dos ids: TEMAS_RELATORIO (topo do arquivo). */

/* HUD Ciano — painel de controle futurista: azul-marinho profundo, linhas finas
   ciano com brilho, cantos retos, títulos leves e espaçados. */
[data-theme="hud"] {
  --bg-app: #050b15; --bg-panel: #0a1626; --bg-hover: rgba(34, 211, 238, 0.08);
  --border: rgba(56, 189, 248, 0.26); --border-focus: rgba(56, 189, 248, 0.55);
  --text-main: #dcefff; --text-muted: #7fa6c9;
  --accent: #22d3ee; --accent-hover: #06b6d4; --accent-bg: rgba(34, 211, 238, 0.12); --on-accent: #02121c;
  --danger: #f43f5e; --success: #2dd4bf;
  --top-bg: rgba(6, 16, 30, 0.82); --top-blur: blur(8px);
  --th-bg: rgba(8, 20, 36, 0.97); --mhead-bg: rgba(8, 20, 36, 0.97); --ov-bg: rgba(1, 6, 14, 0.78);
  --chip-bg: rgba(34, 211, 238, 0.04); --chip-bg-hover: rgba(34, 211, 238, 0.1);
  --scroll-thumb: rgba(56, 189, 248, 0.3); --scroll-thumb-hover: rgba(56, 189, 248, 0.5);
  --radius-sm: 2px; --radius-md: 3px; --radius-lg: 4px;
  --shadow-sm: 0 0 0 1px rgba(56, 189, 248, 0.06);
  --shadow-md: 0 0 14px rgba(34, 211, 238, 0.12);
  --shadow-lg: 0 0 0 1px rgba(56, 189, 248, 0.12), 0 0 32px rgba(34, 211, 238, 0.1), 0 18px 40px rgba(0, 0, 0, 0.55);
  --st-ok: #5eead4; --st-warn: #fbbf24; --st-crit: #fb7185; --st-info: #7fa6c9;
  --line-soft: rgba(56, 189, 248, 0.1); --field-bg: rgba(34, 211, 238, 0.04); --field-border: rgba(56, 189, 248, 0.3);
  --easing: cubic-bezier(0.16, 1, 0.3, 1);
  color-scheme: dark;
}
html[data-theme="hud"], html[data-theme="hud"] body { background: radial-gradient(120% 80% at 50% -10%, #17365a 0%, #0a1729 42%, #040912 100%) fixed; }
html[data-theme="hud"] .sidebar, html[data-theme="hud"] .content { background: transparent; }
html[data-theme="hud"] .top { border-bottom-color: rgba(56, 189, 248, 0.35); box-shadow: 0 1px 0 rgba(34, 211, 238, 0.12), 0 8px 24px rgba(0, 0, 0, 0.35); }
html[data-theme="hud"] .tableWrap { background: linear-gradient(180deg, rgba(14, 34, 58, 0.78), rgba(6, 15, 28, 0.9)); border-color: rgba(56, 189, 248, 0.38); position: relative; }
html[data-theme="hud"] .tableWrap::before, html[data-theme="hud"] .tableWrap::after { content: ""; position: absolute; width: 18px; height: 18px; pointer-events: none; z-index: 3; border-color: var(--accent); border-style: solid; opacity: 0.85; }
html[data-theme="hud"] .tableWrap::before { top: -1px; left: -1px; border-width: 2px 0 0 2px; }
html[data-theme="hud"] .tableWrap::after { bottom: -1px; right: -1px; border-width: 0 2px 2px 0; }
html[data-theme="hud"] .tableTitle { font-weight: 300; letter-spacing: 0.03em; color: #e6f6ff; text-shadow: 0 0 14px rgba(34, 211, 238, 0.35); }
html[data-theme="hud"] .sb-title, html[data-theme="hud"] thead th { color: var(--accent); letter-spacing: 0.14em; }
html[data-theme="hud"] .badge { background: rgba(6, 18, 32, 0.6); border-color: rgba(56, 189, 248, 0.35); color: #9cc6e8; border-radius: 2px; }
html[data-theme="hud"] .btn { background: rgba(6, 18, 32, 0.55); border-color: rgba(56, 189, 248, 0.32); }
html[data-theme="hud"] .btn:hover { border-color: var(--accent); color: #e6f6ff; box-shadow: 0 0 12px rgba(34, 211, 238, 0.28), inset 0 0 10px rgba(34, 211, 238, 0.08); }
html[data-theme="hud"] .input { background: rgba(6, 18, 32, 0.55); border-color: rgba(56, 189, 248, 0.32); }
html[data-theme="hud"] .radioBusca { border-radius: 3px; background: rgba(6, 18, 32, 0.55); border-color: rgba(56, 189, 248, 0.32); }
html[data-theme="hud"] .radioBusca .radio { border-radius: 2px; }
html[data-theme="hud"] .radioBusca .radio:has(input:checked) { background: rgba(34, 211, 238, 0.16); box-shadow: inset 0 -2px 0 var(--accent), 0 0 12px rgba(34, 211, 238, 0.2); }
html[data-theme="hud"] .item.sel { background: rgba(34, 211, 238, 0.08); border-color: rgba(56, 189, 248, 0.4); box-shadow: inset 3px 0 0 var(--accent), 0 0 16px rgba(34, 211, 238, 0.12); }
html[data-theme="hud"] .tdItemChip { border-radius: 2px; border-color: rgba(56, 189, 248, 0.28); }
html[data-theme="hud"] .itensQtd { border-radius: 2px; box-shadow: 0 0 8px rgba(34, 211, 238, 0.4); }
html[data-theme="hud"] tbody tr:hover { background: rgba(34, 211, 238, 0.06); }
html[data-theme="hud"] .modal { border-color: rgba(56, 189, 248, 0.5); box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.15), 0 0 40px rgba(34, 211, 238, 0.15), 0 30px 60px rgba(0, 0, 0, 0.6); }
.tmPrev[data-theme="hud"] { background: radial-gradient(120% 90% at 50% 0%, #17365a, #050b15); border-radius: 2px; }

/* Índigo Neon — painel arredondado em índigo/violeta, barra lateral mais clara,
   destaques em degradê ciano→verde-água e botões em pílula. */
[data-theme="indigo"] {
  --bg-app: #1d1b57; --bg-panel: #27257a; --bg-hover: rgba(255, 255, 255, 0.07);
  --border: rgba(170, 176, 255, 0.16); --border-focus: rgba(170, 176, 255, 0.34);
  --text-main: #f1f2ff; --text-muted: #adb2ea;
  --accent: #22d3ee; --accent-hover: #2dd4bf; --accent-bg: rgba(34, 211, 238, 0.14); --on-accent: #0c0b33;
  --danger: #fb7185; --success: #2dd4bf;
  --top-bg: rgba(43, 41, 125, 0.92); --top-blur: blur(8px);
  --th-bg: rgba(39, 37, 122, 0.98); --mhead-bg: rgba(39, 37, 122, 0.98); --ov-bg: rgba(10, 8, 40, 0.72);
  --chip-bg: rgba(255, 255, 255, 0.05); --chip-bg-hover: rgba(255, 255, 255, 0.1);
  --scroll-thumb: rgba(170, 176, 255, 0.28); --scroll-thumb-hover: rgba(170, 176, 255, 0.45);
  --radius-sm: 8px; --radius-md: 12px; --radius-lg: 20px;
  --shadow-sm: 0 2px 6px rgba(8, 6, 40, 0.25); --shadow-md: 0 8px 20px rgba(8, 6, 40, 0.35);
  --shadow-lg: 0 24px 50px -12px rgba(8, 6, 40, 0.7), 0 10px 20px -8px rgba(8, 6, 40, 0.45);
  --st-ok: #5eead4; --st-warn: #fcd34d; --st-crit: #fda4af; --st-info: #adb2ea;
  --line-soft: rgba(255, 255, 255, 0.07); --field-bg: rgba(255, 255, 255, 0.05); --field-border: rgba(170, 176, 255, 0.24);
  --easing: cubic-bezier(0.16, 1, 0.3, 1);
  color-scheme: dark;
}
html[data-theme="indigo"], html[data-theme="indigo"] body { background: linear-gradient(160deg, #2a2884 0%, #1d1b57 55%, #17154a 100%) fixed; }
html[data-theme="indigo"] .content { background: transparent; }
html[data-theme="indigo"] .sidebar { background: linear-gradient(180deg, #4245b3 0%, #3739a0 100%); border-right-color: rgba(255, 255, 255, 0.08); }
html[data-theme="indigo"] .sidebar .sb-title { color: #d6d9ff; }
html[data-theme="indigo"] .sidebar .item .meta, html[data-theme="indigo"] .sidebar .rv .n { color: #d0d4ff; }
html[data-theme="indigo"] .item.sel { background: linear-gradient(90deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.04)); border-color: rgba(255, 255, 255, 0.18); box-shadow: 0 8px 20px rgba(10, 8, 50, 0.3); }
html[data-theme="indigo"] .tableWrap { background: linear-gradient(180deg, #2a2880 0%, #23216d 100%); border-color: rgba(170, 176, 255, 0.14); }
html[data-theme="indigo"] .tableTitle { letter-spacing: 0; }
html[data-theme="indigo"] .btn, html[data-theme="indigo"] .input, html[data-theme="indigo"] .badge { border-radius: 99px; }
html[data-theme="indigo"] .btn { background: transparent; border-color: rgba(170, 176, 255, 0.45); }
html[data-theme="indigo"] .btn:hover { background: rgba(34, 211, 238, 0.12); border-color: var(--accent); }
html[data-theme="indigo"] .badge { background: rgba(255, 255, 255, 0.06); color: #d6d9ff; }
html[data-theme="indigo"] .radioBusca .radio:has(input:checked) { background: linear-gradient(90deg, #2dd4bf, #22d3ee); }
html[data-theme="indigo"] .radioBusca .radio:has(input:checked) span { color: #0c0b33; }
html[data-theme="indigo"] .itensQtd { background: linear-gradient(90deg, #2dd4bf, #22d3ee); }
html[data-theme="indigo"] tbody tr:hover { background: rgba(255, 255, 255, 0.06); }
html[data-theme="indigo"] .modal { border-radius: 22px; }
.tmPrev[data-theme="indigo"] { background: linear-gradient(160deg, #2a2884, #1d1b57); border-radius: 12px; }
.tmPrev[data-theme="indigo"] .tmPSide { background: #4245b3; }
.tmPrev[data-theme="indigo"] .tmPPill { background: linear-gradient(90deg, #2dd4bf, #22d3ee); }

/* Executivo — painel corporativo denso: azul-grafite quase preto, cards retos com
   borda discreta, títulos em caixa alta e destaque laranja sólido. */
[data-theme="executivo"] {
  --bg-app: #0a0f19; --bg-panel: #101826; --bg-hover: #162133;
  --border: #1d2738; --border-focus: #2f3b52;
  --text-main: #eef2f7; --text-muted: #8f9bb0;
  --accent: #f97316; --accent-hover: #ea580c; --accent-bg: rgba(249, 115, 22, 0.12); --on-accent: #ffffff;
  --danger: #ef4444; --success: #22c55e;
  --top-bg: rgba(11, 17, 28, 0.94); --top-blur: blur(6px);
  --th-bg: #131c2b; --mhead-bg: #131c2b; --ov-bg: rgba(2, 5, 12, 0.75);
  --chip-bg: #0d1522; --chip-bg-hover: #142033;
  --scroll-thumb: #2a3549; --scroll-thumb-hover: #3a4862;
  --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3); --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.35);
  --shadow-lg: 0 16px 36px -10px rgba(0, 0, 0, 0.75);
  --st-ok: #4ade80; --st-warn: #fbbf24; --st-crit: #f87171; --st-info: #8f9bb0;
  --line-soft: #172031; --field-bg: #0d1522; --field-border: #243047;
  --easing: cubic-bezier(0.16, 1, 0.3, 1);
  color-scheme: dark;
}
html[data-theme="executivo"] .sidebar { background: #0c121e; }
html[data-theme="executivo"] .top { border-bottom-color: #1d2738; }
html[data-theme="executivo"] .item.sel { background: var(--accent); border-color: var(--accent); box-shadow: 0 6px 18px rgba(249, 115, 22, 0.3); }
html[data-theme="executivo"] .item.sel .nome, html[data-theme="executivo"] .item.sel .tot, html[data-theme="executivo"] .item.sel .meta, html[data-theme="executivo"] .item.sel .qtd { color: #fff; }
html[data-theme="executivo"] .tableTitle { text-transform: uppercase; font-size: 17px; font-weight: 800; letter-spacing: 0.04em; }
html[data-theme="executivo"] .sb-title, html[data-theme="executivo"] thead th { color: #9aa6ba; font-weight: 800; }
html[data-theme="executivo"] thead th { background: #131c2b; }
html[data-theme="executivo"] .badge { border-radius: 6px; background: #101826; color: #c4ccd8; }
html[data-theme="executivo"] .radioBusca { border-radius: 8px; }
html[data-theme="executivo"] .radioBusca .radio { border-radius: 6px; }
html[data-theme="executivo"] .radioBusca .radio:has(input:checked) { background: var(--accent); }
html[data-theme="executivo"] .radioBusca .radio:has(input:checked) span { color: #fff; }
html[data-theme="executivo"] .btn:hover { border-color: var(--accent); color: #fff; }
html[data-theme="executivo"] .tdItemChip { border-radius: 6px; }
html[data-theme="executivo"] .itensQtd { border-radius: 4px; }
html[data-theme="executivo"] tbody tr:hover { background: rgba(249, 115, 22, 0.06); }
.tmPrev[data-theme="executivo"] { border-radius: 4px; }

/* Âmbar Vidro — vidro escuro sobre fundo preto com brilhos âmbar nos cantos,
   cards bem arredondados com reflexo quente e destaque laranja suave. */
[data-theme="ambar"] {
  --bg-app: #0b0907; --bg-panel: #1a1410; --bg-hover: rgba(255, 170, 120, 0.08);
  --border: rgba(255, 180, 140, 0.16); --border-focus: rgba(255, 180, 140, 0.34);
  --text-main: #f7efe8; --text-muted: #b9a89a;
  --accent: #f29462; --accent-hover: #e8784a; --accent-bg: rgba(242, 148, 98, 0.14); --on-accent: #1d0f07;
  --danger: #f87171; --success: #4ade80;
  --top-bg: rgba(20, 15, 12, 0.5); --top-blur: blur(10px);
  --th-bg: rgba(26, 19, 15, 0.97); --mhead-bg: rgba(26, 19, 15, 0.97); --ov-bg: rgba(5, 3, 2, 0.75);
  --chip-bg: rgba(255, 190, 150, 0.05); --chip-bg-hover: rgba(255, 190, 150, 0.1);
  --scroll-thumb: rgba(255, 180, 140, 0.25); --scroll-thumb-hover: rgba(255, 180, 140, 0.42);
  --radius-sm: 8px; --radius-md: 14px; --radius-lg: 22px;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3); --shadow-md: 0 8px 20px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 30px 60px -18px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 180, 140, 0.05);
  --st-ok: #86efac; --st-warn: #fcd34d; --st-crit: #fca5a5; --st-info: #b9a89a;
  --line-soft: rgba(255, 190, 150, 0.08); --field-bg: rgba(255, 190, 150, 0.04); --field-border: rgba(255, 180, 140, 0.22);
  --easing: cubic-bezier(0.16, 1, 0.3, 1);
  color-scheme: dark;
}
html[data-theme="ambar"], html[data-theme="ambar"] body {
  background:
    radial-gradient(45% 60% at 0% 100%, rgba(222, 118, 60, 0.42), transparent 72%),
    radial-gradient(50% 55% at 100% 0%, rgba(222, 118, 60, 0.38), transparent 72%),
    radial-gradient(40% 45% at 100% 100%, rgba(222, 118, 60, 0.3), transparent 72%),
    radial-gradient(30% 35% at 0% 0%, rgba(222, 118, 60, 0.16), transparent 72%),
    #0b0907 fixed;
}
html[data-theme="ambar"] .sidebar, html[data-theme="ambar"] .content { background: transparent; }
html[data-theme="ambar"] .tableWrap, html[data-theme="ambar"] .item.sel, html[data-theme="ambar"] .modal {
  background: linear-gradient(155deg, rgba(255, 170, 120, 0.12) 0%, rgba(34, 25, 20, 0.88) 38%, rgba(18, 13, 10, 0.94) 100%);
}
html[data-theme="ambar"] .tableWrap { border-color: rgba(255, 180, 140, 0.2); }
html[data-theme="ambar"] .item.sel { border-color: rgba(242, 148, 98, 0.45); box-shadow: 0 0 22px rgba(242, 148, 98, 0.18); }
html[data-theme="ambar"] .badge, html[data-theme="ambar"] .btn, html[data-theme="ambar"] .input { background: rgba(26, 19, 15, 0.6); }
html[data-theme="ambar"] .btn:hover { border-color: rgba(242, 148, 98, 0.6); box-shadow: 0 0 16px rgba(242, 148, 98, 0.2); }
html[data-theme="ambar"] .tableTitle { text-transform: uppercase; font-weight: 500; letter-spacing: 0.03em; }
html[data-theme="ambar"] .radioBusca .radio:has(input:checked) { background: transparent; box-shadow: inset 0 -2px 0 var(--accent); }
html[data-theme="ambar"] .radioBusca .radio:has(input:checked) span { color: var(--accent); }
html[data-theme="ambar"] tbody tr:hover { background: rgba(242, 148, 98, 0.06); }
.tmPrev[data-theme="ambar"] { background: radial-gradient(70% 70% at 0% 0%, rgba(214, 112, 56, 0.45), transparent 70%), radial-gradient(70% 70% at 100% 100%, rgba(214, 112, 56, 0.4), transparent 70%), #0b0907; border-radius: 14px; }
.tmPrev[data-theme="ambar"] .tmPSide { background: rgba(34, 25, 20, 0.7); }
/* Brasa Noturna — painel grafite emoldurado sobre fundo azul-noite com brasas
   laranja nas bordas, cards com reflexo quente no canto, títulos em caixa alta,
   abas sublinhadas e gráficos laranja com brilho (barras "acesas" por dentro). */
[data-theme="brasa"] {
  --bg-app: #070a16; --bg-panel: #18171b; --bg-hover: rgba(240, 132, 74, 0.08);
  --border: rgba(255, 255, 255, 0.1); --border-focus: rgba(255, 255, 255, 0.22);
  --text-main: #f4f1ee; --text-muted: #a9a4a1;
  --accent: #f0844a; --accent-hover: #ff9a5c; --accent-bg: rgba(240, 132, 74, 0.14); --on-accent: #1d0d05;
  --danger: #f87171; --success: #4ade80;
  --top-bg: rgba(22, 21, 25, 0.86); --top-blur: blur(10px);
  --th-bg: rgba(24, 23, 27, 0.98); --mhead-bg: rgba(24, 23, 27, 0.98); --ov-bg: rgba(3, 4, 10, 0.78);
  --chip-bg: rgba(255, 255, 255, 0.04); --chip-bg-hover: rgba(255, 255, 255, 0.08);
  --scroll-thumb: rgba(255, 255, 255, 0.16); --scroll-thumb-hover: rgba(240, 132, 74, 0.45);
  --radius-sm: 8px; --radius-md: 12px; --radius-lg: 18px;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.35); --shadow-md: 0 10px 24px rgba(0, 0, 0, 0.45);
  --shadow-lg: 0 30px 60px -18px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.05);
  --st-ok: #4ade80; --st-warn: #fbbf24; --st-crit: #fca5a5; --st-info: #a9a4a1;
  --line-soft: rgba(255, 255, 255, 0.07); --field-bg: rgba(255, 255, 255, 0.04); --field-border: rgba(255, 255, 255, 0.16);
  --easing: cubic-bezier(0.16, 1, 0.3, 1);
  color-scheme: dark;
}
html[data-theme="brasa"], html[data-theme="brasa"] body {
  background:
    radial-gradient(38% 50% at 0% 100%, rgba(226, 116, 58, 0.4), transparent 72%),
    radial-gradient(38% 50% at 100% 100%, rgba(226, 116, 58, 0.34), transparent 72%),
    radial-gradient(34% 42% at 100% 0%, rgba(226, 116, 58, 0.26), transparent 72%),
    radial-gradient(34% 42% at 0% 0%, rgba(226, 116, 58, 0.22), transparent 72%),
    #070a16 fixed;
}
html[data-theme="brasa"] .content { background: transparent; }
html[data-theme="brasa"] .sidebar { background: rgba(20, 19, 23, 0.84); border-right-color: rgba(255, 255, 255, 0.08); }
html[data-theme="brasa"] .top { border-bottom-color: rgba(255, 255, 255, 0.12); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); }
html[data-theme="brasa"] .tableWrap, html[data-theme="brasa"] .modal {
  background: linear-gradient(165deg, rgba(34, 33, 37, 0.95) 0%, rgba(21, 20, 23, 0.96) 58%, rgba(46, 27, 16, 0.95) 100%);
  border-color: rgba(255, 255, 255, 0.12);
}
html[data-theme="brasa"] .tableTitle { text-transform: uppercase; font-weight: 500; letter-spacing: 0.02em; }
html[data-theme="brasa"] .sb-title, html[data-theme="brasa"] thead th { color: #d6d2cf; font-weight: 600; letter-spacing: 0.06em; }
html[data-theme="brasa"] .badge, html[data-theme="brasa"] .btn, html[data-theme="brasa"] .input { background: rgba(28, 27, 31, 0.82); border-color: rgba(255, 255, 255, 0.14); }
html[data-theme="brasa"] .btn:hover { border-color: rgba(240, 132, 74, 0.7); color: #fff; box-shadow: 0 0 16px rgba(240, 132, 74, 0.22); }
html[data-theme="brasa"] .radioBusca { background: rgba(28, 27, 31, 0.82); border-color: rgba(255, 255, 255, 0.14); }
html[data-theme="brasa"] .radioBusca .radio:has(input:checked) { background: transparent; box-shadow: inset 0 -2px 0 var(--accent); }
html[data-theme="brasa"] .radioBusca .radio:has(input:checked) span { color: var(--accent); }
html[data-theme="brasa"] .item.sel { background: linear-gradient(90deg, rgba(240, 132, 74, 0.16), rgba(240, 132, 74, 0.03)); border-color: rgba(240, 132, 74, 0.45); box-shadow: inset 3px 0 0 var(--accent), 0 0 18px rgba(240, 132, 74, 0.14); }
html[data-theme="brasa"] .itensQtd { box-shadow: 0 0 8px rgba(240, 132, 74, 0.45); }
html[data-theme="brasa"] tbody tr:hover { background: rgba(240, 132, 74, 0.06); }
.tmPrev[data-theme="brasa"] { background: radial-gradient(60% 70% at 0% 100%, rgba(226, 116, 58, 0.5), transparent 70%), radial-gradient(60% 70% at 100% 100%, rgba(226, 116, 58, 0.4), transparent 70%), #070a16; border-radius: 12px; }
.tmPrev[data-theme="brasa"] .tmPSide { background: rgba(24, 23, 27, 0.9); }
@keyframes fadeSlideUp { 0% { opacity: 0; transform: translateY(14px); } 100% { opacity: 1; transform: translateY(0); } }
@keyframes fadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }
@keyframes scaleIn { 0% { opacity: 0; transform: scale(0.96); } 100% { opacity: 1; transform: scale(1); } }
@keyframes reveal { 0% { opacity: 0; transform: translateY(-3px) scale(0.96); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
.reveal { animation: reveal 0.32s var(--easing) both; }
/* ── PAINEL DETALHADO (v3.11.0) ─────────────────────────────────────────────
   Menu Tema → Visualização: "Simplificada" (só a tabela) ou "Detalhada"
   (indicadores + gráficos SVG acima da tabela). Gráficos 100% locais, sem
   biblioteca externa; cores = paleta --dsh-1..6 de cada tema. */
:root, [data-theme="ultra-dark"] { --dsh-1: #0ea5e9; --dsh-2: #22c55e; --dsh-3: #f59e0b; --dsh-4: #a855f7; --dsh-5: #f43f5e; --dsh-6: #14b8a6; }
[data-theme="light"]     { --dsh-1: #2563eb; --dsh-2: #16a34a; --dsh-3: #d97706; --dsh-4: #7c3aed; --dsh-5: #dc2626; --dsh-6: #0d9488; }
[data-theme="hud"]       { --dsh-1: #22d3ee; --dsh-2: #38bdf8; --dsh-3: #a5f3fc; --dsh-4: #0ea5e9; --dsh-5: #67e8f9; --dsh-6: #7dd3fc; }
[data-theme="indigo"]    { --dsh-1: #22d3ee; --dsh-2: #2dd4bf; --dsh-3: #60a5fa; --dsh-4: #a78bfa; --dsh-5: #f472b6; --dsh-6: #34d399; }
[data-theme="executivo"] { --dsh-1: #f97316; --dsh-2: #3b82f6; --dsh-3: #22d3ee; --dsh-4: #f59e0b; --dsh-5: #94a3b8; --dsh-6: #22c55e; }
[data-theme="ambar"]     { --dsh-1: #f29462; --dsh-2: #fbbf24; --dsh-3: #fb7185; --dsh-4: #d6c4b5; --dsh-5: #fdba74; --dsh-6: #a3e635; }
[data-theme="brasa"]     { --dsh-1: #f0844a; --dsh-2: #f7d2b4; --dsh-3: #6b7080; --dsh-4: #fbbf24; --dsh-5: #a1a1aa; --dsh-6: #4ade80; }
.dash { display: none; }
html[data-vis="detalhada"] .content { overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
html[data-vis="detalhada"] .dash { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 14px; flex: none; }
/* v3.21.1: a lista ocupa o resto da tela até o rodapé (antes sobrava faixa vazia embaixo,
   principalmente com o texto reduzido — o zoom também encolhia o 78vh). A base continua
   78% da tela para rolar dentro da lista quando o painel de gráficos está aberto. */
html[data-vis="detalhada"] .tableWrap { height: auto; flex: 1 0 min(calc(78vh / var(--zoom-pc, 1)), 900px); min-height: 420px; }
/* Painel minimizado por inteiro ("Restaurar painel"): a lista ocupa exatamente o espaço que
   sobra, sem rolagem extra da página (mínimo 420px em telas muito baixas). */
@media (min-width: 681px) { html[data-vis="detalhada"] .content:has(.dshTopoBtn[data-acao="restaurar-tudo"]) .tableWrap { flex: 1 1 0; } }
.dshCard { min-width: 0; background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-md); padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; position: relative; overflow: hidden; }
.dshKpi { grid-column: span 1; min-height: 112px; }
.dshW2 { grid-column: span 2; } .dshW3 { grid-column: span 3; } .dshW4 { grid-column: span 4; } .dshW6 { grid-column: span 6; }
.dshTit { font-size: 11px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-muted); display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.dshTit .dshExtra { font-size: 11px; font-weight: 700; letter-spacing: 0.02em; text-transform: none; color: var(--accent); white-space: nowrap; }
.dshVal { font-size: clamp(15px, 1.25vw, 22px); font-weight: 800; color: var(--text-main); font-family: 'JetBrains Mono', Consolas, monospace; letter-spacing: -0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dshSub { font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dshSub b { color: var(--text-main); font-weight: 700; }
.dshKpiLin { display: flex; align-items: center; gap: 12px; min-width: 0; }
.dshKpiLin > div { min-width: 0; }
.dshRing { flex: none; }
.dshRing .dshRingTxt { font: 800 11px 'Inter', sans-serif; fill: var(--text-main); }
.dshKpiLin .dshSub { white-space: normal; line-height: 1.35; }
.dshSpark { width: 100%; height: 34px; display: block; margin-top: auto; }
.dshSvg { width: 100%; height: auto; display: block; overflow: visible; }
.dshSvg text { font-family: 'Inter', sans-serif; font-size: 10px; fill: var(--text-muted); }
.dshSvg .dshGrade { stroke: var(--line-soft); stroke-width: 1; }
.dshSvg [data-tip] { cursor: pointer; }
.dshPico rect { fill: var(--accent); } .dshPico text { fill: var(--on-accent); font-weight: 800; }
.dshLeg { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.dshLegIt { display: grid; grid-template-columns: 10px minmax(56px, 1fr) auto auto; gap: 8px; align-items: center; font-size: 12px; color: var(--text-main); cursor: default; }
.dshLegIt[data-tipo] { cursor: pointer; }
.dshLegIt .dshDot { width: 10px; height: 10px; border-radius: 50%; }
.dshLegIt .dshNome { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dshLegIt .dshV { font-family: 'JetBrains Mono', Consolas, monospace; font-weight: 700; white-space: nowrap; }
.dshLegIt .dshP { color: var(--text-muted); font-weight: 700; width: 38px; text-align: right; }
.dshRosca { display: flex; align-items: center; justify-content: center; gap: 14px 16px; min-width: 0; flex-wrap: wrap; }
.dshRosca svg { flex: none; width: 128px; height: 128px; }
.dshRosca .dshLeg { flex: 1 1 200px; }
.dshRosca .dshRoscaV { font: 800 13px 'JetBrains Mono', Consolas, monospace; fill: var(--text-main); }
.dshRosca .dshRoscaS { font: 700 9px 'Inter', sans-serif; fill: var(--text-muted); letter-spacing: 0.08em; }
.dshBarras { display: flex; flex-direction: column; gap: 9px; }
.dshBarra { display: grid; grid-template-columns: minmax(70px, 34%) minmax(0, 1fr) auto; gap: 10px; align-items: center; font-size: 12px; }
.dshBarra.dshClic { cursor: pointer; }
.dshBarra .dshNome { color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dshBarra .dshTrilho { height: 10px; border-radius: 99px; background: var(--line-soft); overflow: hidden; }
.dshBarra .dshEnch { height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--accent), var(--dsh-2)); transform-origin: left; }
.dshBarra .dshV { font-family: 'JetBrains Mono', Consolas, monospace; font-weight: 700; color: var(--text-main); white-space: nowrap; text-align: right; min-width: 92px; }
.dshBarra .dshV small { color: var(--text-muted); font-weight: 600; margin-left: 4px; }
.dshBarra.dshSel .dshNome { color: var(--accent); font-weight: 700; }
.dshTopo { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-height: 30px; }
.dshTopoTit { font-size: 11px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-muted); margin-right: auto; }
.dshTopoInfo { font-size: 11px; color: var(--text-muted); }
.dshTopoBtn { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; font: inherit; font-size: 12px; font-weight: 600; color: var(--text-main); background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius-md); cursor: pointer; }
.dshTopoBtn:hover { border-color: var(--accent); color: var(--accent); }
.dshMinBtn { margin-left: auto; flex: none; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; color: var(--text-muted); background: transparent; border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; }
.dshMinBtn:hover { color: var(--accent); border-color: var(--accent); }
.dshTit { align-items: center; }
.dshTit .dshExtra { margin-left: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.dshTit .dshExtra + .dshMinBtn { margin-left: 8px; }
.dshCard.dshMin { min-height: 0; padding-top: 10px; padding-bottom: 10px; align-self: start; }
.dshCard.dshMin > :not(.dshTit) { display: none !important; }
.dash.dshTudoMin > .dshCard { display: none; }
.dshVazio { font-size: 12px; color: var(--text-muted); padding: 18px 0; text-align: center; }
@keyframes dshCresceY { from { transform: scaleY(0); } to { transform: scaleY(1); } }
@keyframes dshCresceX { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes dshSurge { from { opacity: 0; } to { opacity: 1; } }
.dash.dshAnim .dshCol { transform-box: fill-box; transform-origin: bottom; animation: dshCresceY 0.7s var(--easing) both; }
.dash.dshAnim .dshEnch { animation: dshCresceX 0.7s var(--easing) both; }
.dash.dshAnim .dshArea, .dash.dshAnim .dshLinha, .dash.dshAnim .dshArco { animation: dshSurge 0.8s var(--easing) both; }
.hudAneisLin { display: flex; justify-content: space-around; align-items: flex-start; gap: 10px; flex-wrap: wrap; padding: 6px 0 2px; }
.hudAnelIt { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 96px; cursor: default; }
.hudAnelIt[data-tipo] { cursor: pointer; }
.hudAnel .hudAnelTxt { font: 300 17px 'Inter', sans-serif; fill: #e6f6ff; }
.hudAnelNome { font-size: 14px; font-weight: 300; color: var(--accent); letter-spacing: 0.02em; }
.hudAnelV { font-size: 12px; color: var(--text-muted); font-family: 'JetBrains Mono', Consolas, monospace; max-width: 130px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hudGrande { font: 300 30px 'Inter', sans-serif; color: #e6f6ff; letter-spacing: 0.01em; text-shadow: 0 0 14px rgba(34, 211, 238, 0.35); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hudLinhaTxt { font-size: 12px; color: var(--text-muted); } .hudLinhaTxt b { color: #e6f6ff; font-weight: 600; }
.dshSvg .hudMini { font-size: 9px; fill: rgba(219, 234, 254, 0.6); } .dshSvg .hudEixo { font-size: 11px; fill: #dbeafe; }
.hudTab { display: flex; flex-direction: column; border: 1px solid rgba(219, 234, 254, 0.3); }
.hudTabLin { display: grid; grid-template-columns: 52px 1fr auto; gap: 8px; padding: 9px 12px; font-size: 12px; color: #dbeafe; align-items: center; }
.hudTabLin:nth-child(odd) { background: rgba(56, 120, 160, 0.28); }
.hudTabLin b { font-weight: 300; color: rgba(186, 230, 253, 0.85); font-family: 'JetBrains Mono', Consolas, monospace; }
.hudVends { display: flex; flex-wrap: wrap; justify-content: space-around; gap: 14px 10px; }
.hudVend.dshBarra { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 104px; grid-template-columns: none; }
.hudCaixa { border: 1px solid rgba(219, 234, 254, 0.75); padding: 2px 8px; font: 300 15px 'Inter', sans-serif; color: #e6f6ff; }
.hudVend .hudAnel .hudAnelTxt { font-size: 14px; }
.hudVendNome { font-size: 13px; font-weight: 300; color: var(--accent); max-width: 130px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hudVendV { font-size: 11px; color: var(--text-muted); font-family: 'JetBrains Mono', Consolas, monospace; }
.hudVend.dshSel .hudVendNome { font-weight: 700; text-decoration: underline; }
html[data-theme="hud"] .dshCard { background: linear-gradient(180deg, rgba(14, 34, 58, 0.78), rgba(6, 15, 28, 0.9)); border-color: rgba(56, 189, 248, 0.38); }
html[data-theme="hud"] .dshTit { color: var(--accent); }
html[data-theme="hud"] .dshCard::before { content: ""; position: absolute; top: -1px; left: -1px; width: 14px; height: 14px; border: solid var(--accent); border-width: 2px 0 0 2px; opacity: 0.85; }
html[data-theme="indigo"] .dshCard { background: linear-gradient(180deg, #2a2880 0%, #23216d 100%); border-color: rgba(170, 176, 255, 0.14); }
html[data-theme="executivo"] .dshTit { color: #c4ccd8; }
html[data-theme="ambar"] .dshCard { background: linear-gradient(155deg, rgba(255, 170, 120, 0.12) 0%, rgba(34, 25, 20, 0.88) 38%, rgba(18, 13, 10, 0.94) 100%); border-color: rgba(255, 180, 140, 0.2); }
/* Brasa Noturna no painel: cards de indicador com brasa no canto, gráficos com brilho
   (o brilho usa filtro — fica de fora no modo Leve). */
html[data-theme="brasa"] .dshCard { background: linear-gradient(165deg, #222125 0%, #161518 58%, #22170f 100%); border-color: rgba(255, 255, 255, 0.12); }
html[data-theme="brasa"] .dshKpi { background: radial-gradient(85% 75% at 100% 100%, rgba(232, 120, 60, 0.34), transparent 62%), linear-gradient(160deg, #252428 0%, #161518 62%); }
html[data-theme="brasa"] .dshTit { color: #e7e3e0; font-weight: 600; }
html[data-theme="brasa"] .dshSvg rect.dshCol { fill: rgba(240, 132, 74, 0.2); fill-opacity: 1; stroke: var(--accent); stroke-opacity: 0.9; stroke-width: 1.2; }
html[data-theme="brasa"] .dshPico rect { fill: rgba(22, 21, 25, 0.94); stroke: rgba(255, 255, 255, 0.55); stroke-width: 1; }
html[data-theme="brasa"] .dshPico text { fill: #f4f1ee; }
html[data-theme="brasa"] .dshBarra .dshEnch { background: linear-gradient(90deg, #c2582a, var(--accent) 60%, #ffb27d); }
html[data-theme="brasa"]:not([data-perf="leve"]) .dshLinha, html[data-theme="brasa"]:not([data-perf="leve"]) .dshArco[stroke="var(--accent)"], html[data-theme="brasa"]:not([data-perf="leve"]) .dshArco[stroke="var(--dsh-1)"] { filter: drop-shadow(0 0 5px rgba(240, 132, 74, 0.55)); }
html[data-theme="brasa"]:not([data-perf="leve"]) .dshSvg rect.dshCol { filter: drop-shadow(0 0 6px rgba(240, 132, 74, 0.45)); }
html[data-theme="brasa"]:not([data-perf="leve"]) .dshBarra .dshEnch { box-shadow: 0 0 10px rgba(240, 132, 74, 0.45); }
@media (max-width: 1280px) { html[data-vis="detalhada"] .dash { grid-template-columns: repeat(3, minmax(0, 1fr)); } .dshW4, .dshW6 { grid-column: span 3; } .dshW2 { grid-column: span 3; } }
@media (max-width: 760px) { html[data-vis="detalhada"] .dash { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; } .dshW2, .dshW3, .dshW4, .dshW6 { grid-column: span 2; } .dshVal { font-size: 18px; } .dshRosca svg { width: 120px; height: 120px; } }
/* SAÍDAS (v3.20.0) — só no modo Completo. Janelas: a caixa encolhe e esmaece (no
   celular, desce) enquanto o fundo escurecido some. Lista de vendas e painel: na troca
   (filtro, limpar, minimizar, visualização) o conteúdo antigo desliza e esmaece pela
   transição nativa do navegador (_movTransicao); o resto da tela não se mexe. */
@keyframes movSaiJanela { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(8px) scale(0.94); } }
@keyframes movSaiBaixo { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(48px); } }
@keyframes movVtSai { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(10px) scale(0.99); } }
@keyframes movVtEntra { from { opacity: 0; } to { opacity: 1; } }
html[data-perf="completo"] .ov:not(.on) .modal { animation: movSaiJanela 0.24s var(--easing) forwards; }
html[data-perf="completo"] .ov { transition: opacity 0.26s var(--easing) 0.04s, visibility 0s linear 0.3s; }
html[data-perf="completo"] .ov.on { transition: opacity 0.22s var(--easing), visibility 0s linear 0s; }
@media (max-width: 680px) { html[data-perf="completo"] .ov.sheet:not(.on) .modal { animation: movSaiBaixo 0.26s var(--easing) forwards; } }
html[data-perf="completo"] table, html[data-perf="completo"] #cards { view-transition-name: lista; }
html[data-perf="completo"] #dash { view-transition-name: painel; }
::view-transition-old(root), ::view-transition-new(root) { animation: none; }
::view-transition-group(lista), ::view-transition-group(painel) { animation-duration: 0.3s; animation-timing-function: var(--easing, ease); }
::view-transition-old(lista), ::view-transition-old(painel) { animation: movVtSai 0.22s var(--easing, ease) both; }
::view-transition-new(lista), ::view-transition-new(painel) { animation: movVtEntra 0.28s var(--easing, ease) 0.08s both; }
/* Recarregamento automático (v3.19.0): a tela nova aparece direto, sem animações nem
   transições de entrada (o atributo sai ~1,5 s depois; daí em diante tudo anima normal). */
html[data-recarga] *, html[data-recarga] *::before, html[data-recarga] *::after { animation: none !important; transition: none !important; }
/* ── MOVIMENTO (v3.12.0) — só no modo de desempenho "Completo" ─────────────
   Entrada da página em cascata, linhas da tabela e vendedores surgindo um a
   um, painéis do modo detalhado subindo, gráficos se desenhando, números
   contando, efeito de toque (ondinha) nos botões, troca de tema suave e
   micro-interações com mola. Tudo com transform/opacity (baratos para a
   placa de vídeo). No modo Leve nada disso existe. */
@keyframes movDesce { from { opacity: 0; transform: translateY(-14px); } to { opacity: 1; transform: none; } }
@keyframes movDaEsq { from { opacity: 0; transform: translateX(-18px); } to { opacity: 1; transform: none; } }
@keyframes movSobe { from { opacity: 0; transform: translateY(16px) scale(0.985); } to { opacity: 1; transform: none; } }
@keyframes movLinha { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: none; } }
@keyframes movPop { 0% { opacity: 0; transform: scale(0.9); } 60% { opacity: 1; transform: scale(1.03); } 100% { opacity: 1; transform: none; } }
@keyframes movOnda { from { transform: translate(-50%, -50%) scale(0); opacity: 0.45; } to { transform: translate(-50%, -50%) scale(1); opacity: 0; } }
@keyframes movBrilho { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 45%, transparent); } 100% { box-shadow: 0 0 0 10px transparent; } }
@keyframes dshDesenha { from { stroke-dasharray: 0 2000; } }
@keyframes dshRevela { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }
@keyframes dshAnelGira { from { stroke-dasharray: 0 2000; } }
html[data-perf="completo"] {
  --mola: cubic-bezier(0.34, 1.56, 0.64, 1);
}
/* Entrada da página */
html[data-perf="completo"] .top { animation: movDesce 0.55s var(--easing) backwards; }
html[data-perf="completo"] .top .badge { animation: movPop 0.5s var(--easing) backwards; }
html[data-perf="completo"] .top .badge:nth-child(2) { animation-delay: 0.05s; }
html[data-perf="completo"] .top .badge:nth-child(3) { animation-delay: 0.1s; }
html[data-perf="completo"] .top .badge:nth-child(4) { animation-delay: 0.15s; }
html[data-perf="completo"] .top .right > * { animation: movSobe 0.5s var(--easing) backwards; }
html[data-perf="completo"] .top .right > *:nth-child(2) { animation-delay: 0.04s; }
html[data-perf="completo"] .top .right > *:nth-child(3) { animation-delay: 0.08s; }
html[data-perf="completo"] .top .right > *:nth-child(4) { animation-delay: 0.12s; }
html[data-perf="completo"] .top .right > *:nth-child(5) { animation-delay: 0.16s; }
html[data-perf="completo"] .top .right > *:nth-child(6) { animation-delay: 0.2s; }
html[data-perf="completo"] .top .right > *:nth-child(n+7) { animation-delay: 0.24s; }
html[data-perf="completo"] .sidebar { animation: movDaEsq 0.6s var(--easing) 0.08s backwards; }
html[data-perf="completo"] .tableWrap { animation: movSobe 0.6s var(--easing) 0.12s backwards; }
/* Vendedores e linhas surgindo em cascata (as 20 primeiras; o resto aparece direto) */
html[data-perf="completo"] .list .item { animation: movLinha 0.45s var(--easing) backwards; }
html[data-perf="completo"] tbody tr, html[data-perf="completo"] .cards .cardRow { animation: movLinha 0.42s var(--easing) backwards; }
html[data-perf="completo"] :is(.list .item, tbody tr, .cards .cardRow):nth-child(2) { animation-delay: 0.02s; }
html[data-perf="completo"] :is(.list .item, tbody tr, .cards .cardRow):nth-child(3) { animation-delay: 0.04s; }
html[data-perf="completo"] :is(.list .item, tbody tr, .cards .cardRow):nth-child(4) { animation-delay: 0.06s; }
html[data-perf="completo"] :is(.list .item, tbody tr, .cards .cardRow):nth-child(5) { animation-delay: 0.08s; }
html[data-perf="completo"] :is(.list .item, tbody tr, .cards .cardRow):nth-child(6) { animation-delay: 0.1s; }
html[data-perf="completo"] :is(.list .item, tbody tr, .cards .cardRow):nth-child(7) { animation-delay: 0.12s; }
html[data-perf="completo"] :is(.list .item, tbody tr, .cards .cardRow):nth-child(8) { animation-delay: 0.14s; }
html[data-perf="completo"] :is(.list .item, tbody tr, .cards .cardRow):nth-child(9) { animation-delay: 0.16s; }
html[data-perf="completo"] :is(.list .item, tbody tr, .cards .cardRow):nth-child(10) { animation-delay: 0.18s; }
html[data-perf="completo"] :is(.list .item, tbody tr, .cards .cardRow):nth-child(11) { animation-delay: 0.2s; }
html[data-perf="completo"] :is(.list .item, tbody tr, .cards .cardRow):nth-child(12) { animation-delay: 0.22s; }
html[data-perf="completo"] :is(.list .item, tbody tr, .cards .cardRow):nth-child(13) { animation-delay: 0.24s; }
html[data-perf="completo"] :is(.list .item, tbody tr, .cards .cardRow):nth-child(14) { animation-delay: 0.26s; }
html[data-perf="completo"] :is(.list .item, tbody tr, .cards .cardRow):nth-child(15) { animation-delay: 0.28s; }
html[data-perf="completo"] :is(.list .item, tbody tr, .cards .cardRow):nth-child(n+16) { animation-delay: 0.3s; }
html[data-perf="completo"] :is(tbody tr, .cards .cardRow):nth-child(n+40) { animation: none; }
/* Micro-interações com mola */
html[data-perf="completo"] .btn, html[data-perf="completo"] .badge, html[data-perf="completo"] .tdItemChip, html[data-perf="completo"] .item, html[data-perf="completo"] .tmCard, html[data-perf="completo"] .tmPerfOp, html[data-perf="completo"] .dshMinBtn, html[data-perf="completo"] .dshTopoBtn {
  transition: background 0.25s var(--easing), border-color 0.25s var(--easing), color 0.25s var(--easing), box-shadow 0.3s var(--easing), transform 0.35s var(--mola);
}
html[data-perf="completo"] .btn:active, html[data-perf="completo"] .tmPerfOp:active, html[data-perf="completo"] .dshTopoBtn:active { transform: scale(0.95); transition-duration: 0.08s; }
html[data-perf="completo"] .item:hover { transform: translateX(4px); }
html[data-perf="completo"] .item.sel { animation: movBrilho 0.7s var(--easing) 1; }
html[data-perf="completo"] .tdItemChip:hover { transform: translateY(-1px) scale(1.02); }
html[data-perf="completo"] .tmCard:hover { transform: translateY(-3px); }
html[data-perf="completo"] .radioBusca .radio { transition: background 0.3s var(--easing), color 0.3s var(--easing), box-shadow 0.3s var(--easing), transform 0.35s var(--mola); }
html[data-perf="completo"] .radioBusca .radio:has(input:checked) { animation: movPop 0.4s var(--easing) 1; }
/* Onda de toque (criada pelo JS em botões/opções) */
.movOnda { position: absolute; border-radius: 50%; pointer-events: none; background: currentColor; width: 240%; aspect-ratio: 1; animation: movOnda 0.6s var(--easing) forwards; }
html[data-perf="completo"] :is(.btn, .tmPerfOp, .dshTopoBtn, .radioBusca .radio, .item) { position: relative; overflow: hidden; }
/* Modais: entrada com mola e fundo com fade */
html[data-perf="completo"] .ov.on .modal { animation: movPop 0.42s var(--easing) forwards; }
html[data-perf="completo"] .tmMenu { transition: opacity 0.22s var(--easing), transform 0.35s var(--mola), visibility 0s linear 0.22s; }
/* Painel detalhado: cartões sobem em cascata, gráficos se desenham */
html[data-perf="completo"] .dash.dshAnim > .dshCard { animation: movSobe 0.55s var(--easing) backwards; }
html[data-perf="completo"] .dash.dshAnim > .dshCard:nth-child(3) { animation-delay: 0.04s; }
html[data-perf="completo"] .dash.dshAnim > .dshCard:nth-child(4) { animation-delay: 0.08s; }
html[data-perf="completo"] .dash.dshAnim > .dshCard:nth-child(5) { animation-delay: 0.12s; }
html[data-perf="completo"] .dash.dshAnim > .dshCard:nth-child(6) { animation-delay: 0.16s; }
html[data-perf="completo"] .dash.dshAnim > .dshCard:nth-child(7) { animation-delay: 0.2s; }
html[data-perf="completo"] .dash.dshAnim > .dshCard:nth-child(n+8) { animation-delay: 0.26s; }
html[data-perf="completo"] .dash.dshAnim .dshArco { animation: dshDesenha 1.1s var(--easing) 0.25s backwards; }
html[data-perf="completo"] .dash.dshAnim .dshLinha { animation: dshRevela 1.3s var(--easing) 0.3s backwards; }
html[data-perf="completo"] .dash.dshAnim .dshArea { animation: dshRevela 1.3s var(--easing) 0.3s backwards; }
html[data-perf="completo"] .dash.dshAnim .dshCol { animation-duration: 0.8s; animation-timing-function: var(--mola); }
html[data-perf="completo"] .dshCard { transition: transform 0.35s var(--mola), box-shadow 0.3s var(--easing), border-color 0.3s var(--easing); }
html[data-perf="completo"] .dshCard:hover { transform: translateY(-3px); box-shadow: var(--shadow-lg); border-color: var(--border-focus); }
html[data-perf="completo"] .dshSvg circle[data-tip], html[data-perf="completo"] .dshSvg rect[data-tip] { transition: transform 0.25s var(--mola), opacity 0.2s; transform-box: fill-box; transform-origin: center; }
html[data-perf="completo"] .dshSvg circle[data-tip]:hover { transform: scale(1.6); }
html[data-perf="completo"] .dshSvg rect.dshCol:hover { opacity: 0.75; }
html[data-perf="completo"] .dshRosca .dshArco { transition: stroke-width 0.25s var(--mola); }
html[data-perf="completo"] .dshRosca .dshArco:hover { stroke-width: 24; }
html[data-perf="completo"] .dshBarra .dshEnch { transition: filter 0.2s; }
html[data-perf="completo"] .dshBarra:hover .dshEnch { filter: brightness(1.25); }
/* Troca de tema suave (classe ligada por ~0,6 s pelo JS) */
html.movTema, html.movTema *, html.movTema *::before, html.movTema *::after {
  transition: background-color 0.55s var(--easing), color 0.55s var(--easing), border-color 0.55s var(--easing), fill 0.55s var(--easing), stroke 0.55s var(--easing), box-shadow 0.55s var(--easing) !important;
}
/* MODO LEVE (v3.10.0) — aparelhos fracos (automático) ou escolhido no menu Tema.
   Mantém o visual do tema, mas tira o que pesa para GPU/CPU fracas: animações de
   entrada, desfoque (backdrop-filter — o efeito mais caro de compor), sombras
   grandes, brilho de texto e fundo "fixed" (repintado a cada rolagem). Transições
   ficam curtíssimas (80 ms) em vez de sumirem: resposta visual sem custo. */
html[data-perf="leve"] {
  --shadow-sm: none; --shadow-md: 0 2px 6px rgba(0, 0, 0, 0.22); --shadow-lg: 0 6px 16px rgba(0, 0, 0, 0.3);
  --top-blur: none;
}
html[data-perf="leve"] *, html[data-perf="leve"] *::before, html[data-perf="leve"] *::after {
  animation-duration: 0.001ms !important; animation-delay: 0s !important; animation-iteration-count: 1 !important;
  transition-duration: 0.08s !important; transition-delay: 0s !important;
  backdrop-filter: none !important; -webkit-backdrop-filter: none !important;
  text-shadow: none !important; scroll-behavior: auto !important; will-change: auto !important;
}
html[data-perf="leve"], html[data-perf="leve"] body { background-attachment: scroll !important; }
html[data-perf="leve"] .__nc_toast_bar { display: none !important; }
html[data-perf="leve"] .badge:hover, html[data-perf="leve"] .btn:hover, html[data-perf="leve"] .btn:active { transform: none !important; }
html[data-perf="leve"] .ov { background: rgba(0, 0, 0, 0.72); }
/* PERFORMANCE FIX (ajuste solicitado — foco em computadores mais fracos):
   respeita a preferência de "reduzir movimento" do sistema operacional
   (Configurações > Acessibilidade no Windows) — quem já configurou isso,
   geralmente por hardware limitado ou sensibilidade a movimento, passa a
   ver transições/animações praticamente instantâneas em vez de suprimidas
   à força (roda muito rápido em vez de "nada" — evita saltos visuais
   abruptos que a remoção total causaria). Rede de segurança adicional aos
   ajustes de blur/propriedades acima; não muda nada para quem não ativou
   essa preferência. */
@media (prefers-reduced-motion: reduce) {
  html:not([data-perf-pref="completo"]) *, html:not([data-perf-pref="completo"]) *::before, html:not([data-perf-pref="completo"]) *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; margin: 0; background: var(--bg-app); color: var(--text-main); font-family: 'Inter', sans-serif; overflow: hidden; -webkit-font-smoothing: antialiased; }
.mono { font-family: 'JetBrains Mono', Consolas, monospace; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--scroll-thumb); border-radius: 10px; border: 2px solid var(--bg-app); }
::-webkit-scrollbar-thumb:hover { background: var(--scroll-thumb-hover); }
.app { height: 100%; max-height: 100vh; display: grid; grid-template-rows: auto 1fr; grid-template-columns: minmax(0, 1fr); overflow: hidden; animation: fadeIn 0.28s var(--easing); }
.top { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; gap: 16px; padding: 16px 28px; background: var(--top-bg); backdrop-filter: var(--top-blur); border-bottom: 1px solid var(--border); z-index: 50; box-shadow: var(--shadow-sm); }
/* AJUSTE SOLICITADO: "overflow: hidden" removido daqui. Estava cortando
   conteudo que ultrapassasse a largura da barra superior (o filtro de
   vendedor com nome longo, badges, etc.) em vez de deixar transbordar.
   "min-width: 0" foi MANTIDO de proposito: e' o que permite que os filhos
   flex encolham abaixo do proprio conteudo, entao os elementos que tem
   text-overflow:ellipsis proprio (.vendTxt, por exemplo) continuam
   truncando com "..." normalmente — sem ele, o ellipsis daqueles filhos
   pararia de funcionar. */
.top .left { display: flex; flex-wrap: nowrap; gap: 14px; align-items: center; justify-content: space-between; min-width: 0; }
.badges { display: flex; gap: 10px; align-items: center; flex-wrap: nowrap; }
.top.badgesCompactos .badge { font-size: 10px; letter-spacing: 0.02em; padding: 5px 9px; }
/* GARANTIA (v3.8.7): nunca estoura — sem espaço, os badges descem de linha e o
   total, sozinho na linha e ainda maior que ela, quebra o próprio texto. */
.top .badges { flex-wrap: wrap; min-width: 0; flex: 1 1 auto; justify-content: flex-end; row-gap: 6px; }
.top #bDiaBrk { white-space: normal; flex-wrap: wrap; max-width: 100%; min-width: 0; line-height: 1.5; }
.top #bDiaBrk > span { white-space: nowrap; }
.top #bDiaBrk #tDiaBrkMini { white-space: normal; }
.top #bDiaBrk #tDiaBrkMini > span { white-space: nowrap; }
.radio span { white-space: nowrap; }
.badge { display: inline-flex; align-items: center; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); background: var(--bg-panel); border: 1px solid var(--border); padding: 6px 12px; border-radius: 99px; white-space: nowrap; transition: var(--transition); box-shadow: var(--shadow-sm); }
.badge:hover { border-color: var(--accent); color: var(--accent); transform: translateY(-1px); }
.badgeHora { background: transparent; border-color: transparent; box-shadow: none; }
.top .right { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; row-gap: 10px; }
/* vendBtn trunca o nome do vendedor — nunca força a topbar a crescer */
.vendBtn { display: none; max-width: 260px; min-width: 0; }
.vendIcon { flex-shrink: 0; display: flex; align-items: center; }
.vendTxt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.input { flex: 1 1 auto; background: var(--bg-panel); border: 1px solid var(--border); color: var(--text-main); padding: 10px 16px; font-size: 13px; border-radius: var(--radius-md); outline: none; transition: var(--transition-fast); width: 100%; }
.input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-bg); }
/* Wrapper do campo de busca com X interno */
.inputWrap { position: relative; flex: 1 1 160px; display: flex; align-items: center; min-width: min(160px, 100%); }
.inputWrap .input { padding-right: 36px; }
.inputWrap #limpar {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  width: 24px; height: 24px; padding: 0; border: none; border-radius: 50%;
  background: transparent; box-shadow: none; font-size: 13px; font-weight: 700;
  color: var(--text-muted); opacity: 0; pointer-events: none;
  transition: opacity 0.15s, color 0.15s, background 0.15s;
  display: flex; align-items: center; justify-content: center;
}
.inputWrap #limpar:hover { background: var(--bg-hover); color: var(--text-main); transform: translateY(-50%); box-shadow: none; }
.inputWrap #limpar.visivel { opacity: 1; pointer-events: auto; }
.radioBusca { display: flex; align-items: center; gap: 6px; background: var(--bg-panel); padding: 4px; border-radius: 99px; border: 1px solid var(--border); }
.radioBusca .radio { user-select: none; display: inline-flex; align-items: center; padding: 6px 16px; border-radius: 99px; background: transparent; cursor: pointer; transition: var(--transition-fast); margin: 0; }
.radioBusca .radio input { display: none; }
.radioBusca .radio span { font-size: 12px; font-weight: 600; color: var(--text-muted); transition: var(--transition-fast); }
.radioBusca .radio:hover:not(:has(input:checked)) { background: var(--bg-hover); }
.radioBusca .radio:has(input:checked) { background: var(--bg-hover); box-shadow: var(--shadow-sm); }
.radioBusca .radio:has(input:checked) span { color: var(--text-main); }
.btn { cursor: pointer; background: var(--bg-panel); border: 1px solid var(--border); color: var(--text-main); font-weight: 500; font-size: 13px; padding: 0 18px; border-radius: var(--radius-md); height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; transition: var(--transition-fast); white-space: nowrap; box-shadow: var(--shadow-sm); }
.btn:hover { background: var(--bg-hover); border-color: var(--text-muted); transform: translateY(-2px); box-shadow: var(--shadow-md); }
.btn:active { transform: translateY(0); }
.btnIcon { padding: 0; width: 38px; font-size: 16px; flex-shrink: 0; }
/* Botões com ícone SVG + texto */
.btnLabel { gap: 7px; padding: 0 14px; font-size: 12px; font-weight: 600; }
.btnLabel svg { flex-shrink: 0; }
.btnProibidos { display: none; } .badgeGeradoMobile { display: none; }
.main { min-height: 0; display: grid; grid-template-columns: 280px minmax(0, 1fr); }
.sidebar { min-height: 0; border-right: 1px solid var(--border); padding: 24px 20px; display: flex; flex-direction: column; background: var(--bg-app); }
.sb-head { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; margin-bottom: 12px; }
.sb-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); font-weight: 700; }
.list { min-height: 0; overflow-y: auto; flex: 1 1 50%; padding-right: 4px; margin-bottom: 20px; }
.item { display: flex; align-items: center; justify-content: space-between; padding: 5px; background: transparent; border-radius: var(--radius-md); margin-bottom: 5px; cursor: pointer; border: 1px solid transparent; transition: var(--transition); }
.item:hover { background: var(--bg-panel); border-color: var(--border); }
.item.sel { background: var(--bg-panel); border-color: var(--border-focus); box-shadow: var(--shadow-md); }
.item .nome { font-weight: 500; font-size: 13px; color: var(--text-muted); transition: var(--transition-fast); }
.item.sel .nome, .item:hover .nome { color: var(--text-main); font-weight: 600; }
.item .meta { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
.item .qtd { font-size: 11px; color: var(--text-muted); }
.item .tot { font-size: 13px; font-weight: 600; color: var(--text-main); font-family: 'JetBrains Mono', monospace; }
.sbResumo { display: flex; flex-direction: column; flex: 0 100 50%; min-height: 0; border-top: 1px solid var(--border); padding-top: 20px; }
.sbResumoBody { overflow-y: auto; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; margin-left: -12px; }
.rv { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: transparent; border-radius: var(--radius-md); transition: var(--transition-fast); }
.rv:hover { background: var(--bg-panel); box-shadow: var(--shadow-sm); }
.rv .n { font-size: 13px; font-weight: 500; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 65%; }
.rv .v { font-size: 13px; font-weight: 600; color: var(--text-main); font-family: 'JetBrains Mono', Consolas, monospace; }
.content { min-height: 0; padding: 20px; background: var(--bg-app); }
.tableWrap { height: 100%; display: flex; flex-direction: column; background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); overflow: hidden; }
.tableTop { display: flex; flex-direction: column; gap: 6px; padding: 19px 23px; border-bottom: 1px solid var(--border); background: var(--bg-panel); }
.tableTitle { font-size: 20px; font-weight: 700; color: var(--text-main); letter-spacing: -0.02em; }
.count { font-size: 13px; color: var(--text-muted); font-weight: 500; margin: 7px 4px; }
.btns { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; padding-top: 6px; }
.itensMiniHead { display: flex; flex-direction: row; justify-content: space-between; align-items: center; gap: 10px; margin: 0 0 10px 0; padding-bottom: 8px; border-bottom: 1px dashed var(--border-focus); font-size: 11px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em; color: var(--text-muted); }
.itensMiniHead .sub { font-size: 10px; color: var(--text-main); background: var(--bg-panel); padding: 3px 8px; border-radius: 99px; border: 1px solid var(--border-focus); font-weight: 600; letter-spacing: 1px; text-transform: none; }
.itensChips { display: flex; flex-wrap: wrap; gap: 6px; flex-direction: column; }
.itensChip { display: inline-flex; align-items: center; background: var(--chip-bg); border: 1px solid var(--border-focus); padding: 4px 10px 4px 4px; border-radius: 99px; font-size: 12px; font-weight: 500; color: var(--text-muted); transition: var(--transition-fast); max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cardRow:hover .itensChip, .kv:hover .itensChip { border-color: var(--text-muted); color: var(--text-main); background: var(--chip-bg-hover); }
.itensQtd { color: var(--on-accent); background: var(--accent); margin-right: 6px; padding: 2px 6px; border-radius: 99px; font-size: 12px; font-weight: 700; font-family: 'JetBrains Mono', Consolas, monospace; box-shadow: var(--shadow-sm); letter-spacing: 1px; }
span#vendTopTxt {
	margin-top: 2.5px;
    /*max-width: 52px;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;*/
}
span#tDiaSel { margin-right: 3px; }
.badge[data-tip="Data dos dados desse relatório"],.badge[data-tip="Dia, hora e mês em que esse relatório foi gerado"] { letter-spacing: 1px; }
span#tQtdGer, span#tQtdNfce { margin: 0 5px; } div#vendSel { margin-right: 5px; }
table { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; display: block; flex: 1 1 auto; overflow: auto; --sbw: 0px; }
/* PERFORMANCE FIX (ajuste solicitado — foco em computadores mais fracos):
   background+backdrop-filter estavam em "thead th" (repetidos em CADA
   célula do cabeçalho — 8-12 regiões de blur recalculadas a cada frame de
   scroll, já que o cabeçalho é sticky). Consolidado para UMA vez em
   "thead" (elemento pai) — mesmo efeito visual, uma fração do custo de
   composição por frame. Blur também reduzido de 12px para 6px: como
   --th-bg já é quase opaco (85-95%), pouca coisa "atrás" do cabeçalho
   chega a aparecer mesmo sem blur nenhum — 6px já é suficiente para
   suavizar a borda de conteúdo passando por baixo, sem o custo de 12px. */
thead { position: sticky; top: 0; z-index: 10; display: table; width: 100%; table-layout: fixed; background: var(--th-bg); backdrop-filter: blur(6px); }
thead th { color: var(--text-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; padding: 12px 8px; border-bottom: 1px solid var(--border); text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
tbody { display: table; width: 100%; table-layout: fixed; }
tbody tr { background: transparent; transition: var(--transition); cursor: pointer; }
tbody td { padding: 12px 8px; border-bottom: 1px solid var(--border); font-size: 13px; color: var(--text-muted); vertical-align: middle; transition: var(--transition-fast); overflow: hidden; }
tbody tr:hover { background: var(--bg-hover); transform: translateY(-1px); box-shadow: var(--shadow-md); position: relative; z-index: 5; }
tbody tr:hover td { border-bottom-color: transparent; color: var(--text-main); }
tbody tr:hover td:first-child { border-top-left-radius: var(--radius-md); border-bottom-left-radius: var(--radius-md); }
tbody tr:hover td:last-child { border-top-right-radius: var(--radius-md); border-bottom-right-radius: var(--radius-md); }
/* Colunas com larguras fixas — thead e tbody usam table-layout:fixed, então as larguras do col/thead definem tudo */
thead th:nth-child(1), tbody td:nth-child(1) { width: 15%; text-align: center; padding-left: 14px; font-weight: 600; }
thead th:nth-child(2), tbody td:nth-child(2) { width: 68px; text-align: center; }
thead th:nth-child(3), tbody td:nth-child(3) { width: 80px; text-align: center; }
thead th:nth-child(4), tbody td:nth-child(4) { width: 11%; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
thead th:nth-child(5), tbody td:nth-child(5) { width: 108px; text-align: center; font-weight: 700; color: var(--text-main); white-space: nowrap; }
thead th:nth-child(6), tbody td:nth-child(6) { width: 15%; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
thead th:nth-child(7), tbody td:nth-child(7) { width: auto; text-align: center; padding-left: 8px; }
thead tr { user-select: none; }
.tdItemsWrap { display: flex; flex-wrap: wrap; gap: 6px; }
.tdItemChip { display: block; align-items: center; background: var(--chip-bg); border: 1px solid var(--border-focus); padding: 6px 12px; border-radius: 99px; font-size: 12px; font-weight: 500; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; transition: var(--transition-fast); width: 100%; text-align: center; }
.tdItemMais { color: var(--accent); border-color: var(--accent-bg); font-weight: 700; background: var(--accent-bg); }
tbody tr:hover .tdItemChip { border-color: var(--text-muted); color: var(--text-main); background: var(--chip-bg-hover); }
tbody tr:hover .tdItemMais { border-color: var(--accent); color: var(--accent); background: var(--accent-bg); }
.tdItemDesc { color: var(--danger, #e55); border-color: var(--danger, #e55); border-color: color-mix(in srgb, var(--danger, #e55) 45%, transparent); background: color-mix(in srgb, var(--danger, #e55) 12%, transparent); font-weight: 700; }
.tdItemDup { color: var(--accent); border-color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, transparent); background: color-mix(in srgb, var(--accent) 12%, transparent); font-weight: 700; cursor: pointer; }
tbody tr:hover .tdItemDup { color: var(--accent); background: color-mix(in srgb, var(--accent) 20%, transparent); }
.btn.dupEscolhido { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 700; }
.dupEscolhaTxt { margin-bottom: 6px; font-size: 12px; font-weight: 600; color: var(--accent); }
@keyframes dupPisca { 0%, 100% { background: transparent; } 30% { background: color-mix(in srgb, var(--accent) 22%, transparent); } }
.dupItem.dupDestaque { animation: dupPisca 1.6s ease 2; border-radius: 10px; }
tbody tr:hover .tdItemDesc { color: var(--danger, #e55); border-color: var(--danger, #e55); background: color-mix(in srgb, var(--danger, #e55) 18%, transparent); }
.tdItemQtd { color: var(--accent); font-weight: 700; margin-right: 6px; font-family: 'JetBrains Mono', monospace; }
.itensMini .itensChips { max-height: 220px; overflow-y: auto; padding-right: 4px; scroll-behavior: smooth; }
.itensMini.big { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.itensMini.big .itensChips { flex: 1 1 auto; overflow-y: auto; min-height: 60px; max-height: none; padding-right: 6px; scroll-behavior: smooth; }
/* SUAVIZAÇÃO (ajuste solicitado): antes, ".ov" ficava oculto via
   "display:none" e ".ov.on" trocava para "display:flex" — como "display"
   não é uma propriedade animável (é tudo-ou-nada), toggle da classe para
   FECHAR fazia o overlay sumir instantaneamente, sem nenhum fade, mesmo
   com "transition: opacity" declarado (o navegador nunca chegava a
   renderizar o passo intermediário antes de remover o elemento da árvore
   de renderização). Trocado pelo padrão já usado com sucesso em #__tip
   neste mesmo arquivo: o elemento fica sempre "display:flex" e o
   oculto/visível é controlado só por opacity + visibility + pointer-events
   — isso anima nos DOIS sentidos (abrir E fechar) sem precisar de nenhum
   ajuste na parte JavaScript que só faz classList.add/remove("on")
   (abrirModal/fecharModal, abrirAcoes/fecharAcoes, abrir/fecharVendedores).
   "visibility" some só DEPOIS do fade (transition-delay = duração do fade)
   ao fechar, e aparece IMEDIATAMENTE ao abrir — truque padrão para permitir
   transição suave em elementos que também precisam ficar fora da árvore de
   acessibilidade/cliques quando ocultos. Duração de saída (0.16s) um pouco
   mais rápida que a de entrada (0.22s) — combinação clássica de UI
   "chegada com leve flourish, saída ágil" usada por padrão em interfaces
   modernas. will-change avisa o navegador com antecedência para evitar o
   primeiro frame de abertura/fechamento ficar "pesado" (jank perceptível). */
.ov { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: var(--ov-bg); backdrop-filter: blur(6px); z-index: 9998; padding: 20px; opacity: 0; visibility: hidden; pointer-events: none; will-change: opacity; transition: opacity 0.16s var(--easing), visibility 0s linear 0.16s; }
.ov.on { opacity: 1; visibility: visible; pointer-events: auto; transition: opacity 0.22s var(--easing), visibility 0s linear 0s; }
.ov.on .modal { animation: scaleIn 0.22s var(--easing) forwards; }
.modal { width: min(720px, 100%); max-height: 90vh; display: flex; flex-direction: column; background: var(--bg-panel); border: 1px solid var(--border-focus); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); overflow: hidden; will-change: transform, opacity; }
.mhead { display: flex; padding: 24px; background: var(--mhead-bg); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 10; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: space-between; }
.mtitle { font-size: 22px; font-weight: 700; color: var(--text-main); letter-spacing: -0.02em; }
.msub { font-size: 13px; color: var(--text-muted); margin-top: 4px; }
.mbody { display: flex; flex-direction: column; gap: 5px; padding: 12px; overflow: auto; flex: 1 1 auto; min-height: 0; }
.mbody .kv { flex-shrink: 0; }
/* ── Tabela de itens do modal de detalhes ────────────────────────────────────
   Reseta as propriedades globais "table { display:block; overflow:auto; flex:1 1 auto }"
   que se aplicam a TODAS as tables — aqui precisamos de comportamento de table normal,
   pois o scroll é gerenciado pelo wrapper .itensDetalheScroll                         */
.itensDetalheList { display:table; overflow:visible; flex:none; width:100%; border-collapse:collapse; font-size:12px; }
/* Cada linha vira flex — space-between distribui qtd | desc | preço pelo width total */
.itensDetalheList tr { display:flex; align-items:center; justify-content:space-between; width:100%; border-bottom:1px solid var(--border); cursor:default; gap:0; }
.itensDetalheList tr.cancelado { opacity:0.45; text-decoration:line-through; }
.itensDetalheList td { padding:5px 6px; vertical-align:middle; }
/* Qtd: largura fixa à esquerda — mono, negrito */
.itensDetalheList td.iqtd { flex-shrink:0; color:var(--text-main); font-weight:700; font-family:'JetBrains Mono',Consolas,monospace; white-space:nowrap; width:50px; text-align:right; padding-right:8px; }
/* Desc: ocupa TODO o espaço restante — trunca se ultrapassar */
.itensDetalheList td.idesc { flex:1 1 0; min-width:0; color:var(--text-main); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-left:78px; }
.itensDetalheList td.idesc .icancelLabel { font-size:10px; color:var(--danger,#e55); margin-left:6px; font-weight:600; letter-spacing:0.04em; }
/* Preço: largura fixa à direita — mono, negrito */
.itensDetalheList td.ipreco { flex-shrink:0; text-align:right; white-space:nowrap; font-family:'JetBrains Mono',Consolas,monospace; font-weight:600; color:var(--text-main); width:120px; }
.itensDetalheList td.ipreco.desc { color:var(--danger,#e55); }
/* Scroll estilizado para o corpo dos itens (scroll Y fino, 6px) */
.itensDetalheScroll { overflow-y:auto; flex:1 1 auto; min-height:0; }
.itensDetalheScroll::-webkit-scrollbar { width:6px; }
.itensDetalheScroll::-webkit-scrollbar-track { background:transparent; }
.itensDetalheScroll::-webkit-scrollbar-thumb { background:var(--scroll-thumb); border-radius:10px; }
.itensDetalheScroll::-webkit-scrollbar-thumb:hover { background:var(--scroll-thumb-hover); }
/* Footer fixo do total — sem border-top (últimos itens já têm borda), só padding/margem */
.itensDetalheFoot { flex-shrink:0; display:flex; justify-content:space-between; align-items:center; padding:6px 6px 2px 6px; margin-top:4px; }
.itensDetalheFoot .ilabel { color:var(--text-muted); font-size:11px; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; }
.itensDetalheFoot .itotal { font-family:'JetBrains Mono',Consolas,monospace; font-weight:700; color:var(--accent); font-size:13px; }
/* ── Grid 2 colunas para os kv de detalhes da venda (exceto Itens) ──────────
   Cada kv ocupa uma célula do grid — alinhados uniformemente lado a lado       */
.kvCompactGrid { display:grid; grid-template-columns:1fr 1fr; gap:5px; flex-shrink:0; }
/* kv compacto: chave com largura fixa para alinhamento uniforme no grid */
.kv.kvCompact { grid-template-columns:68px 1fr; padding:8px 12px; gap:8px; align-items:center; }
.kv.kvCompact .k { font-size:10.5px; margin-top:0; }
.kv.kvCompact .v { font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* v3.2.1: o campo Hora agora leva hora + data ("16:43 19/05/26", ~14 caracteres); no celular a célula de meia
   largura só comporta ~7 e cortaria a data — ocupa a linha inteira; dense deixa o campo seguinte preencher o vão. */
@media (max-width: 680px) { .kvCompactGrid { grid-auto-flow: dense; } .kvCompactGrid .kvHora { grid-column: 1 / -1; } }
/* kvItens ocupa o espaço restante com scroll interno + footer fixo */
.mbody .kvItens { overflow:hidden; display:flex; flex-direction:column; }
.kvItens .v { overflow:hidden; min-height:0; display:flex; flex-direction:column; }
.kv { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 16px; align-items: flex-start; background: var(--bg-app); border: 1px solid var(--border); padding: 16px 20px; border-radius: var(--radius-md); transition: var(--transition-fast); }
.kv:hover { border-color: var(--border-focus); background: var(--bg-hover); }
.kv.kvSep { background: transparent; border-color: transparent; padding: 18px 20px 4px; }
.kv.kvSep:hover { background: transparent; border-color: transparent; }
.kv.kvNew .k::after { content: " ✦"; color: var(--accent); font-size: 10px; }
.k { font-size: 12px; color: var(--text-muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 2px; }
.v { font-size: 14px; font-weight: 500; color: var(--text-main); }
.cards { display: none; padding: 16px; overflow-y: auto; }
.cardRow { background: var(--bg-panel); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 24px; margin-bottom: 16px; cursor: pointer; transition: var(--transition); box-shadow: var(--shadow-sm); }
.cardRow:hover { border-color: var(--border-focus); transform: translateY(-4px) scale(1.01); box-shadow: var(--shadow-lg); background: var(--bg-hover); }
.cardHead { display: flex; justify-content: space-between; margin-bottom: 12px; align-items: center;}
.cardNum { font-family: 'JetBrains Mono', monospace; color: var(--text-muted); font-size: 14px; font-weight: 600; }
.cardTotal { font-weight: 700; color: var(--accent); font-size: 20px; }
.cardMeta, .cardPay { font-size: 13px; color: var(--text-main); margin-bottom: 6px; font-weight: 500; }
.cardPay { color: var(--text-muted); }

@media (max-width: 1024px) { .top { grid-template-columns: minmax(0, 1fr); padding: 16px 20px; } .top .right { justify-content: flex-start; flex-wrap: wrap; } .content { padding: 20px; } }
@media (max-width: 920px) { .main { grid-template-columns: minmax(0, 1fr); } .sidebar { display: none; } .vendBtn { display: flex; } #acoes { display: inline-flex; } .radioBusca { flex: 1 1 100%; justify-content: space-between; } }
@media (max-width: 680px) {
  .content { padding: 12px; } .tableTop { padding: 20px; } table { display: none; } .cards { display: block; padding-bottom: 100px; }
  .mobileBar { display: flex; position: fixed; bottom: 0; left: 0; right: 0; background: var(--top-bg); backdrop-filter: blur(12px); padding: 16px 20px 24px 20px; gap: 12px; border-top: 1px solid var(--border); z-index: 50; box-shadow: 0 -10px 40px rgba(0,0,0,0.5); }
  .mobileBar .btn { flex: 1; height: 48px; font-weight: 600; border-radius: var(--radius-lg); }
  .ov.sheet { align-items: flex-end; padding: 12px; } .ov.sheet .modal { border-radius: 24px 24px 12px 12px; padding: 24px; animation: fadeSlideUp 0.26s var(--easing) forwards;} .badges .badgeHora { display: none; }
}
/* ── CELULAR (v3.15.0) ──────────────────────────────────────────────────────
   No celular a página rola INTEIRA (no PC continua o layout fixo com a tabela
   rolando por dentro): antes o topo e o cabeçalho ficavam presos e as vendas
   rolavam numa faixa estreita entre eles e a barra de baixo. A fileira de
   botões do cabeçalho da tabela some (as mesmas ações estão em "Mais", na barra
   de baixo); o fim da lista e o selo "↻ auto" ficam acima da barra; a barra
   respeita a área do gesto do iPhone. */
@media (max-width: 680px) {
  html, body { height: auto; min-height: 100%; overflow-x: hidden; overflow-y: auto; }
  .app { height: auto; max-height: none; min-height: 100vh; overflow: visible; display: block; }
  .main, .content, html[data-vis="detalhada"] .content { min-height: 0; overflow: visible; }
  .tableWrap, html[data-vis="detalhada"] .tableWrap { height: auto; min-height: 0; flex: none; overflow: visible; }
  .cards { overflow: visible; padding-bottom: calc(110px + env(safe-area-inset-bottom, 0px)); }
  .tableTop .btns { display: none; }
  .tableTitle { font-size: 20px; line-height: 1.25; }
  .mobileBar { padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
  /* Visual compacto (v3.17.0) — no modelo enviado pelo usuário: badges empilhados na
     largura toda, botões do topo centralizados, título justificado, cartões de venda
     mais densos (fontes menores, uma linha de dados) e barra de baixo mais baixa. */
  .top { padding: 14px 16px; gap: 12px; }
  .top .left { align-items: flex-start; }
  .top .badges { flex-direction: column; flex-wrap: nowrap; align-items: stretch; justify-content: flex-start; gap: 5px; }
  .top .badge, .top.badgesCompactos .badge { justify-content: flex-start; text-align: left; border-radius: 6px; font-size: 10px; letter-spacing: 0.03em; padding: 5px 10px; }
  .top .right { justify-content: center; gap: 8px; row-gap: 8px; }
  .tableTop { padding: 16px 18px; gap: 4px; }
  .tableTitle { font-size: 15px; line-height: 1.3; }
  .cards { padding: 14px 14px calc(96px + env(safe-area-inset-bottom, 0px)); }
  .cardRow { padding: 14px 16px; margin-bottom: 12px; border-radius: var(--radius-md); }
  .cardHead { margin-bottom: 8px; }
  .cardNum { font-size: 11px; }
  .cardTotal { font-size: 15px; }
  .cardMeta { font-size: 11px; margin-bottom: 3px; }
  .cardPay { font-size: 10px; margin-bottom: 6px; }
  .cardRow .itensMiniHead { margin-bottom: 8px; padding-bottom: 6px; }
  .cardRow .itensMiniHead .sub { font-size: 9px; padding: 2px 7px; }
  .cardRow .itensChips { gap: 5px; }
  .cardRow .itensChip { font-size: 10.5px; padding: 3px 8px 3px 3px; }
  .cardRow .itensQtd { font-size: 10px; padding: 1px 5px; border-radius: 4px; margin-right: 6px; }
  .mobileBar { padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px)); gap: 10px; }
  .mobileBar .btn { height: 40px; font-size: 12px; border-radius: var(--radius-md); min-width: 0; }
  .mobileBar .btn svg { flex: none; }
  /* Tamanho do texto (menu Tema → "Tamanho do texto", só no celular): aumenta/diminui a
     página, as janelas e a barra de baixo juntas (o menu de temas e as dicas ficam fora). */
  .app, .ov .modal { zoom: var(--zoom-mob, 1); }
  .mobileBar { zoom: var(--zoom-bar, 1); }  /* barra: no máximo 120% — os 3 botões sempre cabem */
  .tmMenu .tmZoom { display: block; }
  /* Badge de totais (v3.18.0): pares "Nome: valor" inteiros, lado a lado, sem o "―";
     numa linha só quando cabem (o JS _linhaUnica diminui a letra antes), senão o par
     inteiro desce — nunca separa o nome do valor. */
  .top #bDiaBrk:not([style*="none"]) { display: block !important; white-space: normal; line-height: 1.6; }
  /* Demais badges também em fluxo de texto (não flex): se nem com a letra menor couberem
     numa linha, quebram como texto, em vez de estourar a borda. */
  .top .badges > .badge:not(.badgeHora):not(#bDiaBrk) { display: block; }
  /* Filtro por tipo: sempre dentro da tela; se faltar largura (letra grande, tela estreita),
     os espaços diminuem e, no limite, a fileira desliza para o lado. */
  .radioBusca { overflow-x: auto; scrollbar-width: none; justify-content: space-between; }
  .radioBusca::-webkit-scrollbar { display: none; }
  .radioBusca .radio { flex: none; padding: 6px clamp(8px, 3.5vw, 16px); }
  .top .badges .bSep { display: none; }
  .top .badges .bPar { white-space: nowrap; margin-right: 10px; }
  .top #bDiaBrk > span, .top #bDiaBrk #tDiaBrkMini > span { white-space: inherit; }
  .top #bDiaBrk .bPar, .top #bDiaBrk #tDiaBrkMini > .bPar { white-space: nowrap; margin-right: 10px; }
  /* Selo "↻ auto" (indicador da atualização automática, que continua ligada): no
     celular não há canto livre — ficava por cima das vendas e dos cartões. */
  #__srv_badge { display: none !important; }
  /* Painel: o texto extra do título ("pico 16h", "clique para filtrar"…) vai para a
     linha de baixo inteira, em vez de virar "p.."; o botão de minimizar fica no canto. */
  .dshTit { flex-wrap: wrap; row-gap: 4px; }
  .dshTit .dshExtra { order: 3; flex: 1 0 100%; margin-left: 0; white-space: normal; overflow: visible; }
  .dshTit .dshMinBtn, .dshTit .dshExtra + .dshMinBtn { margin-left: auto; }
  /* Janelas (v3.16.0): cabeçalho compacto com "Fechar" ao lado do título, campos
     empilhados (rótulo em cima, campo embaixo, largura toda) — nada passa da borda. */
  .ov.sheet .modal { padding: 0; max-height: calc(88vh / var(--zoom-mob, 1)); max-height: calc(88dvh / var(--zoom-mob, 1)); }
  .mhead { padding: 14px 16px; flex-wrap: nowrap; align-items: flex-start; }
  .mhead > div:first-child { flex: 1 1 auto; min-width: 0; }
  .mhead > .btn { flex: none; }
  .mtitle { font-size: 18px; } .msub { font-size: 12px; }
  .ov.sheet .mbody { padding: 12px; }
  .kv:has(input, textarea, select), #ovConfig .kv { grid-template-columns: minmax(0, 1fr); gap: 8px; padding: 12px 14px; }
  .kv .input, .kv textarea { width: 100%; min-width: 0; box-sizing: border-box; }
  .kv input[type="date"] { display: block; -webkit-appearance: none; appearance: none; min-height: 44px; text-align: left; }
  .acoesBody .btnAcao { justify-content: flex-start; min-height: 46px; }
  /* Janela aberta (venda, ajuda, duplicatas…): o fundo não rola junto. */
  html:has(.ov.on), html:has(.ov.on) body { overflow: hidden; }
}
/* ── Tooltip customizado ─────────────────────────────────────── */
#__tip {
  position: fixed; z-index: 2147483646; pointer-events: none;
  background: var(--bg-panel); color: var(--text-main);
  border: 1px solid var(--border-focus); border-radius: var(--radius-md);
  padding: 6px 12px; font-size: 12px; font-weight: 500; line-height: 1.45;
  max-width: 280px; white-space: pre-wrap; word-break: break-word;
  box-shadow: 0 8px 24px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3);
  opacity: 0; transform: translateY(4px) scale(0.97);
  transition: opacity 0.14s ease, transform 0.14s ease;
  /* PERFORMANCE FIX (ajuste solicitado — foco em computadores mais fracos):
     removido "backdrop-filter: blur(12px)" — --bg-panel é uma cor 100%
     opaca (hex sem canal alpha) nos três temas, então não existe NADA
     "atrás" deste tooltip que pudesse aparecer borrado. O blur estava
     custando processamento de composição a cada abertura de tooltip sem
     produzir nenhum efeito visual (zero diferença perceptível removendo). */
}
#__tip.on { opacity: 1; transform: translateY(0) scale(1); }
/* ── Menu suspenso de temas (v3.2.0) ───────────────────────────────────────
   Fica no <body> (não dentro da barra): .top tem backdrop-filter, que viraria o
   "bloco de contenção" de qualquer filho position:fixed e deslocaria o menu.
   Mesmo padrão de oculto/visível do .ov (opacity + visibility), anima ao abrir e ao fechar. */
#btnTema .tmChev { margin-left: -2px; opacity: 0.7; transition: transform 0.18s var(--easing); }
#btnTema[aria-expanded="true"] { background: var(--bg-hover); border-color: var(--accent); }
#btnTema[aria-expanded="true"] .tmChev { transform: rotate(180deg); }
.tmMenu { position: fixed; top: 0; left: 0; z-index: 9000; width: 700px; max-width: calc(100vw - 24px); max-height: 80vh; overflow-y: auto; overscroll-behavior: contain; padding: 14px 14px 16px; background: var(--bg-panel); color: var(--text-main); border: 1px solid var(--border-focus); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); opacity: 0; visibility: hidden; pointer-events: none; transform: translateY(-6px) scale(0.98); transform-origin: top right; transition: opacity 0.16s var(--easing), transform 0.16s var(--easing), visibility 0s linear 0.16s; }
.tmMenu.on { opacity: 1; visibility: visible; pointer-events: auto; transform: translateY(0) scale(1); transition: opacity 0.2s var(--easing), transform 0.2s var(--easing), visibility 0s linear 0s; }
.tmHead { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 2px 12px; }
.tmTitulo { font-size: 14px; font-weight: 700; letter-spacing: -0.01em; }
.tmAtual { font-size: 11px; font-weight: 600; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
/* Grade única (escuros primeiro, claros depois): 4 colunas = 4×4 com os 16 temas, sem sobra de linha. */
.tmGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.tmCard { display: flex; flex-direction: column; align-items: stretch; gap: 8px; min-width: 0; padding: 8px; font: inherit; text-align: left; color: var(--text-main); background: var(--bg-app); border: 1px solid var(--border); border-radius: 12px; cursor: pointer; transition: var(--transition-fast); }
.tmCard:hover { border-color: var(--text-muted); transform: translateY(-2px); box-shadow: var(--shadow-md); }
.tmCard:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.tmCard[aria-checked="true"] { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); background: var(--accent-bg); }
.tmFoot { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 0 2px; }
.tmName { min-width: 0; font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tmCheck { flex-shrink: 0; width: 14px; height: 14px; color: var(--accent); opacity: 0; transform: scale(0.6); transition: opacity 0.15s var(--easing), transform 0.15s var(--easing); }
.tmCard[aria-checked="true"] .tmCheck { opacity: 1; transform: scale(1); }
/* Prévia: miniatura da tela pintada com as variáveis do PRÓPRIO tema (atributo data-theme no elemento). */
.tmPrev { display: flex; height: 64px; overflow: hidden; border-radius: 8px; background: var(--bg-app); border: 1px solid var(--border-focus); color: var(--text-main); }
.tmPSide { display: flex; flex-direction: column; justify-content: center; gap: 5px; width: 36%; padding: 6px 7px; background: var(--bg-panel); border-right: 1px solid var(--border); }
.tmPAa { font-size: 15px; font-weight: 800; line-height: 1; color: var(--text-main); }
.tmPMuted { display: block; width: 72%; height: 3px; border-radius: 2px; background: var(--text-muted); }
.tmPPill { display: block; width: 58%; height: 7px; border-radius: 4px; background: var(--accent); }
.tmPMain { display: flex; flex: 1; flex-direction: column; justify-content: center; gap: 4px; min-width: 0; padding: 6px; }
.tmPRow { display: flex; align-items: center; gap: 4px; padding: 3px 4px; border-radius: 4px; }
.tmPHov { background: var(--bg-hover); }
.tmPDot { flex-shrink: 0; width: 5px; height: 5px; border-radius: 50%; background: var(--accent); }
.tmPLn { display: block; flex: 1; height: 3px; border-radius: 2px; background: var(--text-muted); }
.tmPVal { display: block; flex-shrink: 0; width: 14px; height: 3px; border-radius: 2px; background: var(--text-main); }
.tmPerf { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border); }
.tmPerfOps { display: flex; gap: 6px; flex-wrap: wrap; }
.tmPerfOp { flex: 1 1 0; min-width: 90px; height: 34px; font: inherit; font-size: 12px; font-weight: 600; color: var(--text-main); background: var(--bg-app); border: 1px solid var(--border); border-radius: var(--radius-md); cursor: pointer; }
.tmPerfOp:hover { border-color: var(--border-focus); }
.tmPerfOp[aria-checked="true"] { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.tmZoom { display: none; }
/* Tamanho do texto no computador (v3.21.0): mesmo controle do celular. A página ocupa a
   tela inteira com altura fixa, então a altura é compensada pelo zoom (senão sobraria
   faixa vazia ao diminuir, ou cortaria ao aumentar). */
@media (min-width: 681px) {
  .app { zoom: var(--zoom-pc, 1); height: calc(100vh / var(--zoom-pc, 1)); max-height: calc(100vh / var(--zoom-pc, 1)); }
  .ov .modal { zoom: var(--zoom-pc, 1); max-height: calc(90vh / var(--zoom-pc, 1)); }
  .tmMenu .tmZoom { display: block; }
}
/* Voltar ao topo (v3.21.1): só no celular, onde a página inteira rola. Fica preso à barra
   de baixo (acima dela, no canto direito), então acompanha a barra em qualquer tamanho de
   texto e na área do gesto do iPhone; aparece só depois de descer bastante. */
.btnTopo { display: none; }
@media (max-width: 680px) {
  .mobileBar .btnTopo { display: flex; align-items: center; justify-content: center; position: absolute; right: 12px; bottom: calc(100% + 10px); width: 36px; height: 36px; padding: 0; border-radius: 50%; background: var(--accent); color: var(--on-accent); border: 1px solid var(--accent); box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35); cursor: pointer; -webkit-tap-highlight-color: transparent; opacity: 0; visibility: hidden; pointer-events: none; transform: translateY(12px) scale(0.85); transition: opacity 0.22s var(--easing), transform 0.22s var(--easing), visibility 0s linear 0.22s; }
  .mobileBar .btnTopo.vis { opacity: 0.88; visibility: visible; pointer-events: auto; transform: none; transition: opacity 0.22s var(--easing), transform 0.22s var(--easing), visibility 0s; }
  .mobileBar .btnTopo:active { opacity: 1; transform: scale(0.92); }
  html[data-perf="leve"] .mobileBar .btnTopo { transition: none; }
}
/* QR code (v3.21.0): botão só no computador — no celular o relatório já está aberto. */
@media (max-width: 680px) { #btnCelular { display: none !important; } }
.qrCaixa { background: #fff; border-radius: 14px; padding: 10px; width: 260px; height: 260px; margin: 4px auto 0; box-shadow: var(--shadow-md); }
.qrCaixa img { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
.qrUrl { font: 600 15px 'JetBrains Mono', Consolas, monospace; color: var(--text-main); background: var(--bg-app); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 10px 12px; text-align: center; word-break: break-all; }
.qrDica { font-size: 12.5px; color: var(--text-muted); text-align: center; line-height: 1.5; }
.tmZoomOps .tmPerfOp { flex: 1 1 0; }
/* Configurações (v3.24.0): layout alinhado. Cabeçalho com "Fechar" sempre à direita;
   campos simples em duas colunas (rótulo | campo); seções grandes (Nesta tela, ícone,
   proibidos, teclas, aparelhos) em uma coluna na largura toda. No celular tudo empilha. */
#ovConfig .cfgModal, #ovQr .modal { max-width: 640px; }
#ovConfig .mhead, #ovQr .mhead { flex-wrap: nowrap; align-items: flex-start; }
#ovConfig .mhead > div:first-child, #ovQr .mhead > div:first-child { flex: 1 1 auto; min-width: 0; }
#ovConfig .mhead > .btn, #ovQr .mhead > .btn { flex: none; }
/* Duas colunas só no computador — no celular (≤680px) o .kv empilha (rótulo em cima,
   campo embaixo). v3.24.1: antes esta regra valia também no celular e espremia o campo
   "Duração das mensagens de aviso" (vazio) com o botão "Padrão" passando da borda. */
@media (min-width: 681px) {
  #ovConfig .kv { grid-template-columns: 200px minmax(0, 1fr); align-items: center; gap: 8px 16px; }
}
#ovConfig .kv[style*="flex-direction:column"] { grid-template-columns: minmax(0, 1fr); align-items: stretch; gap: 8px; }
#ovConfig .kv > div[style*="display:flex"] > .input { flex: 1 1 auto; min-width: 0; }
#ovConfig .kv > div[style*="display:flex"] > .btn { flex: none; }
#ovConfig .kv > div[style*="display:flex"] { min-width: 0; }
#ovConfig .kv .k { line-height: 1.35; }
#ovConfig #cfgApSel { min-width: 0; flex: 1 1 220px; }
/* Teclas de atalho: cada atalho é um bloco alinhado — tecla | gravar | comando | × e, embaixo, a ação.
   No celular: tecla + gravar + × em cima, comando e ação embaixo, na largura toda. */
.cfgTeclaLin { display: grid; grid-template-columns: 130px auto minmax(0, 1fr) 36px; gap: 6px; align-items: center; padding-bottom: 10px; border-bottom: 1px dashed var(--border); }
.cfgTeclaLin .cfgTeclaAcao { grid-column: 1 / 4; grid-row: 2; }
.cfgTeclaLin .input { width: 100%; min-width: 0; box-sizing: border-box; height: 36px; font-size: 12px; }
.cfgTeclaLin .cfgTecla, .cfgTeclaLin .cfgTeclaCmd { font-family: ui-monospace, Consolas, monospace; }
.cfgTeclaLin .cfgTecla { cursor: pointer; }
.cfgTeclaLin .cfgTeclaAcao { cursor: pointer; }
.cfgTeclaLin .btn { height: 36px; white-space: nowrap; font-size: 12px; justify-content: center; }
.cfgTeclaLin .cfgTeclaRem { width: 36px; padding: 0; }
@media (max-width: 680px) {
  .cfgTeclaLin { grid-template-columns: minmax(0, 1fr) auto 40px; padding-bottom: 10px; border-bottom: 1px dashed var(--border); }
  .cfgTeclaLin .cfgTecla { grid-column: 1; grid-row: 1; }
  .cfgTeclaLin .cfgTeclaGravar { grid-column: 2; grid-row: 1; }
  .cfgTeclaLin .cfgTeclaRem { grid-column: 3; grid-row: 1; width: 40px; }
  .cfgTeclaLin .cfgTeclaCmd { grid-column: 1 / -1; grid-row: 2; }
  .cfgTeclaLin .cfgTeclaAcao { grid-column: 1 / -1; grid-row: 3; }
  .cfgTeclaLin .input, .cfgTeclaLin .btn { height: 40px; }
}
.prImpBtns .btn { flex: 1 1 200px; justify-content: center; }
#cfgTela { display: block; }
#cfgTela > .k { margin-bottom: 2px; }
#cfgTela .tmZoom { display: block; }
#cfgTela > .k + .tmPerf { margin-top: 8px; border-top: 0; padding-top: 0; }
.tmRecLbl { display: flex; align-items: flex-start; gap: 10px; padding: 8px 2px 2px; font-size: 13px; font-weight: 600; line-height: 1.35; cursor: pointer; color: var(--text-main); }
.tmRecLbl input { width: 18px; height: 18px; margin: 0; flex: none; accent-color: var(--accent); cursor: pointer; }
.qrAbas { display: flex; gap: 6px; } .qrAbas .qrAba { flex: 1 1 0; }
.tmZoomOps .tmZoomOp[disabled] { opacity: 0.4; cursor: default; }
.tmPerfDica { margin-top: 8px; font-size: 11px; color: var(--text-muted); line-height: 1.4; }
/* Menu auto-ajustável (v3.14.0): se não couber na altura da janela, o JS (_tmAjustar) aplica
   níveis de compactação — mais colunas, prévias mais baixas, sem as dicas, espaçamentos menores —
   até caber sem rolagem. A rolagem interna fica só como último recurso. */
.tmMenu[data-compacto] .tmGrid { grid-template-columns: repeat(var(--tm-cols, 4), minmax(0, 1fr)); gap: 8px; }
.tmMenu[data-compacto] .tmPrev { height: 50px; }
.tmMenu[data-compacto="2"] .tmPrev { height: 40px; }
.tmMenu[data-compacto="2"] .tmPerfDica, .tmMenu[data-compacto="3"] .tmPerfDica, .tmMenu[data-compacto="4"] .tmPerfDica { display: none; }
.tmMenu[data-compacto="3"], .tmMenu[data-compacto="4"] { padding: 10px 12px 12px; }
.tmMenu[data-compacto="3"] .tmPrev, .tmMenu[data-compacto="4"] .tmPrev { height: 30px; }
.tmMenu[data-compacto="3"] .tmPAa, .tmMenu[data-compacto="4"] .tmPAa { font-size: 11px; }
.tmMenu[data-compacto="3"] .tmHead, .tmMenu[data-compacto="4"] .tmHead { margin-bottom: 8px; }
.tmMenu[data-compacto="3"] .tmPerf, .tmMenu[data-compacto="4"] .tmPerf { margin-top: 8px; padding-top: 8px; }
.tmMenu[data-compacto="3"] .tmPerfOp, .tmMenu[data-compacto="4"] .tmPerfOp { height: 28px; }
.tmMenu[data-compacto="3"] .tmCard, .tmMenu[data-compacto="4"] .tmCard { padding: 6px; gap: 5px; }
@media (max-width: 640px) { .tmGrid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 440px) { .tmGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .tmMenu { padding: 12px 12px 14px; } }
</style>
</head>
<body>
<div class="app">
<div class="top">
<div class="left">
<button id="btnVend" class="btn vendBtn" type="button" data-tip="Filtrar vendas por vendedor"><span class="vendIcon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span><span id="vendTopTxt" class="vendTxt">Todos</span></button>
<div class="badge badgeHora badgeGeradoMobile">Gerado em: ${escHtml(diaMesGeradaBR)}/${ano2} às ${escHtml(horaGeradaBR)}</div>
<div class="badges">
<div class="badge" data-tip="Data dos dados desse relatório">Data: ${escHtml(dataBR)}</div>
<div class="badge badgeHora" data-tip="Dia, hora e mês em que esse relatório foi gerado">Gerado em: ${escHtml(diaMesGeradaBR)}/${ano2} às ${escHtml(horaGeradaBR)}</div>
<div class="badge" data-tip="Quantidade de vendas por tipo"><span class="bPar">Gerencial: <span id="tQtdGer"></span></span><span id="badgeQtdNfce" style="display:none"> <span class="bSep">―</span> <span class="bPar">NFC-e: <span id="tQtdNfce"></span></span></span><span id="badgeNfe" style="display:none"> <span class="bSep">―</span> <span class="bPar">NF-e: <span id="tQtdNfe"></span></span></span></div>
<div class="badge" id="bDiaBrk" data-tip="Soma total ― Gerencial ― NFC-e ― NF-e"><span class="bPar">Total: <span id="tDiaSel"></span></span><span id="tDiaBrkMini" style="display:none"> <span class="bSep">―</span> <span class="bPar">Gerencial: <span id="tDiaGer"></span></span><span id="tDiaNfceMini" style="display:none"> <span class="bSep">―</span> <span class="bPar">NFC-e: <span id="tDiaNfce"></span></span></span><span id="tDiaNfeMini" style="display:none"> <span class="bSep">―</span> <span class="bPar">NF-e: <span id="tDiaNfe"></span></span></span></span></div>
</div>
</div>
<div class="right">
<div class="inputWrap">
<input id="q" class="input" data-tip="Buscar... Excluir: -termo (1) ou [termo,~contém,=igual,proibidos,-proibidos] (múltiplos)  |  Valor: >100, 10-20, 12*3, 12/3, 12?  |  Múltiplos: +  |  Soma: =151 ou =151*2" placeholder="Buscar... Excluir: -termo (1) ou [termo,~contém,=igual,proibidos,-proibidos] (múltiplos)  |  Valor: >100, 10-20, 12*3, 12/3, 12?  |  Múltiplos: +  |  Soma: =151 ou =151*2" autocomplete="off">
<button id="limpar" class="btn btnIcon" type="button" data-tip="Limpar todos os filtros e exibir todas as vendas" aria-label="Limpar filtros"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
</div>
<div class="radioBusca" id="radioBusca" role="radiogroup" aria-label="Filtrar por tipo de documento"><label class="radio" id="radioLblTodos"><input type="radio" name="tipoBusca" value="todos" checked><span>Todos</span></label><label class="radio" id="radioLblGer" style="display:none"><input type="radio" name="tipoBusca" value="gerencial"><span>Gerencial</span></label><label class="radio" id="radioLblNfce" style="display:none"><input type="radio" name="tipoBusca" value="nfce"><span>NFC-e</span></label><label class="radio" id="radioLblNfe" style="display:none"><input type="radio" name="tipoBusca" value="nfe"><span>NF-e</span></label></div>
<button id="ajuda" class="btn btnLabel" type="button" data-tip="Coringas de busca disponíveis" aria-label="Ajuda com coringas"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5" fill="currentColor" stroke="none"/></svg>Ajuda</button>
<button id="proibidos" class="btn btnLabel btnProibidos" type="button" data-tip="Aplicar filtro [proibidos] — ocultar vendas com itens proibidos" aria-label="Filtrar proibidos"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>Proibidos</button>
<button id="btnDuplicatas" class="btn btnLabel" type="button" style="display:none" data-tip="Ver gerenciais que foram automaticamente ocultadas nesta geração por já terem virado NFC-e/NF-e" aria-label="Ver duplicatas"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Duplicatas <span id="badgeDuplicatas" style="opacity:.75"></span></button>
<button id="btnAutoteste" class="btn btnLabel" type="button" style="display:none" data-tip="Resultado do auto-teste desta atualização: totais, duplicidades e leitura do banco" aria-label="Ver auto-teste"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>Auto-teste <span id="badgeAutoteste" style="opacity:.85"></span></button>
<button id="atualizar" class="btn btnLabel" type="button" data-tip="Recarregar relatório do dia atual" aria-label="Atualizar"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>Atualizar</button>
<button id="btnCelular" class="btn btnLabel" type="button" data-tip="Abrir este relatório no celular: mostra um QR code para escanear com a câmera" aria-label="Abrir no celular (QR code)"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>Celular</button>
<button id="btnTema" class="btn btnLabel" type="button" data-tip="Escolher tema de cores" aria-label="Escolher tema de cores" aria-haspopup="menu" aria-expanded="false"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>Tema<svg class="tmChev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg></button>
<button id="btnModalPeriodo" class="btn btnLabel" type="button" data-tip="Gerar relatório para um intervalo de datas" aria-label="Gerar por período"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>Por período</button>
<button id="acoes" class="btn btnLabel" type="button" data-tip="Editar configurações do sistema" aria-label="Editar configurações"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>Configurações</button>
</div>
</div>
<div class="main">
<div class="sidebar">
<div class="sb-head">
<div class="sb-title">Vendedores</div>
<div class="pill mono" id="vendSel">Todos</div>
</div>
<div class="list" id="lista"></div>
<div class="sbResumo" id="vendResumo"><div class="sb-head"><div class="sb-title">Total por vendedor</div></div><div class="sbResumoBody"></div></div>
</div>
<div class="content">
<div class="dash" id="dash" aria-label="Painel detalhado"></div>
<div class="tableWrap">
<div class="tableTop">
<div class="tableTitle" id="sub">Todos os vendedores</div>
<div class="actions">
<div class="count" id="count"></div>
<div class="btns">
<div class="btn" id="limparTabela"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>Limpar filtros</div>
<div class="btn" id="copiarTudo"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copiar tudo</div>
<div class="btn" id="copiarTudoItens"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/><line x1="13" y1="14" x2="17" y2="14"/><line x1="13" y1="17" x2="17" y2="17"/></svg>Copiar + itens</div>
<div class="btn" id="copiarSemDinheiro"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>Sem dinheiro</div>
<div class="btn" id="copiarGerencial"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>Só gerencial</div>
<div class="btn" id="editarProibidos"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>Proibidos</div>
</div>
</div>
</div>
<div class="cards" id="cards"></div>
<table>
<thead>
<tr>
	<th>vendedor</th>
	<th>tipo</th>
	<th>número</th>
	<th data-tip="Hora ou Cliente (se NF-e)">hora / cliente</th>
	<th>total</th>
	<th data-tip="Forma ou Natureza (se NF-e)">forma / natureza</th>
	<th>itens</th>
</tr>
</thead>
<tbody id="tb"></tbody>
</table>
</div>
</div>
</div>
</div>
</div>
<div class="ov" id="ov" aria-hidden="true">
<div class="modal" role="dialog" aria-modal="true">
<div class="mhead">
<div>
<div class="mtitle" id="mTitulo"></div>
<div class="msub" id="mSub"></div>
</div>
<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;font-size: 12px;">
<div class="btn" id="copiarModalGer" style="display:none"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>Só gerencial</div><div class="btn" id="copiarModalSemItens" style="display:none"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Sem itens</div><div class="btn" id="copiarModal" style="display:none"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/><line x1="13" y1="14" x2="17" y2="14"/><line x1="13" y1="17" x2="17" y2="17"/></svg>Com itens</div>
<div class="btn" id="fechar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Fechar</div>
</div>
</div>
<div class="mbody" id="mBody"></div>
</div>
</div>
<div class="ov sheet" id="ovVend" aria-hidden="true">
<div class="modal vendModal" role="dialog" aria-modal="true">
<div class="mhead">
<div>
<div class="mtitle">Filtrar por vendedor</div>
<div class="msub">Selecione um vendedor para filtrar as vendas exibidas.</div>
</div>
<div class="btn" id="vendFechar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Fechar</div>
</div>
<div class="mbody">
<input id="vendQ" class="input vendQ" placeholder="Buscar vendedor..." autocomplete="off">
<div class="list" id="listaVend"></div>
</div>
</div>
</div>

<div class="ov sheet" id="ovAcoes" aria-hidden="true">
<div class="modal acoesModal" role="dialog" aria-modal="true">
<div class="mhead">
<div>
<div class="mtitle">Mais opções</div>
<div class="msub">Proibidos, vendedores, ajuda e filtros.</div>
</div>
<div class="btn" id="acoesFechar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Fechar</div>
</div>
<div class="mbody acoesBody">
<button class="btn btnAcao" id="aProibidos" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>Editar lista de proibidos</button>
<button class="btn btnAcao" id="aVendedores" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>Filtrar por vendedor</button>
<button class="btn btnAcao" id="aAjuda" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5" fill="currentColor" stroke="none"/></svg>Ajuda — coringas de busca</button>
<button class="btn btnAcao" id="aLimpar" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>Limpar filtros</button>
</div>
</div>
</div>
<div class="ov sheet" id="ovCopiar" aria-hidden="true">
<div class="modal acoesModal" role="dialog" aria-modal="true" aria-label="Opções de cópia">
<div class="mhead">
<div>
<div class="mtitle">Copiar</div>
<div class="msub">Vendas filtradas para a área de transferência.</div>
</div>
<div class="btn" id="copiarFechar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Fechar</div>
</div>
<div class="mbody acoesBody">
<button class="btn btnAcao" id="aCopiarTudo" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copiar tudo</button>
<button class="btn btnAcao" id="aCopiarTudoItens" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/><line x1="13" y1="14" x2="17" y2="14"/><line x1="13" y1="17" x2="17" y2="17"/></svg>Copiar tudo + itens</button>
<button class="btn btnAcao" id="aCopiarSemDinheiro" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>Copiar sem dinheiro</button>
<button class="btn btnAcao" id="aCopiarGerencial" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>Copiar só gerencial</button>
</div>
</div>
</div>
<div class="mobileBar" id="mobileBar">
<button class="btn mbBtn" id="mbCopiar" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copiar</button>
<button class="btn mbBtn" id="mbVendas" type="button" aria-label="Ir para a lista de vendas do dia"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="4" x2="12" y2="18"/><polyline points="6 12 12 18 18 12"/><line x1="5" y1="21" x2="19" y2="21"/></svg>Vendas</button>
<button class="btnTopo" id="btnTopo" type="button" aria-label="Voltar ao topo" title="Voltar ao topo" aria-hidden="true" tabindex="-1"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
<button class="btn mbBtn mbMais" id="mbMais" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>Mais</button>
</div>
<script id="dados" type="application/json">${dadosJSON}</script>
<script>
const qs = s => document.querySelector(s);
// SUAVIZAÇÃO (ajuste solicitado): fecha um overlay dinâmico (criado via
// document.createElement, ao contrário de #ov/#ovVend/#ovAcoes que já
// existem no HTML e só trocam de classe) tocando a animação de saída ANTES
// de remover o elemento do DOM. Sem isso, "bg.remove()" tirava o elemento
// da árvore de renderização no mesmo frame em que a transição de opacity
// começaria — o overlay simplesmente sumia, sem nenhum fade (o CSS nunca
// tinha tempo de tocar). 160ms = duração de saída declarada em ".ov" (CSS);
// mantenha os dois em sincronia se algum dia mudar um dos dois.
const DURACAO_FECHAR_OVERLAY_MS = 160;
const _fecharOverlayAnimado = (el) => {
    if (!el) return;
    el.classList.remove("on");
    // Modo Completo: a caixa encolhe antes de sumir (saída de 0,26 s, ver MOVIMENTO no CSS).
    const completo = document.documentElement.getAttribute("data-perf") === "completo";
    setTimeout(() => { try { el.remove(); } catch(_) {} }, completo ? 300 : DURACAO_FECHAR_OVERLAY_MS);
};
// Duração do toast (ms) — lida do config.json no momento da geração
const __TOAST_DURACAO__ = ${cfgToastDuracao};
// Teclas de atalho personalizadas — lidas do config.json no momento da geração
const __TECLAS_PERSONALIZADAS__ = ${_jsonParaScript(cfgTeclasPersonalizadas)};
// Envia erros JS ao servidor para registro em relatorio.log
// ── Tooltip customizado ─────────────────────────────────────────────────────
// Substitui o tooltip nativo do browser (feio, sem estilo) por um flutuante
// moderno. Usa [data-tip] como atributo de dados — não polui o title nativo.
// Funciona com delegação no document: sem listeners por elemento.
(function(){
    var _tip = null, _tid = 0, _cur = null;

    function _create(){
        if (_tip) return;
        _tip = document.createElement("div");
        _tip.id = "__tip";
        document.body.appendChild(_tip);
    }

    function _show(el, txt){
        _create();
        _tip.textContent = txt;
        _tip.style.display = "block";
        _tip.classList.remove("on");

        // Posiciona abaixo/acima do elemento sem sair da viewport
        var r   = el.getBoundingClientRect();
        var vw  = window.innerWidth;
        var vh  = window.innerHeight;
        var tw  = Math.min(280, vw - 24);
        _tip.style.maxWidth = tw + "px";

        // Calcula posição X (centralizado no elemento, dentro da viewport)
        var left = r.left + r.width / 2 - _tip.offsetWidth / 2;
        left = Math.max(12, Math.min(left, vw - _tip.offsetWidth - 12));

        // Prefere abaixo; se não cabe, vai acima
        var top;
        var below = r.bottom + 8;
        if (below + _tip.offsetHeight < vh - 12) {
            top = below;
        } else {
            top = r.top - _tip.offsetHeight - 8;
        }
        top = Math.max(8, top);

        _tip.style.left = left + "px";
        _tip.style.top  = top  + "px";

        // Anima entrada
        requestAnimationFrame(function(){ _tip.classList.add("on"); });
    }

    function _hide(){
        if (!_tip) return;
        _tip.classList.remove("on");
    }

    // Encontra o ancestral mais próximo com [data-tip]
    function _find(target){
        var el = target;
        while (el && el !== document.body){
            if (el.hasAttribute && el.hasAttribute("data-tip")) return el;
            el = el.parentElement;
        }
        return null;
    }

    document.addEventListener("mouseover", function(e){
        var el = _find(e.target);
        if (!el || el === _cur) return;
        var tipTxt = el.getAttribute("data-tip");
        if (!tipTxt) return; // data-tip vazio ou ausente — não exibe tooltip
        _cur = el;
        clearTimeout(_tid);
        _tid = setTimeout(function(){ _show(el, tipTxt); }, 400);
    }, true);

    document.addEventListener("mouseout", function(e){
        var el = _find(e.target);
        if (!el) return;
        // Só oculta se o mouse saiu de fato (não foi para filho)
        if (el.contains(e.relatedTarget)) return;
        _cur = null;
        clearTimeout(_tid);
        _hide();
    }, true);

    // Teclado e scroll ocultam o tooltip
    document.addEventListener("keydown",  function(){ clearTimeout(_tid); _hide(); _cur = null; }, true);
    document.addEventListener("scroll",   function(){ clearTimeout(_tid); _hide(); _cur = null; }, true);
    document.addEventListener("mousedown",function(){ clearTimeout(_tid); _hide(); _cur = null; }, true);
})();
// ────────────────────────────────────────────────────────────────────────────

// RUÍDO FIX (v2.6.7): estes dois handlers capturam TUDO que falha na página —
// inclusive erros de EXTENSÕES DO NAVEGADOR, que rodam no mesmo contexto mas
// não têm relação nenhuma com este sistema. Caso real observado no
// relatorio.log do usuário: uma extensão do Chrome falhando ~1x por segundo
// gerou 1360 das 1478 linhas do log (92%), com um POST por segundo, e
// empurrou para fora toda informação de diagnóstico útil pela rotação do
// arquivo. Não dá para consertar o bug de uma extensão de terceiros, então o
// certo é não registrar o que não é nosso. A detecção olha o stack e a origem
// atrás dos esquemas de extensão dos navegadores (chrome/moz/safari/ms-browser).
// Continua registrando normalmente qualquer erro vindo da própria página.
const _ehErroDeExtensao = (texto) => /(?:chrome|moz|safari|ms-browser)-extension:\/\//i.test(String(texto || ""));

window.onerror=function(msg,src,line,col,err){
  try{
    var _stack = err&&err.stack?String(err.stack):'';
    if(_ehErroDeExtensao(_stack)||_ehErroDeExtensao(src))return;
    fetch('/api/log-error',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({msg:String(msg),src:String(src||''),line:line,col:col,stack:_stack})});}catch(_){}
};
window.onunhandledrejection=function(ev){
  try{
    var r=ev&&ev.reason;
    var _stack = r&&r.stack?String(r.stack):'';
    if(_ehErroDeExtensao(_stack))return;
    fetch('/api/log-error',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({msg:'UnhandledRejection: '+String(r&&r.message||r),stack:_stack})});}catch(_){}
};
const dadosEl = qs("#dados");
let DADOS;
if (dadosEl) {
  try {
    DADOS = JSON.parse(dadosEl.textContent || "{}");
  } catch(e) {
    // LOGA os primeiros caracteres para inspecionar o que veio!
    console.error("Erro no parse do bloco <script id='dados'>:", (dadosEl.textContent||"").slice(0,80));
    throw e;
  }
} else {
  DADOS = {};
}
// Preparação dos dados (v3.26.0: função — roda na carga e de novo a cada atualização
// sem recarregar a página, ver __atualizarSemRecarregar).
const _prepararDados = (D) => {
    if(!Array.isArray(D.vendas))D.vendas=[];
    if(!Array.isArray(D.vendedores))D.vendedores=[];
    if(!Array.isArray(D.vendTotaisDia))D.vendTotaisDia=[];

    // ── Dedup cliente: pares modelo=99 ("Dinheiro NF-e") + modelo=55 mesmo número ──
    // O Node.js agrupa por chave exata — se o número vem zerado de um lado e sem zeros
    // do outro, os dois chegam ao cliente separados. Corrige aqui antes de renderizar.
    {
      const _nfeMap = new Map(); // numero normalizado → índice da entrada modelo=55
      D.vendas.forEach((v, i) => {
        if (Number(v?.modelo) === 55 && !v.is_recebimento) {
          const _n = String(v.numero || "").replace(/^0+/, "") || "0";
          _nfeMap.set(_n, i);
        }
      });
      const _remover = new Set();
      D.vendas.forEach((v, i) => {
        if (Number(v?.modelo) !== 99) return;
        const _pag = String(v.pagamentos || "").toLowerCase();
        if (!_pag.includes("nf-e") && !_pag.includes("nfe")) return;
        const _n = String(v.numero || "").replace(/^0+/, "") || "0";
        const iReal = _nfeMap.get(_n);
        if (iReal !== undefined && iReal !== i) {
          // Mescla dados úteis do stub (99) na entrada real (55)
          const real = D.vendas[iReal];
          if (!real.vendedor || real.vendedor === "(sem vendedor)" || real.vendedor === "?") {
            if (v.vendedor && v.vendedor !== "(sem vendedor)" && v.vendedor !== "?") real.vendedor = v.vendedor;
          }
          _remover.add(i);
        }
      });
      if (_remover.size > 0) {
        D.vendas = D.vendas.filter((_, i) => !_remover.has(i));
      }
    }

    if(!D.totais||typeof D.totais!=="object")D.totais={qtd:D.vendas.length,total:D.vendas.reduce((a,b)=>a+Number(b?.total||0),0)};
    if(typeof D.totais.qtd!=="number")D.totais.qtd=D.vendas.length;
    if(typeof D.totais.total!=="number")D.totais.total=D.vendas.reduce((a,b)=>a+Number(b?.total||0),0);
    return D;
};
_prepararDados(DADOS);

const fmt=v=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(v||0));
// Valor sem símbolo de moeda — usado na exibição de formas no modal
const fmtN=v=>new Intl.NumberFormat("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v||0));
const fmtCopia=v=>new Intl.NumberFormat("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:false}).format(Number(v||0));
// "2026-05-19" (ou "2026-05-19T10:00") -> "19/05/26" (dd/mm/aa). Vazio se a data faltar ou não for válida:
// quem usa decide o que mostrar — nunca se inventa uma data.
const _dataCurta=iso=>{
    const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso==null?"":iso));
    if(!m)return "";
    const mes=Number(m[2]),dia=Number(m[3]);
    if(mes<1||mes>12||dia<1||dia>31)return "";
    return m[3]+"/"+m[2]+"/"+m[1].slice(2);
};
// ATENÇÃO — espelha escHtml() do lado servidor (procure por "const escHtml"
// no topo do arquivo, dentro da função Node.js). Duplicação intencional —
// runtimes diferentes (navegador aqui, Node.js lá). Mudou um, muda o outro.
const esc=s=>String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

// _fetchJSON — wrapper compartilhado para todo fetch()+.json() do arquivo.
// ANTES: cada chamada fazia .then(r=>r.json()) direto, sem checar r.ok — uma
// resposta HTTP de erro (500, 502 etc.) só era pega INDIRETAMENTE se o corpo
// não fosse JSON válido (cai no .catch por acidente, não por checagem
// explícita). Uma resposta de erro que APESAR de tudo devolvesse um JSON
// válido (ex: {} de um proxy/gateway) passaria como se fosse sucesso.
const _fetchJSON = (url, opts) => fetch(url, opts).then(r => {
    if (!r.ok) throw new Error("HTTP " + r.status + " em " + url);
    return r.json();
});

// ── Temas de cores ───────────────────────────────────────────────────────────
// A lista (id, nome, grupo) vem do servidor — TEMAS_RELATORIO, no topo do gerar-relatorio-html.js —
// e é a MESMA que valida o tema salvo no <head>. O CSS de cada id é o bloco [data-theme="id"].
const TEMAS = (function(){ var t = ${temasJSON}; return Array.isArray(t) ? t : []; })();
const TEMA_PADRAO = "ultra-dark";
const TEMAS_LEGADOS_CLAROS = (function(){ var t = ${temasClarosJSON}; return Array.isArray(t) ? t : []; })();
const _temaPorId = (id) => { for (let i = 0; i < TEMAS.length; i++) { if (TEMAS[i].id === id) return TEMAS[i]; } return null; };
// Tema salvo: localStorage primeiro, cookie como reserva (o cookie vale para qualquer porta do mesmo
// host; o localStorage não). try/catch em cada leitura: com armazenamento bloqueado o acesso LANÇA erro.
const _lerTemaSalvo = () => {
    let t = "";
    try { t = localStorage.getItem("fdb_theme") || ""; } catch(e) {}
    if (!t) { try { t = (document.cookie.match(/(?:^|;\s*)fdb_theme=([^;]+)/) || [])[1] || ""; } catch(e) {} }
    if (_temaPorId(t)) return t;
    return TEMAS_LEGADOS_CLAROS.indexOf(t) >= 0 ? "light" : TEMA_PADRAO;
};
// O que está NA TELA (atributo do <html>) é a verdade — não o que está salvo.
const _temaAtual = () => {
    const a = document.documentElement.getAttribute("data-theme");
    return _temaPorId(a) ? a : TEMA_PADRAO;
};
const _salvarTema = (t) => {
    try { if (typeof _movTrocaTema === "function") _movTrocaTema(); } catch (e) {}
    setTimeout(() => { try { if (typeof _dshAgendar === "function") { _dshPrimeira = true; _dshAgendar(); } } catch (e) {} }, 0);
    try { localStorage.setItem("fdb_theme", t); } catch(e) {}
    try { document.cookie = "fdb_theme=" + t + ";path=/;max-age=31536000;SameSite=Strict"; } catch(e) {}
    document.documentElement.setAttribute("data-theme", t);
};
// Troca remota (api.ps1 → servidor → SSE "tema"): aplica, salva e avisa quem está na tela.
window.__aplicarTema = (id) => {
    const t = _temaPorId(id);
    if (!t) return false;
    _salvarTema(t.id);
    try { _tmMarcarAtual(); _tmAtualizarBotao(); } catch (e) {}
    setTimeout(() => { try { toast("Tema", "Tema alterado para " + t.nome + "."); } catch (e) {} }, 0);
    return true;
};
// ── Desempenho: modo leve (v3.10.0) ─────────────────────────────────────────
// Preferência em localStorage "fdb_perf": "auto" (padrão), "completo" ou "leve".
// No automático, além do que o <head> já decide (hardware, economia de dados,
// "reduzir movimento", medição salva), um teste rápido de processamento roda
// depois do carregamento: mediana de 3 rodadas acima de PERF_LIMITE_MS (máquina
// atual ≈ 3–5 ms; aparelho fraco ≥ 15 ms) liga o modo leve e guarda o resultado
// por 7 dias — nas próximas visitas a página já abre leve, sem trocar no meio.
// Independe do tamanho do relatório (um período longo demora até em PC bom).
const PERF_LIMITE_MS = 14;
const _perfPref = () => { try { const v = localStorage.getItem("fdb_perf"); return v === "leve" || v === "completo" ? v : "auto"; } catch (e) { return "auto"; } };
const _perfEhLeve = () => document.documentElement.getAttribute("data-perf") === "leve";
const _PERF_MOTIVOS = { escolhido: "escolhido por você", medido: "aparelho com baixo desempenho", hardware: "aparelho com pouca memória/processador", "economia de dados": "economia de dados ativa", sistema: "\"reduzir movimento\" ligado no sistema" };
const _perfEstadoTxt = () => {
    const pref = _perfPref();
    const leve = _perfEhLeve();
    const mot = document.documentElement.getAttribute("data-perf-motivo") || "";
    if (pref === "leve") return "Leve (escolhido)";
    if (pref === "completo") return "Completo (escolhido)";
    return "Automático — " + (leve ? "leve: " + (_PERF_MOTIVOS[mot] || mot || "aparelho mais lento") : "completo");
};
const _perfBench = () => {
    const t0 = performance.now();
    let a = 0; const arr = [];
    for (let i = 0; i < 120000; i++) { a += Math.sqrt(i) * Math.sin(i); if ((i & 63) === 0) arr.push(String(a).slice(0, 6)); }
    arr.sort();
    return performance.now() - t0;
};
const _perfMedir = () => {
    if (_perfPref() !== "auto" || _perfEhLeve()) return;
    if (document.hidden) { document.addEventListener("visibilitychange", function _v() { if (!document.hidden) { document.removeEventListener("visibilitychange", _v); setTimeout(_perfMedir, 1500); } }); return; }
    let ms;
    try { const r = [_perfBench(), _perfBench(), _perfBench()].sort((x, y) => x - y); ms = r[1]; } catch (e) { return; }
    const leve = ms > PERF_LIMITE_MS;
    try { localStorage.setItem("fdb_perf_auto", JSON.stringify({ v: leve ? "leve" : "completo", ts: Date.now(), ms: Math.round(ms * 10) / 10 })); } catch (e) {}
    if (leve && _perfPref() === "auto" && !_perfEhLeve()) {
        document.documentElement.setAttribute("data-perf", "leve");
        document.documentElement.setAttribute("data-perf-motivo", "medido");
        try { toast("Modo leve", "Este aparelho é mais lento: animações e efeitos foram reduzidos para não travar. Mude em Configurações → Nesta tela → Desempenho."); } catch (e) {}
        try { _perfMarcarMenu(); } catch (e) {}
    }
};
const _perfEscolher = (v) => {
    // "Automático" escolhido de novo: descarta a medição guardada e mede agora.
    try { if (v === "auto") { localStorage.removeItem("fdb_perf"); localStorage.removeItem("fdb_perf_auto"); } else localStorage.setItem("fdb_perf", v); } catch (e) {}
    if (typeof window.__perfDecidir === "function") window.__perfDecidir();
    else document.documentElement.setAttribute("data-perf", v === "leve" ? "leve" : "completo");
    if (v === "auto") setTimeout(_perfMedir, 50);
    try { _perfMarcarMenu(); } catch (e) {}
    try { window.dispatchEvent(new Event("resize")); } catch (e) {}
    try { toast("Desempenho", _perfEstadoTxt() + "."); } catch (e) {}
};
// Menu Tema → seção "Desempenho": marca a opção atual e o estado efetivo.
// ── Opções da tela (v3.24.0) ────────────────────────────────────────────────
// Visualização, desempenho, atualização e tamanho do texto: antes no menu Tema,
// agora em Configurações → "Nesta tela" (o menu Tema ficou só com os temas).
// Valem na hora e só para este aparelho (localStorage).
const _htmlPrefsTela = () => '<div class="tmPerf"><div class="tmHead tmPerfHead"><span class="tmTitulo">Visualização</span></div>'
        +   '<div class="tmPerfOps" role="radiogroup" aria-label="Visualização">'
        +     '<button type="button" class="tmPerfOp tmVisOp" role="radio" data-vis="simplificada">Simplificada</button>'
        +     '<button type="button" class="tmPerfOp tmVisOp" role="radio" data-vis="detalhada">Detalhada</button>'
        +   '</div>'
        +   '<div class="tmPerfDica">Detalhada: indicadores e gráficos (faturamento por hora, tipos, vendedores, pagamentos e produtos) acima da tabela, seguindo os filtros.</div>'
        + '</div>'
        + '<div class="tmPerf"><div class="tmHead tmPerfHead"><span class="tmTitulo">Desempenho</span><span class="tmAtual tmPerfEstado"></span></div>'
        +   '<div class="tmPerfOps" role="radiogroup" aria-label="Desempenho">'
        +     '<button type="button" class="tmPerfOp" role="radio" data-perf="auto">Automático</button>'
        +     '<button type="button" class="tmPerfOp" role="radio" data-perf="completo">Completo</button>'
        +     '<button type="button" class="tmPerfOp" role="radio" data-perf="leve">Leve</button>'
        +   '</div>'
        +   '<div class="tmPerfDica">Leve: sem animações, desfoque nem sombras pesadas — para computadores, notebooks e celulares mais fracos. O automático detecta sozinho.</div>'
        + '</div>'
        + '<div class="tmPerf"><div class="tmHead tmPerfHead"><span class="tmTitulo">Atualização</span><span class="tmAtual tmRecEstado"></span></div>'
        +   '<label class="tmRecLbl"><input type="checkbox" id="tmRecAuto"><span>Recarregar relatório ao detectar mudanças</span></label>'
        +   '<div class="tmPerfDica">Desligado: as vendas novas continuam entrando sozinhas, mas a página não recarrega — filtros, busca, rolagem e janelas abertas ficam como estão. Vale só para este aparelho.</div>'
        + '</div>'
        + '<div class="tmPerf tmZoom"><div class="tmHead tmPerfHead"><span class="tmTitulo">Tamanho do texto</span><span class="tmAtual tmZoomEstado"></span></div>'
        +   '<div class="tmPerfOps tmZoomOps" role="group" aria-label="Tamanho do texto">'
        +     '<button type="button" class="tmPerfOp tmZoomOp" data-zoom="-1" aria-label="Diminuir o texto">A−</button>'
        +     '<button type="button" class="tmPerfOp tmZoomOp" data-zoom="0" aria-label="Tamanho padrão">Padrão</button>'
        +     '<button type="button" class="tmPerfOp tmZoomOp" data-zoom="1" aria-label="Aumentar o texto">A+</button>'
        +   '</div>'
        + '</div>';
const _ligarPrefsTela = (raiz) => {
    if (!raiz) return;
    raiz.addEventListener("click", (e) => {
        const alvo = e.target;
        const oz = alvo && alvo.closest ? alvo.closest(".tmZoomOp") : null;
        if (oz && raiz.contains(oz)) { _zoomPasso(parseInt(oz.getAttribute("data-zoom"), 10) || 0); return; }
        const ov = alvo && alvo.closest ? alvo.closest(".tmVisOp") : null;
        if (ov && raiz.contains(ov)) { _visEscolher(ov.getAttribute("data-vis")); return; }
        const op = alvo && alvo.closest ? alvo.closest(".tmPerfOp[data-perf]") : null;
        if (op && raiz.contains(op)) { _perfEscolher(op.getAttribute("data-perf")); return; }
    });
    const cb = raiz.querySelector("#tmRecAuto");
    if (cb) cb.addEventListener("change", () => _recEscolher(cb.checked));
    _perfMarcarMenu(); _visMarcarMenu(); _zoomMarcarMenu(); _recMarcarMenu();
};
const _perfMarcarMenu = () => {
    const m = document.getElementById("cfgTela");
    if (!m) return;
    const pref = _perfPref();
    m.querySelectorAll(".tmPerfOp:not(.tmVisOp)").forEach(b => b.setAttribute("aria-checked", b.getAttribute("data-perf") === pref ? "true" : "false"));
    const est = m.querySelector(".tmPerfEstado");
    if (est) est.textContent = _perfEstadoTxt();
};
if (document.readyState === "complete") setTimeout(_perfMedir, 2500);
else window.addEventListener("load", () => setTimeout(_perfMedir, 2500), { once: true });

// Se o script do <head> falhou/foi bloqueado, o atributo pode estar ausente ou inválido: sincroniza.
if (!_temaPorId(document.documentElement.getAttribute("data-theme"))) {
    document.documentElement.setAttribute("data-theme", _lerTemaSalvo());
}
const btnTema = qs("#btnTema");
let _tmMenu = null;
let _tmAberto = false;
const _tmNomeAtual = () => { const t = _temaPorId(_temaAtual()); return t ? t.nome : ""; };

// Botão: aria-expanded + tooltip. Com o menu aberto o tooltip fica em branco (o tooltip flutuante
// apareceria por cima do menu se o mouse saísse e voltasse ao botão); fechado, mostra o tema atual.
const _tmAtualizarBotao = () => {
    if (!btnTema) return;
    btnTema.setAttribute("aria-expanded", _tmAberto ? "true" : "false");
    btnTema.setAttribute("data-tip", _tmAberto ? "" : "Escolher tema de cores — atual: " + _tmNomeAtual());
};
const _tmMarcarAtual = () => {
    if (!_tmMenu) return;
    const atual = _temaAtual();
    const cards = _tmMenu.querySelectorAll(".tmCard");
    for (let i = 0; i < cards.length; i++) {
        cards[i].setAttribute("aria-checked", cards[i].getAttribute("data-tema") === atual ? "true" : "false");
    }
    const lbl = _tmMenu.querySelector(".tmAtual");
    if (lbl) lbl.textContent = "Atual: " + _tmNomeAtual();
};
const _tmConstruir = () => {
    if (_tmMenu && _tmMenu.isConnected) return _tmMenu;
    _tmMenu = null;
    // Prévia: o span .tmPrev leva o data-theme do tema — as variáveis CSS dentro dele são as do tema.
    const linhaPrev = '<span class="tmPRow"><span class="tmPDot"></span><span class="tmPLn"></span><span class="tmPVal"></span></span>';
    const cardHtml = (t) =>
        '<button type="button" class="tmCard" role="menuitemradio" aria-checked="false" tabindex="-1" data-tema="' + esc(t.id) + '">'
        + '<span class="tmPrev" data-theme="' + esc(t.id) + '" aria-hidden="true">'
        +   '<span class="tmPSide"><span class="tmPAa">Aa</span><span class="tmPMuted"></span><span class="tmPPill"></span></span>'
        +   '<span class="tmPMain">' + linhaPrev + linhaPrev.replace('class="tmPRow"', 'class="tmPRow tmPHov"') + linhaPrev + '</span>'
        + '</span>'
        + '<span class="tmFoot"><span class="tmName">' + esc(t.nome) + '</span>'
        + '<svg class="tmCheck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg></span>'
        + '</button>';
    const m = document.createElement("div");
    m.id = "tmMenu"; m.className = "tmMenu";
    m.innerHTML = '<div class="tmHead"><span class="tmTitulo">Tema</span><span class="tmAtual"></span></div>'
        + '<div class="tmGrid" role="menu" aria-label="Temas de cores">' + TEMAS.map(cardHtml).join("") + '</div>';
    m.addEventListener("click", (e) => {
        const alvo = e.target;
        const c = alvo && alvo.closest ? alvo.closest(".tmCard") : null;
        if (!c || !m.contains(c)) return;
        _escolherTema(c.getAttribute("data-tema"));
        _tmFechar(true);
    });
    document.body.appendChild(m);
    _tmMenu = m;
    _tmMarcarAtual();
    return m;
};
// Posição: abaixo do botão, borda direita alinhada com a dele e sempre dentro da janela; se abaixo
// não cabe (janela baixa) e acima tem mais espaço, abre para cima. Altura limitada, com rolagem interna.
const _tmPosicionar = () => {
    if (!_tmMenu || !btnTema) return;
    const vw = document.documentElement.clientWidth || window.innerWidth || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const margem = 12;
    const larg = Math.max(160, Math.min(700, vw - margem * 2));
    const r = btnTema.getBoundingClientRect();
    const semAncora = !(r.width > 0 || r.height > 0);
    let left = semAncora ? vw - larg - margem : r.right - larg;
    left = Math.max(margem, Math.min(left, vw - larg - margem));
    const baseTop = semAncora ? 56 : r.bottom;
    const abaixo = vh - baseTop - margem - 8;
    const acima = semAncora ? 0 : r.top - margem - 8;
    _tmMenu.style.width = larg + "px";
    _tmMenu.style.left = left + "px";
    if (abaixo >= 300 || abaixo >= acima) {
        _tmMenu.style.top = (baseTop + 8) + "px";
        _tmMenu.style.bottom = "auto";
        _tmMenu.style.maxHeight = Math.max(160, abaixo) + "px";
        _tmMenu.style.transformOrigin = "top right";
    } else {
        _tmMenu.style.top = "auto";
        _tmMenu.style.bottom = (vh - r.top + 8) + "px";
        _tmMenu.style.maxHeight = Math.max(160, acima) + "px";
        _tmMenu.style.transformOrigin = "bottom right";
    }
    _tmAjustar(parseFloat(_tmMenu.style.maxHeight) || 0, larg);
};
// Auto-ajuste (v3.14.0): mede o conteúdo e, se passar da altura disponível, sobe o nível de
// compactação (CSS .tmMenu[data-compacto]) até caber — sem rolagem. Colunas: no nível 1-3,
// as necessárias para 2 linhas de temas; no 4, todos numa linha só (se a largura permitir).
// Cada nível só é aplicado se as colunas couberem na largura (cartão de no mínimo ~92 px).
const _tmAjustar = (disp, larg) => {
    const m = _tmMenu; if (!m) return;
    const grid = m.querySelector(".tmGrid");
    const n = grid ? grid.children.length : 0;
    m.removeAttribute("data-compacto");
    m.style.removeProperty("--tm-cols");
    if (!(disp > 0) || !n) return;
    const cabe = () => m.scrollHeight <= disp + 1;
    if (cabe()) return;
    const util = Math.max(0, larg - 30);
    const colsMax = Math.max(1, Math.floor((util + 8) / (92 + 8)));
    const cols2Linhas = Math.min(colsMax, Math.max(3, Math.ceil(n / 2)));
    const colsUmaLinha = Math.min(colsMax, n);
    for (let nivel = 1; nivel <= 4; nivel++) {
        m.setAttribute("data-compacto", String(nivel));
        let cols = nivel === 4 ? colsUmaLinha : cols2Linhas;
        if (nivel === 4 && cols < n) {
            // Último nível: alarga o menu (mantendo a borda direita) para os temas caberem numa linha.
            const vw = document.documentElement.clientWidth || window.innerWidth || 0;
            const novaLarg = Math.min(Math.max(160, vw - 24), n * 100 + 22);
            if (novaLarg > larg) {
                const dir = (parseFloat(m.style.left) || 0) + larg;
                m.style.width = novaLarg + "px";
                m.style.left = Math.max(12, Math.min(dir - novaLarg, vw - novaLarg - 12)) + "px";
                cols = Math.min(n, Math.max(1, Math.floor((novaLarg - 30 + 8) / 100)));
            }
        }
        m.style.setProperty("--tm-cols", String(cols));
        if (cabe()) return;
    }
    // Nem o nível 4 coube (janela muito baixa): fica no mais compacto, com rolagem interna.
};
const _tmAbrir = () => {
    if (_tmAberto) return;
    _tmConstruir();
    _tmMarcarAtual();
    _perfMarcarMenu();
    _visMarcarMenu();
    _zoomMarcarMenu();
    _recMarcarMenu();
    _tmAberto = true;
    _tmAtualizarBotao();
    _tmPosicionar();
    _tmMenu.classList.add("on");
    void _tmMenu.offsetWidth;
    const alvo = _tmMenu.querySelector('.tmCard[aria-checked="true"]') || _tmMenu.querySelector(".tmCard");
    if (alvo) { try { alvo.focus(); } catch(e) {} }
};
const _tmFechar = (devolverFoco) => {
    if (!_tmAberto) return;
    _tmAberto = false;
    if (_tmMenu) _tmMenu.classList.remove("on");
    _tmAtualizarBotao();
    if (devolverFoco && btnTema) { try { btnTema.focus(); } catch(e) {} }
};
// Aplica um tema (salva, marca no menu, avisa). Id inválido ou já ativo: não faz nada.
const _escolherTema = (id) => {
    const t = _temaPorId(id);
    if (!t || id === _temaAtual()) return false;
    _salvarTema(id);
    _tmMarcarAtual();
    _tmAtualizarBotao();
    toast("Tema alterado", t.nome);
    return true;
};
// Próximo/anterior na ordem da lista (usado pelas ações de atalho "tema:proximo" / "tema:anterior").
const _ciclarTema = (delta) => {
    const n = TEMAS.length;
    if (!n) return;
    const atual = _temaAtual();
    let i = 0;
    for (let k = 0; k < n; k++) { if (TEMAS[k].id === atual) { i = k; break; } }
    _escolherTema(TEMAS[(((i + delta) % n) + n) % n].id);
};
// Vizinho de cima/baixo na grade (pelas posições reais na tela — funciona com 2 ou 3 colunas).
const _tmVizinhoVertical = (cards, atual, dir) => {
    const ra = atual.getBoundingClientRect();
    let melhor = null, melhorD = Infinity;
    for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        if (c === atual) continue;
        const r = c.getBoundingClientRect();
        const dy = dir > 0 ? r.top - ra.top : ra.top - r.top;
        if (dy < ra.height / 2) continue;
        const dx = Math.abs((r.left + r.width / 2) - (ra.left + ra.width / 2));
        const d = dy * 4 + dx;
        if (d < melhorD) { melhorD = d; melhor = c; }
    }
    return melhor;
};
if (btnTema) {
    btnTema.addEventListener("click", () => { if (_tmAberto) _tmFechar(false); else _tmAbrir(); });
    _tmAtualizarBotao();
}
// Fora do menu e do botão: fecha (pointerdown em captura — pega mouse, toque e caneta).
document.addEventListener("pointerdown", (e) => {
    if (!_tmAberto) return;
    const alvo = e.target;
    if (_tmMenu && _tmMenu.contains(alvo)) return;
    if (btnTema && btnTema.contains(alvo)) return;
    _tmFechar(false);
}, true);
// Teclado (captura, só com o menu aberto): Esc fecha SÓ o menu (stopPropagation impede o Esc global de
// fechar também um modal); Tab fecha e segue; setas/Home/End movem o foco; Enter/Espaço = clique nativo.
document.addEventListener("keydown", (e) => {
    if (!_tmAberto || !_tmMenu) return;
    const k = e.key;
    if (k === "Escape") { e.preventDefault(); e.stopPropagation(); _tmFechar(true); return; }
    if (k === "Tab") { _tmFechar(true); return; }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (k !== "ArrowRight" && k !== "ArrowLeft" && k !== "ArrowDown" && k !== "ArrowUp" && k !== "Home" && k !== "End") return;
    const cards = Array.prototype.slice.call(_tmMenu.querySelectorAll(".tmCard"));
    const n = cards.length;
    if (!n) return;
    e.preventDefault();
    const i = cards.indexOf(document.activeElement);
    let alvo = null;
    if (k === "Home") alvo = cards[0];
    else if (k === "End") alvo = cards[n - 1];
    else if (i < 0) alvo = _tmMenu.querySelector('.tmCard[aria-checked="true"]') || cards[0];
    else if (k === "ArrowRight") alvo = cards[(i + 1) % n];
    else if (k === "ArrowLeft") alvo = cards[(i - 1 + n) % n];
    else alvo = _tmVizinhoVertical(cards, cards[i], k === "ArrowDown" ? 1 : -1) || cards[i];
    if (alvo) { try { alvo.focus(); } catch(err) {} }
}, true);
let _tmRaf = 0;
window.addEventListener("resize", () => {
    if (!_tmAberto || _tmRaf) return;
    _tmRaf = requestAnimationFrame(() => { _tmRaf = 0; if (_tmAberto) _tmPosicionar(); });
});

const rmAcento=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
const normP=v=>rmAcento(v).trim().toUpperCase().replace(/\s+/g," ");

const _indexarVendas = () => { for(let i=0; i<DADOS.vendas.length; i++){
    const x = DADOS.vendas[i];
    x._idx = i;
    // _busca inclui cliente e natureza para pesquisa full-text
    x._busca = rmAcento((x.vendedor||"")+" "+(x.tipo||"")+" "+(x.pagamentos||"")+" "+(x.itens||"")+" "+(x.caixa||"")+" "+(x.numero||"")+" "+(x.cliente||"")+" "+(x.natureza||"")).toLowerCase();
} };
_indexarVendas();

const LS_KEY="__cupons_proibidos__";
// PADRÃO DE FÁBRICA (v3.3.1): vazio. Antes trazia uma lista fixa de marcas de
// uma loja específica, aplicada automaticamente em qualquer instalação nova
// (e sempre que a lista do usuário ficasse vazia). Cada loja agora cadastra os
// próprios termos em Configurações → Proibidos; "Restaurar padrão" limpa a lista.
const proibidosPadrao=[];
const PROIB_FIXOS=["DESCONTO","<CANCELADO>","CANCELADO", "ACRÉSCIMO", "ACR�SCIMO" ];
const PROIB_FIXOS_N=new Set(PROIB_FIXOS.map(normP));
const uniq=a=>[...new Set(a)];
const escRe=s=>String(s||"").replace(/[-/\\^$*+?.()|[\]{}]/g,"\\$&");

// Detecta se uma entrada proibida é um filtro de valor (ex: >100, <50, >=200, =7000>150)
const _reValorProib = /^(>=|<=|>|<)[0-9]/;
const _isValorProib = v => {
    const s = String(v||"").trim();
    return _reValorProib.test(s) || /^\d[\d.,]*$/.test(s);
};

// Verifica se um valor numérico bate com um filtro de valor de proibido
const _valorBateProib=(expr,total)=>{
    const s=String(expr||"").trim();
    // Suporte a combinações: ex "=7000>150" (soma alvo E valor mínimo)
    // ou ">100=6578,96" (maior que 100 E próximo de 6578,96)
    const partes=s.split(/(?=[>=<])/g).filter(Boolean);
    for(const p of partes){
        const r=valorOk(p,total);
        if(r!==true)return false;
    }
    return true;
};

const lerProibidos=()=>{
    // v3.2.0: try/catch — com o armazenamento bloqueado o acesso LANÇA erro e a página inteira (tabela
    // incluída) deixava de carregar; agora cai nos proibidos embutidos/padrão.
    let raw=""; try{ raw=String(localStorage.getItem(LS_KEY)||"").trim(); }catch(_){ raw=""; }
    if(!raw)return proibidosPadrao.slice();
    let arr=[];
    if(raw.startsWith("[")){
        try{ const p=JSON.parse(raw); arr=Array.isArray(p)?p.map(String):[]; }
        catch(_){ arr=raw.replace(/^\[|\]$/g,"").split(","); }
    }else{
        arr=raw.split(/\n|,/g);
    }
    const limpo=uniq(arr.map(s=>s.trim()).filter(Boolean));
    return limpo.length?limpo:proibidosPadrao.slice();
};

let valoresProibidos=lerProibidos();
// Separa proibidos textuais dos filtros de valor
let _proibTextos=[];
let _proibValores=[];
let reProibidos=null;
const _recompileProibidos=()=>{
    _proibTextos=valoresProibidos.filter(v=>!_isValorProib(v)).map(normP).filter(Boolean);
    _proibValores=valoresProibidos.filter(_isValorProib);
    reProibidos=_proibTextos.length?new RegExp(_proibTextos.map(escRe).join("|"),"i"):null;
};
_recompileProibidos();

const setProibidosUser=(lista)=>{
    const limpo=uniq((lista||[]).map(s=>s.trim()).filter(Boolean));
    try{ localStorage.setItem(LS_KEY,limpo.join('\n')); }catch(_){ /* sem armazenamento: vale só nesta sessão */ }
    valoresProibidos=limpo.length?limpo:proibidosPadrao.slice();
    _recompileProibidos();
};

// ── Formato da lista de proibidos (v3.4.0) ──────────────────────────────────
// Formato aceito: UM termo por linha. Listas coladas de outros lugares chegam
// em formatos diversos (separadas por vírgula, ponto e vírgula, tabulação ou
// barra vertical, como lista JSON, com marcadores "- " / "1. ", entre aspas,
// com espaços sobrando ou repetidas) — aqui são detectadas e convertidas.
// Vírgula ENTRE DÍGITOS é decimal ("AGUA 1,5L", ">100=6578,96") e nunca separa
// termos. Limites iguais aos do servidor (_sanitizarProibidos).
const PROIB_MAX=500, PROIB_MAX_TAM=200;
const formatarProibidos=texto=>{
    const motivos=new Set();
    let bruto=String(texto==null?"":texto).replace(/\r\n?/g,"\n").replace(/[\u0000-\u0008\u000B-\u001F\u007F\u00A0\u200B\uFEFF]/g," ");
    let partes=null;
    const t=bruto.trim();
    // Lista JSON: ["A","B"] (só se for JSON válido de strings/números).
    if(t.charAt(0)==="["&&t.charAt(t.length-1)==="]"){
        try{
            const arr=JSON.parse(t);
            if(Array.isArray(arr)&&arr.every(v=>typeof v==="string"||typeof v==="number")){ partes=arr.map(String); motivos.add("lista JSON"); }
        }catch(_){}
        if(!partes&&t.indexOf("\n")<0){ bruto=t.slice(1,-1); motivos.add("colchetes"); }
    }
    if(!partes){
        partes=[];
        bruto.split("\n").forEach(linha=>{
            let l=linha;
            if(/;/.test(l)){ motivos.add("ponto e vírgula"); }
            if(/\t/.test(l)){ motivos.add("tabulação"); l=l.replace(/\t+/g,";"); }
            if(/\|/.test(l)){ motivos.add("barra vertical"); l=l.replace(/\|/g,";"); }
            l.split(";").forEach(seg=>{
                // Mascara a vírgula decimal (\u0001 nunca sobra: controles já foram limpos).
                const m=seg.replace(/(\d),(?=\d)/g,"$1\u0001");
                if(m.indexOf(",")>=0){ motivos.add("vírgula"); m.split(",").forEach(x=>partes.push(x.replace(/\u0001/g,","))); }
                else partes.push(seg);
            });
        });
    }
    const lista=[], vistos=new Set();
    let duplicados=0, longos=0;
    for(const p0 of partes){
        let s=String(p0).trim();
        if(!s)continue;
        const semMarc=s.replace(/^(?:[-*•·▪►]|\d{1,3}[.)])\s+/,"");
        if(semMarc!==s){ motivos.add("marcadores"); s=semMarc.trim(); }
        const semAsp=s.replace(/^(["'“”‘’\x60])(.*)\1$/,"$2").replace(/^[“‘](.*)[”’]$/,"$1");
        if(semAsp!==s){ motivos.add("aspas"); s=semAsp.trim(); }
        if(/\s{2,}/.test(s)){ motivos.add("espaços extras"); s=s.replace(/\s+/g," "); }
        if(!s)continue;
        if(s.length>PROIB_MAX_TAM){ s=s.slice(0,PROIB_MAX_TAM).trim(); longos++; }
        // Repetido = mesmo termo sem acento/maiúsculas (é assim que o filtro compara).
        const chave=_isValorProib(s)?"V:"+s.replace(/\s+/g,""):"T:"+normP(s);
        if(vistos.has(chave)){ duplicados++; continue; }
        vistos.add(chave); lista.push(s);
    }
    if(duplicados)motivos.add(duplicados+(duplicados===1?" repetido removido":" repetidos removidos"));
    if(longos)motivos.add(longos+(longos===1?" termo cortado":" termos cortados")+" em "+PROIB_MAX_TAM+" caracteres");
    const formatado=lista.join("\n");
    // Linhas vazias/espaços nas pontas: ajusta sem alarde (não é "formato errado").
    const alterado=formatado!==String(texto==null?"":texto).replace(/\r\n?/g,"\n").replace(/\s+$/,"");
    return {lista, texto:formatado, alterado, motivos:[...motivos],
            valores:lista.filter(_isValorProib).length, excedente:Math.max(0,lista.length-PROIB_MAX)};
};
// Liga contador + formatação automática a uma textarea de proibidos.
// Conta a cada tecla; formata ao colar e ao sair do campo (formatar durante a
// digitação moveria o cursor). Devolve a função que formata e retorna a lista.
const ligarEditorProibidos=(ta,elCont)=>{
    if(!ta)return ()=>[];
    let aviso="";
    const pintar=(r)=>{
        if(!elCont)return;
        const n=r.lista.length;
        let txt=n===0?"Nenhum termo adicionado":(n===1?"1 termo adicionado":n+" termos adicionados");
        if(r.valores)txt+=" ("+r.valores+(r.valores===1?" filtro":" filtros")+" de valor)";
        let cor="var(--text-muted)";
        if(r.excedente){ txt+=" — limite de "+PROIB_MAX+": os "+r.excedente+" últimos não serão salvos"; cor="var(--danger)"; }
        else if(aviso){ txt+=" — "+aviso; cor="var(--success)"; }
        else if(r.alterado&&r.motivos.length){ txt+=" — formato será ajustado ao sair do campo"; cor="var(--st-warn)"; }
        elCont.textContent=txt; elCont.style.color=cor;
    };
    const aplicar=()=>{
        const r=formatarProibidos(ta.value);
        if(r.alterado){
            ta.value=r.texto;
            aviso=r.motivos.length?"formato ajustado automaticamente ("+r.motivos.join(", ")+")":"";
        }
        pintar(r);
        return r.lista.slice(0,PROIB_MAX);
    };
    ta.addEventListener("input",()=>{ aviso=""; pintar(formatarProibidos(ta.value)); });
    ta.addEventListener("paste",()=>{ setTimeout(aplicar,0); });
    ta.addEventListener("blur",aplicar);
    aplicar();
    return aplicar;
};

// Aplica proibidos embutidos na geração IMEDIATAMENTE (sem flash), depois
// sincroniza com o servidor para pegar atualizações feitas após a geração.
(function _syncProibidos(){
    // 1. Estado inicial — proibidos embutidos no HTML no momento da geração
    const _embutidos = DADOS && Array.isArray(DADOS.proibidosServidor) ? DADOS.proibidosServidor : [];
    // v3.22.0: com o servidor, a lista DESTE aparelho já vem na página (window.__APARELHO__)
    // e vale mesmo vazia (ele pode ter limpado a dele); senão, a embutida, como antes.
    let _doAparelho = null;
    try { const ap = window.__APARELHO__; if (ap && ap.prefs && Array.isArray(ap.prefs.proibidos)) _doAparelho = ap.prefs.proibidos.map(String); } catch (_) {}
    if (_doAparelho) {
        setProibidosUser(_doAparelho);
    } else if (_embutidos.length) {
        setProibidosUser(_embutidos);
    }
    // 2. Sincroniza com o servidor (pega atualizações posteriores à geração)
    try{
        _fetchJSON('/api/proibidos',{cache:'no-store'})
        .then(d=>{
            if(Array.isArray(d.proibidos)&&(d.efetivo===true||d.proibidos.length)){
                const antes=valoresProibidos.join("\n");
                setProibidosUser(d.proibidos);
                if(valoresProibidos.join("\n")!==antes){ try{ renderTabela(); }catch(_){} }
            }
        }).catch(()=>{});
    }catch(e){}
})();

// ── Painel "Duplicatas" (v2.9.0; escolhas por par em v3.8.3) ─────────────
// Gerenciais que o gerador suprimiu automaticamente nesta geração (já
// convertidas em NFC-e/NF-e — vínculo pela coluna Gerencial ou reconciliação
// por data/valor/vendedor no lado Node.js) e NFC-e reemitidas como NF-e
// (mesma data/valor/itens — v3.8.4; nesse caso "gerencial" abaixo = a NFC-e). Por padrão o documento fiscal
// PREVALECE: a gerencial fica FORA da tabela e da soma. Como fallback de
// dúvida, o painel oferece por par (pedido do usuário):
//   • "Manter as duas"            — exibe e soma a gerencial E o documento.
//   • "Manter apenas NF-e/NFC-e"  — padrão: só o documento fiscal.
//   • "Manter apenas a gerencial" — o documento sai da tabela/soma e a
//      gerencial volta no lugar dele.
//   • "Perguntar depois"          — não decide nada; volta na próxima geração.
// As 3 escolhas ficam salvas em localStorage por par gerencial+documento.
// Ação GLOBAL "Manter todas as duplicatas": exibe e soma a gerencial de toda
// duplicata SEM escolha salva (nesta e nas próximas gerações), até desativar.
// Escolha específica do par vence a global. Um único modal para todas.
// LIMITAÇÃO: a gerencial reconstituída pela coluna Gerencial (confirmada)
// não tem o detalhamento de pagamento/itens — aparece com essa ressalva.
// A da reconciliação final (v3.8.3) traz pagamento e itens reais.
const LS_DUP_MANTER_TODAS = "__dup_manter_todas__";
const LS_DUP_OCULTO_PREFIXO = "__dup_oculto__::";   // legado (v2.9.0) = "fiscal"
const LS_DUP_ESCOLHA_PREFIXO = "__dup_escolha__::";
const SS_DUP_REABRIR = "__dup_reabrir__"; // sessionStorage: reabrir o painel após trocar uma escolha
const DUP_ESCOLHAS = ["todas", "fiscal", "gerencial"];
const _dupChaveItem = d => String(d.gerencial) + "::" + String(d.docNumero);
const _dupRotDoc = d => Number(d.docModelo) === 65 ? "NFC-e" : "NF-e";
// Documento absorvido: gerencial (padrão) ou NFC-e reemitida como NF-e (v3.8.4).
const _dupOrigemNfce = d => Number(d.origemModelo) === 65;
const _dupRotOrigem = d => _dupOrigemNfce(d) ? "NFC-e" : "Gerencial";
const _dupLerManterTodas = () => { try { return localStorage.getItem(LS_DUP_MANTER_TODAS) === "1"; } catch(e) { return false; } };
const _dupSalvarManterTodas = (v) => { try { if (v) localStorage.setItem(LS_DUP_MANTER_TODAS, "1"); else localStorage.removeItem(LS_DUP_MANTER_TODAS); } catch(e) {} };
const _dupLerEscolha = (d) => {
    try {
        const ch = _dupChaveItem(d);
        const v = localStorage.getItem(LS_DUP_ESCOLHA_PREFIXO + ch);
        if (DUP_ESCOLHAS.includes(v)) return v;
        if (localStorage.getItem(LS_DUP_OCULTO_PREFIXO + ch) === "1") return "fiscal";
    } catch(e) {}
    return null;
};
const _dupSalvarEscolha = (d, v) => {
    if (!DUP_ESCOLHAS.includes(v)) return;
    try {
        const ch = _dupChaveItem(d);
        localStorage.setItem(LS_DUP_ESCOLHA_PREFIXO + ch, v);
        localStorage.removeItem(LS_DUP_OCULTO_PREFIXO + ch);
    } catch(e) {}
};

let _dupConf = [], _dupProv = [], _dupTodas = [];
const _dupLerListas = () => {
    _dupConf = ((DADOS.duplicatas && Array.isArray(DADOS.duplicatas.confirmadas)) ? DADOS.duplicatas.confirmadas : []).map(d => ({...d, _tipo: "confirmado"}));
    _dupProv = ((DADOS.duplicatas && Array.isArray(DADOS.duplicatas.provaveis))   ? DADOS.duplicatas.provaveis   : []).map(d => ({...d, _tipo: "provavel"}));
    _dupTodas = [..._dupConf, ..._dupProv];
};
_dupLerListas();

// Reconstitui a linha da gerencial no formato de DADOS.vendas, para poder
// exibi-la e somá-la quando o usuário escolhe mantê-la.
const _dupSintetizarLinha = d => {
    const _temPag = d.formasValores && typeof d.formasValores === "object" && Object.keys(d.formasValores).length > 0;
    return {
        _dtKey: d.dt || DADOS.data,
        vendedor: d.vendedor || "",
        modelo: _dupOrigemNfce(d) ? 65 : 99,
        tipo: _dupOrigemNfce(d) ? "nfc-e" : "gerencial",
        numero: d.gerencial,
        caixa: d.caixa || "",
        hora: d.hora || "",
        cliente: d.cliente || "",
        natureza: d.natureza || "",
        total: Number(d.total || 0),
        pagamentos: _temPag && d.pagamentos ? String(d.pagamentos) : "Duplicata mantida manualmente — pagamento indisponível",
        itens: d.itens || "",
        itensDetalhe: Array.isArray(d.itensDetalhe) ? d.itensDetalhe : [],
        formasValores: _temPag ? {...d.formasValores} : {},
        is_recebimento: false,
        _duplicataMantida: true
    };
};

const _dupPrepararLinha = (linha, idx) => {
    linha._idx = idx;
    linha._busca = rmAcento((linha.vendedor||"")+" "+(linha.tipo||"")+" "+(linha.pagamentos||"")+" "+(linha.itens||"")+" "+(linha.caixa||"")+" "+(linha.numero||"")+" "+(linha.cliente||"")+" "+(linha.natureza||"")).toLowerCase();
};

// Soma (sinal +1) ou subtrai (sinal -1) uma linha dos totais fixos
// (DADOS.totais/DADOS.totaisDia/DADOS.vendTotaisDia — não são recalculados a
// partir de DADOS.vendas; os badges de QUANTIDADE (#tQtdGer etc.) SÃO, então
// já ficam corretos sem ajuste extra).
const _dupCent = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const _dupAjustarTotais = (x, sinal) => {
    const v = Number(x && x.total || 0) * sinal;
    const m = Number(x && x.modelo || 0);
    const campo = m === 99 ? "gerencial" : m === 65 ? "nfce" : m === 55 ? "nfe" : null;
    if (DADOS.totais) {
        DADOS.totais.total = _dupCent(Number(DADOS.totais.total || 0) + v);
        DADOS.totais.qtd = Math.max(0, Number(DADOS.totais.qtd || 0) + sinal);
    }
    if (DADOS.totaisDia && DADOS.totaisDia.ok) {
        const td = DADOS.totaisDia;
        td.selecionado = _dupCent(Number(td.selecionado || 0) + v);
        td.geral       = _dupCent(Number(td.geral       || 0) + v);
        if (campo) {
            td[campo] = _dupCent(Number(td[campo] || 0) + v);
            td["qtd_" + campo] = Math.max(0, Number(td["qtd_" + campo] || 0) + sinal);
        }
    }
    // vendTotaisDia é a fonte real do painel "Vendedores"; DADOS.vendedores é só
    // um resumo derivado dela, então é resincronizado inteiro logo abaixo.
    if (Array.isArray(DADOS.vendTotaisDia)) {
        const nomeVend = (x && x.vendedor) || "";
        let vt = DADOS.vendTotaisDia.find(y => y.vendedor === nomeVend);
        if (!vt && sinal > 0) { vt = { vendedor: nomeVend, gerencial: 0, nfce: 0, nfe: 0, geral: 0, qtd: 0 }; DADOS.vendTotaisDia.push(vt); }
        if (vt) {
            if (campo) vt[campo] = _dupCent(Number(vt[campo] || 0) + v);
            vt.geral = _dupCent(Number(vt.geral || 0) + v);
            vt.qtd   = Math.max(0, Number(vt.qtd || 0) + sinal);
            if (vt.qtd === 0) DADOS.vendTotaisDia.splice(DADOS.vendTotaisDia.indexOf(vt), 1);
        }
        DADOS.vendTotaisDia.sort((a, b) => String(a.vendedor).localeCompare(String(b.vendedor), "pt-BR", { sensitivity: "base" }));
        if (Array.isArray(DADOS.vendedores)) {
            DADOS.vendedores = DADOS.vendTotaisDia.map(y => ({ vendedor: y.vendedor, qtd: y.qtd, total: y.geral }));
        }
    }
};

// Limpa o HTML em cache de uma linha (as caches são declaradas mais abaixo;
// na carga ainda estão em zona morta — e vazias —, por isso o try/catch).
const _dupLimparCacheLinha = (idx) => {
    try { _tdHtmlCache.delete(idx); } catch(e) {}
    try { _miniHtmlCache.delete(idx); } catch(e) {}
};

// "Manter as duas": a gerencial entra na tabela e na soma.
const _dupInjetarNaTabela = (d) => {
    const _linha = _dupSintetizarLinha(d);
    _dupPrepararLinha(_linha, DADOS.vendas.length);
    DADOS.vendas.push(_linha);
    _dupAjustarTotais(_linha, +1);
};

// Acha a linha do documento fiscal do par em DADOS.vendas (número sem zeros à
// esquerda, mesma data quando informada; modelo igual tem preferência porque a
// NFC-e pode ter sido reclassificada como NF-e no gerador).
const _dupAcharDoc = (d) => {
    const alvo = String(d.docNumero == null ? "" : d.docNumero).trim().replace(/^0+/, "");
    if (!alvo) return -1;
    let idxQualquer = -1;
    for (let i = 0; i < DADOS.vendas.length; i++) {
        const x = DADOS.vendas[i];
        if (!x || x.is_recebimento || x._duplicataMantida) continue;
        const m = Number(x.modelo || 0);
        if (m !== 65 && m !== 55) continue;
        if (d.dt && x._dtKey && x._dtKey !== d.dt) continue;
        if (String(x.numero == null ? "" : x.numero).trim().replace(/^0+/, "") !== alvo) continue;
        if (Number(d.docModelo) === m) return i;
        if (idxQualquer < 0) idxQualquer = i;
    }
    return idxQualquer;
};

// "Manter apenas a gerencial": a gerencial ocupa o lugar do documento (mesmo
// _idx — nenhuma outra linha muda de índice) e os totais trocam um pelo outro.
// Documento não encontrado (ex.: filtrado nesta geração): só entra a gerencial.
const _dupTrocarDocPelaGerencial = (d) => {
    const i = _dupAcharDoc(d);
    if (i < 0) { _dupInjetarNaTabela(d); return; }
    _dupAjustarTotais(DADOS.vendas[i], -1);
    const _linha = _dupSintetizarLinha(d);
    _dupPrepararLinha(_linha, i);
    DADOS.vendas[i] = _linha;
    _dupLimparCacheLinha(i);
    _dupAjustarTotais(_linha, +1);
};

// Aplica a escolha UMA vez por par nesta página (nunca soma/troca em dobro).
const _dupAplicar = (d, escolha) => {
    if (d._aplicada) return false;
    if (escolha === "todas") _dupInjetarNaTabela(d);
    else if (escolha === "gerencial") _dupTrocarDocPelaGerencial(d);
    d._aplicada = escolha;
    return escolha !== "fiscal";
};

// ── Aplica decisões já salvas (localStorage) ANTES de qualquer render ──
let _dupManterTodasAtivo = _dupLerManterTodas();
const _dupPendentes = [];
// Precedência: a escolha ESPECÍFICA do par vence a GERAL ("manter todas"). É a
// mesma regra do clique ao vivo em "Manter todas", que só atua sobre as
// pendentes — assim carga e clique nunca divergem.
const _dupAplicarSalvas = () => {
    _dupManterTodasAtivo = _dupLerManterTodas();
    _dupPendentes.length = 0;
    for (const d of _dupTodas) {
        const escSalva = _dupLerEscolha(d);
        if (escSalva) { _dupAplicar(d, escSalva); continue; }
        if (_dupManterTodasAtivo) { _dupAplicar(d, "todas"); continue; }
        _dupPendentes.push(d); // sem decisão — vai pro modal
    }
};
_dupAplicarSalvas();

// ── Rastro na tabela (v3.8.7) ──────────────────────────────────────────────
// A linha que ficou na tabela ganha um chip "Duplicata" dizendo qual documento
// do par foi ocultado (ou que os dois estão aparecendo) e por qual escolha —
// salva pelo usuário ou o padrão (documento final prevalece). Clicar no chip
// abre o painel Duplicatas já com o par destacado.
const _dupNum = v => String(v == null ? "" : v).trim().replace(/^0+/, "");
const _dupAcharOrigemMantida = (d) => {
    const alvo = _dupNum(d.gerencial);
    for (let i = 0; i < DADOS.vendas.length; i++) {
        const x = DADOS.vendas[i];
        if (x && x._duplicataMantida && _dupNum(x.numero) === alvo && (!d.dt || !x._dtKey || x._dtKey === d.dt)) return i;
    }
    return -1;
};
const _dupMarcarLinhas = () => {
    for (const x of DADOS.vendas) if (x && x._dupNota) { delete x._dupNota; }
    for (const d of _dupTodas) {
        const salva = _dupLerEscolha(d);
        const escolha = d._aplicada || salva || "fiscal";
        const porque = salva ? "escolha salva: " + (_DUP_ROTULO_ESCOLHA_CURTO[salva] ? _DUP_ROTULO_ESCOLHA_CURTO[salva](d) : salva)
            : (d._aplicada === "todas" ? "modo \"manter todas\"" : (_dupPendentes.includes(d) ? "padrão — aguardando sua escolha" : "padrão: o documento final prevalece"));
        const nota = (i, rotulo, texto) => {
            if (i < 0 || !DADOS.vendas[i]) return;
            DADOS.vendas[i]._dupNota = { rotulo, tip: texto + "\n(" + porque + ")\n\nClique para abrir o painel Duplicatas", chave: _dupChaveItem(d) };
        };
        const origem = _dupRotOrigem(d) + " " + d.gerencial, doc = _dupRotDoc(d) + " " + d.docNumero;
        if (escolha === "gerencial") {
            nota(_dupAcharOrigemMantida(d), "Duplicata: " + doc + " oculta", "Esta venda também foi emitida como " + doc + ", que está oculta.");
        } else if (escolha === "todas") {
            nota(_dupAcharDoc(d), "Duplicata: " + origem + " também aparece", "Mesma venda que " + origem + " — as duas estão na lista e na soma.");
            nota(_dupAcharOrigemMantida(d), "Duplicata: " + doc + " também aparece", "Mesma venda que " + doc + " — as duas estão na lista e na soma.");
        } else {
            nota(_dupAcharDoc(d), "Duplicata: " + origem + " oculta", "Esta venda também foi lançada como " + origem + ", que está oculta.");
        }
    }
    try { _tdHtmlCache.clear(); } catch (e) {}
    try { _miniHtmlCache.clear(); } catch (e) {}
};
const _DUP_ROTULO_ESCOLHA_CURTO = {
    fiscal: d => "manter apenas " + _dupRotDoc(d),
    todas: () => "manter as duas",
    gerencial: d => "manter apenas a " + _dupRotOrigem(d)
};
_dupMarcarLinhas();

const _dupAtualizarBotao = () => {
    const btn = document.getElementById("btnDuplicatas");
    if (!btn) return;
    if (_dupTodas.length > 0) {
        btn.style.display = "";
        const badge = document.getElementById("badgeDuplicatas");
        if (badge) badge.textContent = "(" + _dupTodas.length + ")";
    } else {
        btn.style.display = "none";
    }
};
_dupAtualizarBotao();

const _DUP_ROTULO_ESCOLHA = { todas: "manter as duas", fiscal: "manter apenas o documento final", gerencial: "manter apenas o documento de origem" };

const abrirDuplicatas=(itens, destaque)=>{
    if (document.getElementById("ovDup")) return; // guarda contra abertura dupla
    const bg=document.createElement("div"); bg.className="ov"; bg.id="ovDup"; bg.setAttribute("aria-hidden","false");

    // Ordem importa: fechar/escKey são definidos ANTES de qualquer render(), porque o
    // render() liga handlers que leem "fechar" na hora (const em zona morta lançaria
    // ReferenceError). Todas as consultas são ESCOPADAS em bg (bg.querySelector) — o
    // qs() global ignora o 2º argumento e o bg só entra no documento depois do render.
    const escKey=(e)=>{ if(e.key==="Escape") fechar(); };
    const fechar=()=>{ document.removeEventListener("keydown",escKey); _fecharOverlayAnimado(bg); };

    // Pares que já têm escolha salva — listados à parte para poder REVER a escolha.
    const decididas = () => _dupTodas.filter(d => !itens.includes(d) && _dupLerEscolha(d));

    const linhaItem = (d, decidida) => {
        const doc = _dupRotDoc(d);
        const origem = _dupRotOrigem(d);
        const _motivo = d.criterio === "itens"
            ? 'mesmo valor/data e mesmos itens'+(d.diffMin != null ? ', +'+esc(d.diffMin)+'min' : '')
            : 'mesmo valor/data/vendedor, +'+esc(d.diffMin)+'min';
        const rotulo = d._tipo === "confirmado"
            ? '<span style="color:var(--st-ok)">● confirmado</span> — '+origem+' <b>'+esc(d.gerencial)+'</b> → '+doc+' <b>'+esc(d.docNumero)+'</b> <span style="opacity:.6">(vínculo direto pela coluna Gerencial)</span>'
            : '<span style="color:var(--st-warn)">● provável</span> — '+origem+' <b>'+esc(d.gerencial)+'</b> → '+doc+' <b>'+esc(d.docNumero)+'</b> <span style="opacity:.6">('+_motivo+(d.ambiguo?', havia mais de uma candidata':'')+')</span>';
        const valor = Number(d.total || 0) > 0 ? ' <span style="opacity:.75">'+esc(Number(d.total).toLocaleString("pt-BR",{style:"currency",currency:"BRL"}))+(d.vendedor?' · '+esc(d.vendedor):'')+'</span>' : '';
        const atual = decidida ? _dupLerEscolha(d) : null;
        const botao = (cls, txt, escolha) => atual===escolha
            ? '<div class="btn '+cls+' dupEscolhido" aria-pressed="true" style="font-size:12px;padding:4px 10px">✓ '+txt+'</div>'
            : '<div class="btn '+cls+'" style="font-size:12px;padding:4px 10px">'+txt+'</div>';
        return '<div class="dupItem" data-chave="'+esc(_dupChaveItem(d))+'" style="padding:10px;border-bottom:1px solid var(--line-soft);font-size:13px">'
            + '<div style="margin-bottom:6px">'+rotulo+valor+'</div>'
            + (atual ? '<div class="dupEscolhaTxt">✓ Escolha aplicada: <b>'+esc(_DUP_ROTULO_ESCOLHA_CURTO[atual] ? _DUP_ROTULO_ESCOLHA_CURTO[atual](d) : atual)+'</b></div>' : '')
            + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
            + botao("dupBtnFiscal", "Manter apenas "+doc, "fiscal")
            + botao("dupBtnTodas1", "Manter as duas", "todas")
            + botao("dupBtnGer", "Manter apenas a "+origem, "gerencial")
            + (decidida ? '' : '<div class="btn dupBtnDepois" style="font-size:12px;padding:4px 10px">Perguntar depois</div>')
            + '</div></div>';
    };

    const render=()=>{
        const listaDec = decididas();
        const corpoPend = itens.length === 0
            ? '<div style="padding:16px;opacity:.7;font-size:13px">Nenhuma duplicata pendente de decisão.'
              + (_dupManterTodasAtivo ? '<br><br>Modo <b>"manter todas"</b> está ativo — toda duplicata sem escolha salva é exibida e somada automaticamente.' : '')
              + '</div>'
            : itens.map(d => linhaItem(d, false)).join("");
        const corpoDec = listaDec.length === 0 ? '' :
            '<div style="padding:10px 10px 4px;font-size:12px;font-weight:700;opacity:.7">Já decididas — clique em outra opção para trocar (a página recarrega já com a nova escolha)</div>'
            + listaDec.map(d => linhaItem(d, true)).join("");
        const txtManterTodas = _dupManterTodasAtivo ? 'Desativar "manter todas"' : "Manter todas as duplicatas";
        bg.innerHTML='<div class="modal" role="dialog" aria-modal="true"><div class="mhead"><div><div class="mtitle">Duplicatas</div><div class="msub">Gerenciais convertidas em NFC-e/NF-e e NFC-e reemitidas como NF-e — por padrão só o documento final fica. Escolha o que fazer com cada par.</div></div><div class="btn" id="dupFechar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Fechar</div></div>'
            + '<div class="mbody" style="padding-bottom:0">'
            + '<div class="btn" id="dupBtnTodas" style="margin-bottom:10px;width:100%;justify-content:center">'+txtManterTodas+'</div>'
            + '</div>'
            + '<div class="mbody" id="dupLista" style="max-height:50vh;overflow:auto;padding-top:0">'+corpoPend+corpoDec+'</div></div>';

        bg.querySelector("#dupFechar").addEventListener("click",fechar);

        bg.querySelector("#dupBtnTodas").addEventListener("click", () => {
            const ligar = !_dupManterTodasAtivo;
            _dupSalvarManterTodas(ligar);
            _dupManterTodasAtivo = ligar;
            if (ligar) {
                // Só as pendentes entram: as que têm escolha salva seguem a escolha
                // (decisão específica vence a geral — ver laço de carga).
                for (const d of itens) _dupAplicar(d, "todas");
                itens.length = 0;
                renderTabela();
            }
            render();
            toast("Duplicatas", ligar ? "Todas as duplicatas sem escolha salva passam a ser exibidas." : "Modo \"manter todas\" desativado — vale a partir da próxima atualização do relatório.");
        });

        // Liga os botões de escolha de cada item (pendente: aplica já; decidida:
        // salva e vale na próxima atualização — desfazer a troca ao vivo exigiria
        // reconstituir linhas que a página não tem).
        const ligarEscolhas = (lista, decidida) => {
            const els = [...bg.querySelectorAll("#dupLista .dupItem")].filter(el => (el.dataset.dec === "1") === decidida);
            els.forEach((el, i) => {
                const d = lista[i];
                if (!d) return;
                const escolher = (escolha) => {
                    const rot = _DUP_ROTULO_ESCOLHA_CURTO[escolha] ? _DUP_ROTULO_ESCOLHA_CURTO[escolha](d) : escolha;
                    if (decidida) {
                        const antes = _dupLerEscolha(d);
                        if (antes === escolha) return; // já é a escolha atual
                        _dupSalvarEscolha(d, escolha);
                        // Desfazer a troca anterior ao vivo exigiria reconstituir linhas que a
                        // página não tem: recarrega e reabre o painel com o par destacado — as
                        // escolhas salvas são aplicadas na carga, do mesmo jeito de sempre.
                        try { sessionStorage.setItem(SS_DUP_REABRIR, JSON.stringify({ chave: _dupChaveItem(d), msg: rot })); } catch (e) {}
                        location.reload();
                        return;
                    }
                    _dupSalvarEscolha(d, escolha);
                    _dupAplicar(d, escolha);
                    const pos = itens.indexOf(d);
                    if (pos >= 0) itens.splice(pos, 1);
                    _dupMarcarLinhas();
                    renderTabela();
                    render();
                    _dupDestacar(_dupChaveItem(d));
                    toast("Duplicatas", "Escolha aplicada: " + rot + ".");
                };
                const b1 = el.querySelector(".dupBtnFiscal"); if (b1) b1.addEventListener("click", () => escolher("fiscal"));
                const b2 = el.querySelector(".dupBtnTodas1"); if (b2) b2.addEventListener("click", () => escolher("todas"));
                const b3 = el.querySelector(".dupBtnGer");    if (b3) b3.addEventListener("click", () => escolher("gerencial"));
                const b4 = el.querySelector(".dupBtnDepois");
                if (b4) b4.addEventListener("click", () => {
                    const pos = itens.indexOf(d);
                    if (pos >= 0) itens.splice(pos, 1); // some do modal SEM salvar decisão — volta a perguntar na próxima geração
                    if (itens.length === 0 && decididas().length === 0) { fechar(); return; }
                    render();
                });
            });
        };
        // Marca cada item com o grupo (pendente/decidida) na mesma ordem do HTML.
        const _todosEls = [...bg.querySelectorAll("#dupLista .dupItem")];
        _todosEls.forEach((el, i) => { el.dataset.dec = i < itens.length ? "0" : "1"; });
        ligarEscolhas(itens.slice(), false);
        ligarEscolhas(listaDec, true);
    };

    // Clique FORA do conteúdo fecha. Ligado uma única vez: o render() só troca o
    // innerHTML interno e não recria o próprio bg, então o listener sobrevive.
    bg.addEventListener("click",e=>{ if(e.target===bg) fechar(); });

    // Destaca (rola até e pisca) o par recém-decidido — rastro visual da escolha.
    const _dupDestacar = (chave) => {
        if (!chave) return;
        const el = [...bg.querySelectorAll("#dupLista .dupItem")].find(x => x.dataset.chave === chave);
        if (!el) return;
        try { el.scrollIntoView({ block: "nearest" }); } catch (e) {}
        el.classList.remove("dupDestaque"); void el.offsetWidth; el.classList.add("dupDestaque");
    };

    render();
    document.body.appendChild(bg);
    void bg.offsetWidth;          // força reflow p/ a transição de opacidade rodar
    bg.classList.add("on");
    document.addEventListener("keydown",escKey);
    if (destaque) _dupDestacar(destaque);
};
{ const _b = document.getElementById("btnDuplicatas"); if (_b) _b.addEventListener("click", () => abrirDuplicatas(_dupPendentes)); }
// Chip "Duplicata" da tabela abre o painel com o par destacado (captura: não
// deixa o clique seguir para a linha, que abriria o modal da venda).
document.addEventListener("click", (e) => {
    const chip = e.target && e.target.closest ? e.target.closest(".tdItemDup") : null;
    if (!chip) return;
    e.preventDefault(); e.stopPropagation();
    abrirDuplicatas(_dupPendentes, chip.getAttribute("data-dup") || "");
}, true);
// Volta de uma troca de escolha (recarga): reabre o painel no par e confirma.
let _dupReabrir = null;
try { _dupReabrir = JSON.parse(sessionStorage.getItem(SS_DUP_REABRIR) || "null"); sessionStorage.removeItem(SS_DUP_REABRIR); } catch (e) { _dupReabrir = null; }
if (_dupReabrir && _dupReabrir.chave) {
    abrirDuplicatas(_dupPendentes, _dupReabrir.chave);
    setTimeout(() => { try { toast("Duplicatas", "Escolha aplicada: " + String(_dupReabrir.msg || "") + "."); } catch (e) {} }, 0);
} else
// Abre automaticamente se houver duplicata pendente de decisão nesta geração —
// pedido explícito: "peça uma ação do usuário" (não fica só esperando clique no botão).
// Usa a MESMA referência de array em ambos os pontos de abertura — decisões
// tomadas aqui (ex.: "perguntar depois") ficam refletidas se o usuário
// reabrir pelo botão na mesma sessão, em vez de mostrar itens já tratados.
if (_dupPendentes.length > 0) abrirDuplicatas(_dupPendentes);

const __ncToastMsgs=new Set();
// Inicializa __TOAST_MS com o valor embutido na geração do HTML (config.json → toastDuracao).
// Pode ser sobrescrito pelo modal de configurações sem recarregar a página.
window.__TOAST_MS = (typeof __TOAST_DURACAO__==="number" && __TOAST_DURACAO__>=500) ? __TOAST_DURACAO__ : 5000;
// Teclas de atalho — inicializadas do HTML embutido; atualizadas in-place ao salvar configurações.
window.__teclasPersonalizadas = (typeof __TECLAS_PERSONALIZADAS__!=="undefined" && Array.isArray(__TECLAS_PERSONALIZADAS__)) ? __TECLAS_PERSONALIZADAS__ : [];
// ── Preferências deste aparelho (v3.22.0) ───────────────────────────────────
// Cada aparelho da rede tem as suas (duração dos avisos, proibidos, teclas de
// atalho): o servidor injeta window.__APARELHO__ com as dele já resolvidas (as
// próprias por cima do padrão do servidor). Sem servidor (arquivo aberto direto),
// valem as embutidas, como antes. Aviso "prefs" pelo SSE → __aplicarPrefs relê.
const _aplicarPrefsObj = (pf, comLista) => {
    if (!pf || typeof pf !== "object") return false;
    const td = parseInt(pf.toastDuration, 10);
    if (td >= 500 && td <= 60000) window.__TOAST_MS = td;
    if (Array.isArray(pf.teclasPersonalizadas)) window.__teclasPersonalizadas = pf.teclasPersonalizadas.filter(t => t && t.tecla && (t.comando || t.acao));
    if (comLista && Array.isArray(pf.proibidos)) {
        const nova = pf.proibidos.map(String), antes = valoresProibidos.join("\n");
        setProibidosUser(nova);
        return valoresProibidos.join("\n") !== antes;
    }
    return false;
};
try { if (window.__APARELHO__ && window.__APARELHO__.prefs) _aplicarPrefsObj(window.__APARELHO__.prefs, false); } catch (_) {}
window.__aplicarPrefs = () => {
    _fetchJSON("/api/preferencias", {cache: "no-store"}).then(d => {
        if (!d || !d.ok) return;
        if (_aplicarPrefsObj(d.prefs, true)) { try { renderTabela(); } catch (_) {} }
    }).catch(() => {});
};
const showToast=msg=>{
    if(!msg||__ncToastMsgs.has(msg))return;
    __ncToastMsgs.add(msg);
    if(!document.getElementById("__nc_toast_css")){
        const st=document.createElement("style");
        st.id="__nc_toast_css";
        st.textContent=".__nc_toast_box{position:fixed;top:16px;left:16px;z-index:2147483647!important;display:flex;flex-direction:column;gap:10px;pointer-events:none} .__nc_toast{pointer-events:auto;background:var(--bg-panel);border:1px solid var(--border-focus);box-shadow:var(--shadow-lg);color:var(--text-main);border-radius:var(--radius-md);padding:12px 34px 12px 14px;font-family:'Inter',sans-serif;font-weight:600;font-size:13px;opacity:0;transform:translateY(-10px);transition:opacity .22s ease,transform .22s ease;overflow:hidden;position:relative} .__nc_toast.__on{opacity:1;transform:translateY(0)} .__nc_toast_x{position:absolute;top:10px;right:10px;width:20px;height:20px;border-radius:10px;background:transparent;border:none;color:var(--text-muted);cursor:pointer;font-weight:bold} .__nc_toast_x:hover{color:var(--text-main);background:var(--border)} .__nc_toast_bar{position:absolute;left:0;bottom:0;height:3px;width:100%;background:linear-gradient(90deg,var(--accent),#0ea5e9);transform-origin:left} @keyframes __nc_toast_bar_anim{to{transform:scaleX(0)}}";
        document.head.appendChild(st);
    }
    let box=qs(".__nc_toast_box");
    if(!box){box=document.createElement("div");box.className="__nc_toast_box";document.body.appendChild(box);}
    const el=document.createElement("div");
    el.className="__nc_toast";
    const durMs=Math.max(500,Number(window.__TOAST_MS)||5000);
    const barStyle="animation:__nc_toast_bar_anim "+durMs+"ms linear forwards";
    const _escT=s=>String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    el.innerHTML='<div>'+_escT(msg)+'</div><button class="__nc_toast_x"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button><div class="__nc_toast_bar" style="'+barStyle+'"></div>';
    // SUAVIZAÇÃO (ajuste solicitado): "rm" chamava el.remove() imediatamente
    // — o toast tinha transition de opacity/transform declarada no CSS, mas
    // nunca chegava a tocar, porque o elemento saía da árvore de renderização
    // no mesmo instante em que a classe "__on" seria removida. Agora primeiro
    // dispara o fade/slide de saída (remove "__on") e só remove o elemento
    // do DOM depois que a transição termina (220ms = duração declarada no
    // CSS acima). Guarda contra dupla execução: "rm" é chamada tanto pelo
    // botão de fechar quanto pelo setTimeout de duração — sem a guarda, um
    // clique manual antes do tempo expirar agendaria a remoção duas vezes.
    let _rmChamado = false;
    const rm=()=>{
        if(_rmChamado || !el.isConnected)return;
        _rmChamado = true;
        el.classList.remove("__on");
        setTimeout(()=>{ try{el.remove();}catch(_){} __ncToastMsgs.delete(msg); }, 220);
    };
    el.querySelector("button").addEventListener("click",rm);
    box.appendChild(el);
    requestAnimationFrame(()=>el.classList.add("__on"));
    setTimeout(rm,durMs);
};
const toast=(titulo,desc)=>{ showToast(titulo&&desc?(titulo+" — "+desc):(titulo||desc)); };

const limparItensVisuais=it=>{
    const s=String(it||"");
    if(!s)return"";
    const linhas=s.split(/\n+/g).map(p=>String(p||"").trim()).filter(Boolean);
    const lim=[];
    for(let p of linhas){
        p=p.replace(/^⤷\s*/,"").replace(/^╰┈/,"").trim();
        let linha=p.replace(/^\s+/,"");
        const mm=linha.match(/^(\d+[\d,]*x)\s*(.*)$/i);
        if(mm)linha=(mm[1]+" "+(mm[2]||"")).trim();
        const base=normP(linha.replace(/^\d+[\d,]*x\s*/i,"").trim());
        if(PROIB_FIXOS_N.has(base))continue;
        lim.push("⤷ "+linha);
    }
    return lim.join("\n");
};

const numQtd=s=>{
    s=String(s||"").trim().replace(/\s+/g,"").replace(/\./g,"").replace(",",".");
    const n=Number(s);
    return Number.isFinite(n)?n:0;
};
const fmtQtdUI=n=>{
    const v=Number(n||0);
    if(!Number.isFinite(v)||v<=0)return"1";
    const r=Math.round(v);
    if(Math.abs(v-r)<1e-9)return String(r);
    let s=v.toFixed(3).replace(/0+$/,"").replace(/\.$/,"");
    return s.replace(".",",");
};

const agruparItensUI=it=>{
    const t=String(limparItensVisuais(it)||"").trim();
    if(!t)return{total:0,unicos:0,itens:[]};
    const linhas=t.split(/\n+/g).map(s=>String(s||"").replace(/^⤷\s*/,"").trim()).filter(Boolean);
    let total=0;
    const mp=new Map();
    for(let l of linhas){
        if(!l||l==="…"||l==="...")continue;
        let nome=l;
        let qtd=1;
        const mm=l.match(/^(\d+(?:[.,]\d+)?)x\s*(.*)$/i);
        if(mm){
            qtd=numQtd(mm[1]);
            nome=String(mm[2]||"").trim()||nome;
            if(!qtd)qtd=1;
        }
        // GRANEL é vendido por peso/medida — conta como 1 unidade no total
        // independentemente da quantidade decimal (ex: 1,045x GRANEL conta como 1)
        const isGranel=/granel/i.test(nome);
        total += isGranel ? 1 : qtd;
        const k=normP(nome);
        if(!k)continue;
        if(!mp.has(k))mp.set(k,{nome:nome,qtd:0});
        mp.get(k).qtd+=qtd;
    }
    const itens=[...mp.values()].sort((a,b)=>a.nome.localeCompare(b.nome,"pt-BR",{sensitivity:"base"})).map(o=>({nome:o.nome,qtd:fmtQtdUI(o.qtd)+"x"}));
    return{total:fmtQtdUI(total),unicos:itens.length,itens:itens};
};

const itensMiniHTML=(it,grande)=>{
    const g=agruparItensUI(it);
    if(!g.itens.length)return"";
    let chips="";
    for(const x of g.itens)chips+='<span class="itensChip"><span class="itensQtd mono">'+esc(x.qtd)+'</span>'+esc(x.nome)+'</span>';
    return '<div class="itensMini'+(grande?' big':'')+'"><div class="itensMiniHead mono"><span class="sub">'+esc(g.total+" total • "+g.unicos+" únicos")+'</span></div><div class="itensChips">'+chips+'</div></div>';
};
const MAX_ITENS_TD = 3; // Máximo de chips visíveis na célula da tabela

// Desconto da venda (v3.5.0): mesma regra do modal de detalhes — linhas de
// item com valor negativo são desconto e o % é sobre a soma dos itens
// positivos. Linha "DESCONTO" sem valor (banco sem coluna de preço) ainda
// conta como desconto, só que sem %. null = venda sem desconto.
const _fmtPctDesc=p=>{
    if(!(p>0))return"0";
    if(p>=1)return String(Math.round(p));
    const d=Math.round(p*10)/10;
    return d>0?String(d).replace(".",","):"<0,1";
};
const descontoVenda=x=>{
    const det=(x&&Array.isArray(x.itensDetalhe)?x.itensDetalhe:[]).filter(i=>i&&!i.cancelado);
    if(!det.length)return null;
    const temValor=i=>i.total!==null&&i.total!==undefined&&Number.isFinite(Number(i.total));
    const linhas=det.filter(i=>temValor(i)?Number(i.total)<0:/\bDESCONTO\b/.test(normP(i.desc)));
    if(!linhas.length)return null;
    const somaPositiva=det.reduce((a,i)=>temValor(i)&&Number(i.total)>0?a+Number(i.total):a,0);
    const valor=linhas.reduce((a,i)=>temValor(i)?a+Math.abs(Number(i.total)):a,0);
    const pct=(somaPositiva>0&&valor>0)?valor/somaPositiva*100:null;
    // Texto completo no chip; se não couber, a própria .tdItemChip corta com "…".
    const rotulo=pct!==null?"Desconto de "+_fmtPctDesc(pct)+"% (−"+fmt(valor)+")":"Desconto";
    const tip=[];
    if(pct!==null){
        tip.push("Desconto de "+_fmtPctDesc(pct)+"% (−"+fmt(valor)+")");
        tip.push("Itens: "+fmt(somaPositiva));
        tip.push("Total com desconto: "+fmt(somaPositiva-valor));
    }else{
        tip.push("Venda com desconto (valor não registrado no banco)");
    }
    tip.push("");
    for(const i of linhas){
        const q=String(i.qtd||"").trim();
        const nome=(q&&q!=="1"?q+"x ":"")+String(i.desc||"DESCONTO").trim();
        if(temValor(i)){
            const v=Math.abs(Number(i.total));
            tip.push(nome+": −"+fmt(v)+(somaPositiva>0?" ("+_fmtPctDesc(v/somaPositiva*100)+"%)":""));
        }else tip.push(nome);
    }
    tip.push("");
    tip.push("Clique para ver todos os itens");
    return{rotulo,tip:tip.join("\n"),valor,pct};
};

const itensTdHTML=(itensRaw,venda)=>{
    const t=String(limparItensVisuais(itensRaw)||"").trim();
    const desc=descontoVenda(venda);
    // Chip de desconto: vermelho, ao passar o mouse mostra o detalhamento; o
    // clique segue para a linha (abre o modal, como os demais chips).
    const chipDesc0=desc?'<span class="tdItemChip tdItemDesc" data-tip="'+esc(desc.tip)+'">'+esc(desc.rotulo)+'</span>':'';
    // Rastro do painel Duplicatas (v3.8.7): qual documento do par foi ocultado e por quê.
    const dupN=venda&&venda._dupNota;
    const chipDup=dupN?'<span class="tdItemChip tdItemDup" data-dup="'+esc(dupN.chave)+'" data-tip="'+esc(dupN.tip)+'">'+esc(dupN.rotulo)+'</span>':'';
    const chipDesc=chipDesc0+chipDup;
    if(!t)return chipDesc?{html:'<div class="tdItemsWrap">'+chipDesc+'</div>',title:""}:{html:"",title:""};
    const linhas=t.split(/\n+/g).map(s=>String(s||"").replace(/^⤷\s*/,"").trim()).filter(Boolean);
    const tituloPartes=[];
    // Monta chips — limita a MAX_ITENS_TD visíveis, resto mostrado no modal ao clicar
    let html='<div class="tdItemsWrap">';
    const visiveis = linhas.slice(0, MAX_ITENS_TD);
    const extras   = linhas.length - visiveis.length;
    for(const l of visiveis){
        const mm=l.match(/^(\d+(?:[,.]\d+)?)x\s+(.+)$/i);
        if(mm){
            const qtd=mm[1].replace(".",",");
            const nome=String(mm[2]||"").trim();
            html+='<span class="tdItemChip"'+(nome?' data-tip="'+esc(nome)+'"':'')+'>'+
                  '<span class="tdItemQtd mono">'+esc(qtd+"x")+'</span>'+esc(nome)+'</span>';
            tituloPartes.push(qtd+"x "+nome);
        }else{
            html+='<span class="tdItemChip">'+esc(l)+'</span>';
            tituloPartes.push(l);
        }
    }
    if(extras>0){
        // Chip de ellipsis — informa que há mais itens visíveis no modal
        html+='<span class="tdItemChip tdItemMais" data-tip="'+extras+' itens adicionais — clique para ver todos">+'+extras+' mais…</span>';
    }
    html+=chipDesc;
    html+='</div>';
    return{html,title:tituloPartes.join(" • ")};
};

const semWS=s=>{
    let o="";
    for(const ch of String(s||"")){
        const c=ch.charCodeAt(0);
        if((c>32&&c!==160)||ch===","||ch==="."||ch==="-"||ch==="+"||ch==="*"||ch==="/"||ch==="?"||ch==="="||((ch>="0"&&ch<="9")))o+=ch;
    }
    return o;
};
const soNumeroBr=raw=>{
    let t=semWS(raw||"").toUpperCase();
    if(t.startsWith("R$"))t=t.slice(2);
    let x="";
    for(const ch of t)if((ch>="0"&&ch<="9")||ch===","||ch==="."||ch==="-")x+=ch;
    if(!x)return null;
    if(x.indexOf(",")>=0){ x=x.split(".").join("").replace(",","."); }
    else{ const p=x.split("."); if(p.length>1){ const l=p[p.length-1]||""; if(p.length>2||l.length===3)x=p.join(""); } }
    const n=Number(x); return Number.isFinite(n)?n:null;
};
const limparPadraoValor=p=>{ let o=""; for(const ch of semWS(p)){ if((ch>="0"&&ch<="9")||ch==="*"||ch==="/"||ch==="?"||ch===","||ch===".")o+=ch; } return o.split(".").join(""); };
const temDigito=s=>{ for(const ch of s)if(ch>="0"&&ch<="9")return true; return false; };
const consultaPareceValor=raw=>{
    const s=String(raw||"").trim();
    if(!s||s.startsWith("="))return false;
    const sx=semWS(s).toUpperCase();
    if(!sx)return false;
    if(sx.startsWith(">=")||sx.startsWith("<=")||sx.startsWith(">")||sx.startsWith("<"))return true;
    if(sx.startsWith("R$")||sx.indexOf(",")>=0)return true;
    if((sx.indexOf("*")>=0||sx.indexOf("/")>=0||sx.indexOf("?")>=0)&&temDigito(sx))return true;
    const dash=sx.indexOf("-");
    if(dash>0&&dash<sx.length-1&&temDigito(sx))return true;
    if(/^\d+$/.test(sx)&&sx[0]!=="0"&&sx.length<=4)return true;
    return false;
};

const parseBusca=raw=>{
    const s=String(raw||"").trim().replace(/\[1p\]/gi,"[proibidos]").replace(/\[-p\]/gi,"[-proibidos]");
    if(!s)return{inc:"",ign:[],proibidos:false,proibidosModo:0};
    let inc=s,ign=[],proibidos=false,proibidosModo=0,temColchetes=false,mm;
    const rx=/\[([^\]]*)\]/g;
    const pushTerm=t=>{
        t=String(t||"").trim().replace(/^"+|"+$/g,""); if(!t)return;
        const n=normP(t);
        if(n==="PROIBIDOS"){proibidos=true;proibidosModo=1;return;}
        if(n==="-PROIBIDOS"){proibidos=false;proibidosModo=2;return;}
        let modo="inc"; if(t[0]==="~"){modo="cont";t=t.slice(1).trim();}else if(t[0]==="="){modo="eq";t=t.slice(1).trim();}
        t=normP(t); if(t)ign.push({modo,t});
    };
    while((mm=rx.exec(s))){ temColchetes=true; for(const p of String(mm[1]||"").split(","))pushTerm(p); }
    const sl=s.toLowerCase(); if(sl.indexOf("[-proibidos]")>=0){proibidos=false;proibidosModo=2;}else if(sl.indexOf("[proibidos]")>=0){proibidos=true;proibidosModo=1;}
    if(temColchetes||proibidosModo)inc=inc.replace(/\[[^\]]*\]/g," ").trim();
    const m=inc.match(/^(.*)\((.*)\)\s*$/);
    if(m){ inc=String(m[1]||"").trim(); for(const p of String(m[2]||"").split(","))pushTerm(p); }
    return{inc:inc.trim(),ign,proibidos,proibidosModo};
};

const isDig=ch=>ch>="0"&&ch<="9";
const matchInicioFull=(pat,full)=>{
    const p=limparPadraoValor(pat); if(!p||!temDigito(p))return false;
    const s=String(full||""), comma=s.indexOf(",");
    const memo=new Map();
    const rec=(pi,si)=>{
        const key=pi+"|"+si; if(memo.has(key))return memo.get(key);
        if(pi>=p.length)return true; if(si>=s.length)return false;
        const ch=p[pi]; let ok=false;
        if(ch==="*"){
            let k=si; if(k<s.length&&(isDig(s[k])||s[k]===",")){ for(;k<s.length&&(isDig(s[k])||s[k]===",");k++)if(rec(pi+1,k+1)){ok=true;break;} }
        }else if(ch==="/"){
            if(!(comma>=0&&si>=comma)){ if(si<s.length&&isDig(s[si])){ let end=si; for(;end<s.length&&isDig(s[end])&&(comma<0||end<comma);end++){} for(let e=si+1;e<=end;e++)if(rec(pi+1,e)){ok=true;break;} } }
        }else if(ch==="?"){
            if(isDig(s[si])&&(comma<0||si<comma))ok=rec(pi+1,si+1);
        }else if(isDig(ch)||ch===","){
            if(s[si]===ch)ok=rec(pi+1,si+1);
        }else ok=rec(pi+1,si);
        memo.set(key,ok); return ok;
    };
    return rec(0,0);
};
const matchDentroInteiro=(pat,inteiro)=>{
    const p=limparPadraoValor(pat); if(!p||!temDigito(p))return false;
    let toks=""; for(const ch of p)if(isDig(ch)||ch==="/"||ch==="?")toks+=ch; if(!toks)return false;
    const s=String(inteiro||""); const memo=new Map();
    const rec=(pi,si)=>{
        const key=pi+"|"+si; if(memo.has(key))return memo.get(key);
        if(pi>=toks.length)return true; if(si>=s.length)return false;
        const ch=toks[pi]; let ok=false;
        if(ch==="/"){ let end=si; for(;end<s.length&&isDig(s[end]);end++){} for(let e=si+1;e<=end;e++)if(rec(pi+1,e)){ok=true;break;} }
        else if(ch==="?"){ ok=isDig(s[si])?rec(pi+1,si+1):false; }
        else{ ok=s[si]===ch?rec(pi+1,si+1):false; }
        memo.set(key,ok); return ok;
    };
    for(let start=0;start<s.length;start++)if(rec(0,start))return true;
    return false;
};

// ── GLOB TEXTUAL (busca no haystack completo, SEM âncoras) ───────────────
// * = qualquer sequência de chars em qualquer posição do texto normalizado.
// Exemplos (entrada já em normP):
//   "RACAO*"   → regex /RACAO.*/   — contém "RACAO" seguido de qq coisa
//   "*RACAO"   → regex /.*RACAO/   — contém qq coisa seguida de "RACAO"
//   "R*CAO"    → regex /R.*CAO/    — "R…CAO" em qualquer posição
//   "*RACAO*"  → regex /.*RACAO.*/ — mesmo efeito que ~RACAO (substring)
const matchGlobTxt = (pat, hay) => {
    if (!pat) return true;
    if (!hay)  return false;
    if (pat.indexOf("*") < 0) return hay.indexOf(pat) >= 0;
    const regStr = pat.split("*").map(p => escRe(p)).join(".*");
    try { return new RegExp(regStr).test(hay); } catch(e) { return false; }
};

// ── GLOB ANCORADO (^início…fim$) — para busca em campo específico ────────
// "RACAO*"   → /^RACAO.*$/ — campo começa com "RACAO"
// "*RACAO"   → /^.*RACAO$/ — campo termina com "RACAO"
// "*RACAO*"  → /^.*RACAO.*$/ — campo contém "RACAO"
const matchGlobAncorado = (pat, campo) => {
    if (!pat)   return campo === "";
    if (!campo) return pat === "*" || pat.replace(/\*/g, "") === "";
    if (pat.indexOf("*") < 0) return campo.indexOf(pat) >= 0;
    const regStr = "^" + pat.split("*").map(p => escRe(p)).join(".*") + "$";
    try { return new RegExp(regStr).test(campo); } catch(e) { return false; }
};

// ── BUSCA POR CAMPO ESPECÍFICO — sintaxe campo:valor ─────────────────────
// Aliases reconhecidos:
//   vendedor / vend    → x.vendedor
//   caixa    / cx      → x.caixa
//   numero   / num     → x.numero
//   item     / itens   → x.itens
//   cliente  / cli     → x.cliente
//   pagamento/ pag / forma → x.pagamentos
//   hora               → x.hora
//   natureza / nat     → x.natureza
//   tipo               → x.tipo  (gerencial | nfce | nfe)
// Suporta glob no valor: item:*RACAO* , vendedor:FULANO* , hora:14*
// Retorna true/false, ou null se o alias não for reconhecido (cai busca geral).
const _CAMPO_ALIAS = {
    vendedor:"vendedor", vend:"vendedor",
    caixa:"caixa",       cx:"caixa",
    numero:"numero",     num:"numero",
    item:"itens",        itens:"itens",
    cliente:"cliente",   cli:"cliente",
    pagamento:"pagamentos", pag:"pagamentos", forma:"pagamentos",
    hora:"hora",
    natureza:"natureza", nat:"natureza",
    tipo:"tipo"
};
const matchCampo = (alias, valor, x) => {
    const chave = _CAMPO_ALIAS[String(alias || "").toLowerCase()];
    if (!chave) return null; // alias desconhecido → busca geral
    const v = normP(String(valor || ""));
    const c = normP(String(x[chave] || ""));
    return matchGlobAncorado(v, c);
};

// ── SPLIT RESPEITANDO ASPAS ───────────────────────────────────────────────
// Divide pelo separador sep, mas ignora separadores dentro de "…"
// Ex: splitRespeitandoAspas('"ração gato"+vendedor:fulano', '+')
//       → ['"ração gato"', 'vendedor:fulano']
const splitRespeitandoAspas = (str, sep) => {
    const parts = []; let cur = ""; let inQ = false;
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (ch === '"') { inQ = !inQ; cur += ch; }
        else if (!inQ && ch === sep) { parts.push(cur); cur = ""; }
        else { cur += ch; }
    }
    parts.push(cur);
    return parts;
};

// ── TESTE DE TERMO ÚNICO ─────────────────────────────────────────────────
// Avalia UM termo de inclusão/exclusão contra uma venda x.
// Ordem de avaliação (da mais específica para a mais geral):
//   1. OR  ( dinheiro|pix )
//   2. Frase exata  ( "ração gato" )
//   3. Prefixo de modo  ( ~cont , =exato )
//   4. Campo específico  ( vendedor:FULANO , item:*RACAO* )
//   5. Valor numérico   ( >100 , 50-200 , 1* )
//   6. Glob textual     ( *RACAO* , RACAO* )
//   7. Exato / Contém / Token  (comportamento original)
// getHay/getToks são funções lazy para não computar quando desnecessário.
const _testTerm = (raw, x, totalNum, getHay, getToks) => {
    const it0 = String(raw || "").trim(); if (!it0) return true;

    // 1. OR — qualquer sub-termo satisfazendo = true
    if (it0.indexOf("|") >= 0) {
        return it0.split("|").map(s => s.trim()).filter(Boolean)
            .some(p => _testTerm(p, x, totalNum, getHay, getToks));
    }

    // 2. FRASE EXATA entre aspas — busca no haystack completo normalizado
    if (it0.length >= 2 && it0[0] === '"' && it0[it0.length - 1] === '"') {
        const frase = normP(it0.slice(1, -1));
        if (!frase) return true;
        return getHay().indexOf(frase) >= 0;
    }

    // 3. Prefixo de modo: ~ = contém (substring), = = exato
    let modo = "tok", it = it0;
    if (it[0] === "~") { modo = "cont"; it = it.slice(1).trim(); }
    else if (it[0] === "=") { modo = "eq";   it = it.slice(1).trim(); }
    if (!it) return true;

    // 4. CAMPO:VALOR — ex: vendedor:FULANO, item:*RACAO*, hora:14, cx:001
    const cIdx = it.indexOf(":");
    if (cIdx > 0 && cIdx < it.length - 1 && /^[a-zA-Z]+$/.test(it.slice(0, cIdx))) {
        const r = matchCampo(it.slice(0, cIdx), it.slice(cIdx + 1).trim(), x);
        if (r !== null) return r; // null = alias desconhecido → cai para etapas abaixo
    }

    // 5. VALOR NUMÉRICO (operadores >, <, >=, <=, R$, intervalo, coringa numérico)
    if (consultaPareceValor(it)) return valorOk(it, totalNum) === true;

    // 6. TEXTO — normaliza para comparação
    const term = normP(it); if (!term) return true;

    // 6a. GLOB TEXTUAL — * em termo não-numérico (ex: RACAO*, *CAO, R*CAO)
    if (term.indexOf("*") >= 0) return matchGlobTxt(term, getHay());

    // 7. EXATO (=), CONTÉM (~), TOKEN (padrão)
    if (modo === "eq") {
        const hay = getHay(); const toks = getToks();
        return hay === term || toks.includes(term)
            || normP(x.vendedor   || "") === term
            || normP(x.pagamentos || "") === term
            || normP(x.caixa      || "") === term
            || normP(x.numero     || "") === term
            || normP(String(x.total || "")) === term
            || normP(String(x.itens || "")) === term;
    }
    if (modo === "cont") return getHay().indexOf(term) >= 0;
    return getToks().includes(term); // tok padrão
};

const valorOk=(q,total)=>{
    if(!Number.isFinite(total))return null;
    const raw=String(q||"").trim(); if(!raw)return null;
    const sx=semWS(raw).toUpperCase(); if(!sx||sx.startsWith("="))return null;
    const temCoringa=(sx.indexOf("*")>=0||sx.indexOf("/")>=0||sx.indexOf("?")>=0)&&temDigito(sx);
    const tStr=fmtCopia(total); const full=tStr, inteiro=full.split(",")[0]||full;
    if(temCoringa){
        const partes=sx.split("+").map(p=>p.trim()).filter(Boolean);
        for(const p of partes){
            if(p.indexOf("*")>=0){ if(matchInicioFull(p,full))return true; }
            else{ if(matchDentroInteiro(p,inteiro))return true; }
        }
        return false;
    }
    if(!temDigito(sx))return null;
    const ops=[">=","<=",">","<"];
    for(const op of ops)if(sx.startsWith(op)){
        const n=soNumeroBr(sx.slice(op.length)); if(n===null)return null;
        if(op===">")return total>n; if(op==="<")return total<n;
        if(op===">=")return total>=n; return total<=n;
    }
    const dash=sx.indexOf("-");
    if(dash>0&&dash<sx.length-1){
        const a=soNumeroBr(sx.slice(0,dash)), b=soNumeroBr(sx.slice(dash+1));
        if(a===null||b===null)return null;
        return total>=Math.min(a,b)&&total<=Math.max(a,b);
    }
    let qv=sx.startsWith("R$")?sx.slice(2):sx;
    qv=qv.replace(/[.,]/g,""); const tv=tStr.replace(/[.,]/g,"");
    if(!qv)return null; return tv.indexOf(qv)>=0;
};

const parseSomaQuery=raw=>{
    const s=semWS(String(raw||""));
    if(!s.startsWith("=")&&!s.match(/^(>=?)\d/))return null;
    // Suporta =ALVO>MIN ou =ALVO>=MIN: soma exata alvo com filtro mínimo por venda
    const mComMin=s.match(/^=([0-9,.]+)(>=?)([0-9,.]+)$/);
    if(mComMin){
        const alvo=soNumeroBr(mComMin[1]); if(alvo===null)return null;
        const minVal=soNumeroBr(mComMin[3]); if(minVal===null)return null;
        return{alvo, tol:0, minPorVenda:minVal, minOp:mComMin[2]};
    }
    // Suporta >MIN=ALVO ou >=MIN=ALVO (ordem invertida — equivalente ao anterior)
    // Ex: ">50=1200" → minPorVenda=50, alvo=1200
    const mMinFirst=s.match(/^(>=?)(\d[0-9,.]*)=(\d[0-9,.]*)$/);
    if(mMinFirst){
        const minVal=soNumeroBr(mMinFirst[2]); if(minVal===null)return null;
        const alvo=soNumeroBr(mMinFirst[3]);   if(alvo===null)return null;
        return{alvo, tol:0, minPorVenda:minVal, minOp:mMinFirst[1]};
    }
    if(!s.startsWith("="))return null;
    const body=s.slice(1); if(!body||body==="*")return null;
    const parts=body.split("*");
    const alvo=soNumeroBr(parts[0]); if(alvo===null)return null;
    const tol=parts.length>1?(soNumeroBr(parts[1])??0):0;
    return{alvo,tol,minPorVenda:null,minOp:null};
};

let vendAtual="",vendFiltro="",qAtual="",qInc="",tipoBusca="todos",linhaAtual=null,somaSel=null,somaKey="";
const tipoLinhaOk=x=>{
    if(tipoBusca==="todos")return true;
    const m=Number(x&&x.modelo||0);
    if(tipoBusca==="gerencial")return m===99;
    if(tipoBusca==="nfce")    return m===65;
    if(tipoBusca==="nfe")     return m===55;
    return true;
};
const vendaTemProibido=x=>{
    // NF-e (modelo 55) não participa do filtro de proibidos — é documento fiscal diferente
    if(Number(x&&x.modelo||0)===55) return false;
    const total=Number(x&&x.total||0);
    if(reProibidos&&reProibidos.test(String(x?.itens||"")))return true;
    if(_proibValores.length){
        for(const expr of _proibValores){if(_valorBateProib(expr,total))return true;}
    }
    return false;
};

const calcSomaSel=()=>{
    const p=parseSomaQuery(qInc||qAtual);
    if(!p){somaSel=null;somaKey="";return;}
    const key=(vendAtual||"")+"|"+p.alvo+"|"+p.tol+"|"+(p.minPorVenda||"");
    if(key===somaKey&&somaSel)return;
    somaKey=key;
    const itens=[];
    for(let i=0;i<DADOS.vendas.length;i++){
        const x=DADOS.vendas[i];
        if(!tipoLinhaOk(x)||(vendAtual&&x.vendedor!==vendAtual))continue;
        const v=Number(x.total||0); if(!Number.isFinite(v)||v<=0)continue;
        // Filtra por valor mínimo por venda quando especificado (ex: =2200>150)
        if(p.minPorVenda!==null){
            const op=p.minOp||">";
            if(op===">="&&v<p.minPorVenda)continue;
            if(op===">"&&v<=p.minPorVenda)continue;
        }
        itens.push({i,v});
    }
    itens.sort((a,b)=>b.v-a.v);
    const sel=new Set(); let soma=0;
    const ex=itens.find(it=>Math.abs(it.v-p.alvo)<0.005);
    if(ex){sel.add(ex.i);soma=ex.v;}
    else{ const lim=p.alvo+p.tol+0.005; for(const it of itens)if(soma+it.v<=lim){soma+=it.v;sel.add(it.i);} }
    somaSel={alvo:p.alvo,tol:p.tol,soma,sel};
};

// _construirCtxFiltro — monta o contexto de filtro UMA vez por busca.
// ANTES: renderTabela() e passaFiltro() duplicavam a montagem do objeto ctx
// (DRY), e passaFiltroFast() reprocessava _qs/_ehSoma/parts/incParts/excParts
// a CADA item da tabela — mas esses valores dependem só da query atual (ctx.q),
// não do item — ou seja, para um dia com 3000 vendas e uma busca com "+"/OR/
// campo:, o MESMO parsing de texto rodava 3000 vezes seguidas produzindo
// sempre o mesmo resultado. Hoisting: computa uma vez aqui, reusa por item.
const _construirCtxFiltro = (rawQuery, vend) => {
    const p = parseBusca(rawQuery);
    const q = String(p.inc || "").trim();
    const ctx = {
        tipoOk: tipoLinhaOk,
        vend: vend,
        pm: p.proibidosModo || 0,
        ign: p.ign || [],
        q,
        ehSoma: false,
        incParts: [],
        excParts: []
    };
    if (!q) return ctx;

    // ── Detecta query de soma/combinação (=VALOR , =VALOR*TOL , >MIN=ALVO) ──
    const _qs = semWS(q);
    ctx.ehSoma = _qs.startsWith("=")
        || (/^>=?\d/.test(_qs) && _qs.indexOf("=") > 0)
        || /^>=?[\d,.]+=[\d]/.test(_qs);
    if (ctx.ehSoma) return ctx; // soma não usa incParts/excParts

    // ── Divide por + respeitando "frases entre aspas" ────────────────────
    const parts = splitRespeitandoAspas(q, "+").map(v => String(v || "").trim()).filter(Boolean);
    const incParts = [], excParts = [];
    for (const part of parts) {
        if (part[0] === "-" && part.length > 1) {
            // Exclusão explícita: -termo
            excParts.push(part.slice(1).trim());
        } else {
            // Verifica inline "-" separador de exclusão (ex: "dinheiro-cartao")
            // Ignora "-" dentro de aspas e antes de dígito (operadores numéricos)
            let splitIdx = -1;
            let inQ2 = false;
            for (let ci = 1; ci < part.length; ci++) {
                if (part[ci] === '"') { inQ2 = !inQ2; continue; }
                if (!inQ2 && part[ci] === "-" && !/\d/.test(part[ci + 1] || "")) {
                    splitIdx = ci; break;
                }
            }
            if (splitIdx > 0) {
                const base = part.slice(0, splitIdx).trim();
                const rest = part.slice(splitIdx + 1);
                if (base) incParts.push(base);
                for (const ex of rest.split("-").map(s => s.trim()).filter(Boolean)) excParts.push(ex);
            } else {
                incParts.push(part);
            }
        }
    }
    ctx.incParts = incParts;
    ctx.excParts = excParts;
    return ctx;
};

const passaFiltroFast = (x, i, ctx) => {
    if (!ctx.tipoOk(x)) return false;
    if (ctx.vend && x.vendedor !== ctx.vend) return false;
    const pm = ctx.pm;
    if (pm !== 0 && Number(x && x.modelo || 0) === 55) return false;
    if (pm === 1 && vendaTemProibido(x)) return false;
    if (pm === 2 && !vendaTemProibido(x)) return false;

    const totalNum = Number(x.total || 0);
    // Lazy — só computa hayN e toks quando algum caminho precisar
    let _hay = "", _toks = null;
    const getHay  = () => { if (!_hay)  _hay  = normP(x._busca + " " + String(x.total || "")); return _hay; };
    const getToks = () => { if (!_toks) _toks = getHay().split(" ").filter(Boolean); return _toks; };

    // ── Exclusões de colchetes [a,~b,=c] ─────────────────────────────────
    const ign = ctx.ign;
    if (ign.length) {
        for (const o of ign) {
            const term = normP(o?.t || ""); if (!term) continue;
            if (o.modo === "eq") {
                if (getHay() === term || getToks().includes(term)
                    || normP(x.vendedor||"") === term || normP(x.pagamentos||"") === term
                    || normP(x.caixa||"")   === term || normP(x.numero||"")    === term
                    || normP(String(x.total||"")) === term || normP(String(x.itens||"")) === term
                ) return false;
            } else if (o.modo === "cont") {
                if (getHay().indexOf(term) >= 0) return false;
            } else {
                if (getToks().includes(term)) return false;
            }
        }
    }

    if (!ctx.q) return true;

    // ── Query de soma/combinação já identificada em _construirCtxFiltro ──
    if (ctx.ehSoma) return !!(somaSel && somaSel.sel && somaSel.sel.has(i));

    // ── incParts/excParts já divididos em _construirCtxFiltro (uma vez
    // por busca, não por item) ────────────────────────────────────────────
    const incParts = ctx.incParts, excParts = ctx.excParts;

    // ── Avalia exclusões: qualquer exclusão que bater → rejeita a venda ──
    if (excParts.length) {
        for (const ex of excParts) {
            if (_testTerm(ex, x, totalNum, getHay, getToks) === true) return false;
        }
    }
    if (!incParts.length) return true;

    // ── Fast path: único termo sem features especiais ─────────────────────
    if (incParts.length === 1) {
        const q1 = String(incParts[0] || "").trim();
        // Atalho histórico "caixa NNN"
        if (/^caixa\s*\d{1,3}$/i.test(q1)) {
            const cx = q1.match(/^caixa\s*(\d{1,3})$/i);
            return cx ? String(x.caixa||"").padStart(3,"0") === String(cx[1]).padStart(3,"0") : false;
        }
        // Verifica se o termo usa features novas: OR, campo:, glob*, "frase"
        const cIdxFP = q1.indexOf(":");
        const temFeatureNova =
            q1.indexOf("|") >= 0 ||
            (cIdxFP > 0 && /^[a-zA-Z]+$/.test(q1.slice(0, cIdxFP)) && !!_CAMPO_ALIAS[q1.slice(0, cIdxFP).toLowerCase()]) ||
            (q1.indexOf("*") >= 0 && !consultaPareceValor(q1)) ||
            (q1.length >= 2 && q1[0] === '"' && q1[q1.length - 1] === '"');
        if (!temFeatureNova) {
            // Fast path original: busca em _busca (string normalizada de todos os campos)
            const camposTxt = x._busca;
            const ql = rmAcento(q1).toLowerCase();
            if (camposTxt.indexOf(ql) >= 0) {
                if (consultaPareceValor(q1)) {
                    // Termo parece valor numérico: exige match em campo textual OU valor
                    return rmAcento(x.vendedor||"").toLowerCase().indexOf(ql) >= 0
                        || rmAcento(x.pagamentos||"").toLowerCase().indexOf(ql) >= 0
                        || rmAcento(x.itens||"").toLowerCase().indexOf(ql) >= 0
                        || rmAcento(x.caixa||"").toLowerCase().indexOf(ql) >= 0
                        || valorOk(q1, totalNum) === true;
                }
                return true;
            }
            return valorOk(q1, totalNum) === true;
        }
    }

    // ── Multi-part (AND): TODOS os incParts devem satisfazer ─────────────
    for (const inc of incParts) {
        if (_testTerm(inc, x, totalNum, getHay, getToks) !== true) return false;
    }
    return true;
};

// passaFiltro: wrapper com contexto montado a partir do estado global.
// Usado por montarTextoCopia e filtros de copiar.
// Cache de parseBusca: evita chamar parseBusca N vezes para a mesma busca.
// Chave COMPOSTA (busca + vendedor + tipo) — não depende de nenhum call site
// lembrar de chamar _invalidarCtxCache() manualmente. BUG CORRIGIDO: a versão
// anterior invalidava só por mudança no texto de busca; trocar de vendedor
// pela lista lateral SEM alterar o texto deixava o cache com o vendedor
// ANTERIOR, e as funções de Copiar (que passam por aqui) acabavam incluindo
// vendas de outros vendedores mesmo com a tabela na tela mostrando só o
// vendedor selecionado corretamente (que usa seu próprio ctx, sem cache).
let _passaFiltroCtxCache = null, _passaFiltroKeyCache = "";
const _invalidarCtxCache = () => { _passaFiltroCtxCache = null; };
const passaFiltro = (x, i) => {
    const raw = String(qAtual || "").trim();
    const key = raw + "|" + vendAtual + "|" + tipoBusca;
    if (key !== _passaFiltroKeyCache || !_passaFiltroCtxCache) {
        _passaFiltroKeyCache = key;
        _passaFiltroCtxCache = _construirCtxFiltro(raw, vendAtual);
    }
    return passaFiltroFast(x, i, _passaFiltroCtxCache);
};

const limparPagamentoCopia=p=>String(p||"").split("|").map(s=>s.trim().replace(/^cartao(?: +|$)/i,"").trim()).filter(Boolean).join(" | ");
const formasDe=x=>limparPagamentoCopia(x.pagamentos||"").split("|").map(s=>normP(s)).filter(Boolean);
const temDinheiro=x=>formasDe(x).includes("DINHEIRO");

const montarTextoCopia=(ignorarDinheiro,ignorarProibidos)=>{
    const filtradas=DADOS.vendas.filter((x,i)=>passaFiltro(x,i)).filter(x=>(!ignorarDinheiro||!temDinheiro(x))&&(!ignorarProibidos||!vendaTemProibido(x)));
    const montarBloco=(nome,arr)=>{
        let out=nome+":\n";
        for(const x of arr)out+=String(x.numero||"")+"\t"+fmtCopia(x.total||0)+"\t"+limparPagamentoCopia(x.pagamentos||"")+"\n";
        return out.trim();
    };
    if(vendAtual)return montarBloco(vendAtual,filtradas);
    const map=new Map();
    for(const x of filtradas){ const v=x.vendedor||"(sem vendedor)"; if(!map.has(v))map.set(v,[]); map.get(v).push(x); }
    const vendes=[...map.keys()].sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));
    let out=""; for(const v of vendes)out+=montarBloco(v,map.get(v))+"\n\n";
    return out.trim();
};

const linhaCopiaItens=x=>{
    const t=String(limparItensVisuais(x?.itens)||"").trim();
    let itens="";
    if(t){
        const linhas=t.split(/\n+/g).map(s=>String(s||"").replace(/^⤷\s*/,"").trim()).filter(Boolean);
        const seen=new Set(), out=[];
        for(let l of linhas){ l=l.replace(/^\d+[\d,]*x\s*/i,"").trim(); if(!l||l==="…"||l==="...")continue; const k=normP(l); if(!k||seen.has(k))continue; seen.add(k); out.push(l); }
        itens=out.join("╰─╮");
    }
    const forma=limparPagamentoCopia(x?.pagamentos||""), parts=forma.split("|").map(s=>normP(s)).filter(Boolean);
    const extraTab=(parts.includes("DEBITO")||parts.includes("PIX")||parts.includes("DINHEIRO"))?"\t":"";
    return String(x?.numero||"")+"\t"+fmtCopia(x?.total||0)+"\t"+forma+"\t"+extraTab+(itens||"");
};

// Linha de cópia sem itens — igual a linhaCopiaItens mas omite a coluna de itens
const linhaCopiaSemItens=x=>{
    const forma=limparPagamentoCopia(x?.pagamentos||"");
    const parts=forma.split("|").map(s=>normP(s)).filter(Boolean);
    const extraTab=(parts.includes("DEBITO")||parts.includes("PIX")||parts.includes("DINHEIRO"))?"\t":"";
    return String(x?.numero||"")+"\t"+fmtCopia(x?.total||0)+"\t"+forma+"\t"+extraTab;
};

const montarTextoCopiaItens=(ignorarDinheiro,ignorarProibidos)=>{
    const filtradas=DADOS.vendas.filter((x,i)=>passaFiltro(x,i)).filter(x=>(!ignorarDinheiro||!temDinheiro(x))&&(!ignorarProibidos||!vendaTemProibido(x)));
    const montarBloco=(nome,arr)=>{ let out=nome+":\n"; for(const x of arr)out+=linhaCopiaItens(x)+"\n"; return out.trim(); };
    if(vendAtual)return montarBloco(vendAtual,filtradas);
    const map=new Map();
    for(const x of filtradas){ const v=x.vendedor||"(sem vendedor)"; if(!map.has(v))map.set(v,[]); map.get(v).push(x); }
    const vendes=[...map.keys()].sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));
    let out=""; for(const v of vendes)out+=montarBloco(v,map.get(v))+"\n\n";
    return out.trim();
};

const copiarTexto=txt=>{
    const fallback=()=>{
        const ta=document.createElement("textarea"); ta.value=txt; ta.setAttribute("readonly","");
        ta.style.cssText="position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
        document.body.appendChild(ta); if(ta.focus)ta.focus({preventScroll:true}); ta.select(); ta.setSelectionRange(0,ta.value.length);
        document.execCommand("copy"); ta.remove();
    };
    if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(txt).catch(fallback); else fallback();
};

// Cache imutável de HTML de itens por _idx (os dados nunca mudam após o load)
const _tdHtmlCache  = new Map();
const _miniHtmlCache= new Map();
// TIPO FIX (v2.6.9): passou a receber a LINHA inteira, nao so o modelo.
// Motivo: um recebimento que sobra apos CONVERTER uma gerencial em NFC-e/NF-e
// continua com modelo 99 e era rotulado "Gerencial" na tabela, mesmo tendo
// numero da faixa da NFC-e e itens "Recebimento de Titulo / Conta". Usa a
// mesma definicao de "gerencial real" que #copiarGerencial ja usava, para
// que a tabela e o botao de copiar concordem entre si.
const _tipoLabel = x => {
    const m = Number(x && x.modelo || 0);
    if (m === 65) return "NFC-e";
    if (m === 55) return "NF-e";
    return (x && x.is_recebimento) ? "Recebimento" : "Gerencial";
};
const _buildRowTb = x => {
    if(!x) return "";
    if(!_tdHtmlCache.has(x._idx)){
        const itensInfo = itensTdHTML(x.itens, x);
        _tdHtmlCache.set(x._idx, itensInfo.html);
    }
    const iHtml = _tdHtmlCache.get(x._idx);
    const clienteTxt = x.cliente || (x.hora ? String(x.hora).substring(0,5) : "");
    const clienteTitle = x.cliente || "";
    return '<tr data-idx="'+x._idx+'">'
        +'<td>'+esc(x.vendedor||"")+'</td>'
        +'<td>'+esc(_tipoLabel(x))+'</td>'
        +'<td class="mono">'+esc(x.numero||"")+'</td>'
        +'<td class="mono"'+(clienteTitle?' data-tip="'+esc(clienteTitle)+'"':'')+' style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px">'+esc(clienteTxt)+'</td>'
        +'<td class="mono">'+esc(fmt(x.total||0))+'</td>'
        +'<td class="mono">'+esc(x.pagamentos||"")+'</td>'
        +'<td>'+iHtml+'</td>'
        +'</tr>';
};
const _buildRowCard = x => {
    if(!x) return "";
    if(!_miniHtmlCache.has(x._idx)){
        _miniHtmlCache.set(x._idx, itensMiniHTML(x.itens, false));
    }
    const iMini = _miniHtmlCache.get(x._idx);
    let meta = ""; if(!vendAtual) meta = String(x.vendedor||"");
    meta += (meta?" | ":"")+_tipoLabel(x);
    if(x.cliente) meta += (meta?" | ":"")+"Cliente: "+String(x.cliente).substring(0,30)+(x.cliente.length>30?"…":"");
    else if(x.hora) meta += (meta?" | ":"")+"Hora: "+String(x.hora||"").substring(0,5);
    if(x.caixa)  meta += (meta?" | ":"")+"Caixa: "+String(x.caixa||"");
    return '<div class="cardRow" data-idx="'+x._idx+'">'
        +'<div class="cardHead"><div class="cardNum mono">#'+esc(x.numero||"")+'</div>'
        +'<div class="cardTotal mono">'+esc(fmt(x.total||0))+'</div></div>'
        +(meta?('<div class="cardMeta mono">'+esc(meta)+'</div>'):"")
        +'<div class="cardPay mono">'+esc(x.pagamentos||"")+'</div>'
        +iMini+'</div>';
};

// ── Motor de renderização assíncrona ────────────────────────────────────────
// Filtro pré-calculado por render (não por item), chunks via setTimeout(0)
// para liberar o event loop entre fatias — elimina travamento em datasets grandes.
// ────────────────────────────────────────────────────────────────────────────
let _renderGen = 0;
// Modo leve (v3.10.0): fatias menores — o navegador volta a responder entre elas
// mais vezes, sem "congelar" a tela de um aparelho fraco num relatório grande.
const _modoLeve = () => document.documentElement.getAttribute("data-perf") === "leve";
const _chunkFirst = () => _modoLeve() ? 40 : 80;  // primeira fatia — síncrona, resposta imediata
const _chunkRest  = () => _modoLeve() ? 50 : 120; // fatias seguintes — agendadas via _sched

// Scheduler: setTimeout(0) libera o event loop entre fatias (melhor que RAF para datasets grandes).
// Em Chrome 94+ usa scheduler.postTask com prioridade "background" para ainda mais eficiência.
const _sched = typeof scheduler !== "undefined" && scheduler.postTask
    ? (fn) => scheduler.postTask(fn, { priority: "background" })
    : (fn) => setTimeout(fn, 0);

// _limparTabelas/_updateCount: standalone — evita recriar closures em cada keypress.
const _limparTabelas = (tb, cards) => {
    if (tb)    tb.innerHTML = "";
    if (cards) cards.innerHTML = "";
};

const _updateCount = (total_filtradas, soma_total, completo) => {
    const _countEl = qs("#count"); if (!_countEl) return;
    const q2 = String(qAtual || "").trim();
    let txt;
    if (somaSel && q2.startsWith("=")) {
        txt = total_filtradas + " vendas ― soma " + fmt(soma_total) + " ― alvo " + fmt(somaSel.alvo) + (somaSel.tol ? (" ± " + fmt(somaSel.tol)) : "");
    } else {
        txt = total_filtradas + " vendas ― " + fmt(soma_total);
    }
    if (!completo && total_filtradas < DADOS.vendas.length) {
        const restante = DADOS.vendas.length - total_filtradas;
        txt += "  <span style='font-size:11px;opacity:.55;font-weight:400'>(" + total_filtradas + " carregadas, " + restante + " restantes\u2026)</span>";
    }
    _countEl.innerHTML = txt;
};

const renderTabela = () => {
    const tb    = qs("#tb");
    const cards = qs("#cards");

    // ── Contexto de filtro calculado UMA vez — não por item ──────────────────
    const raw = String(qAtual || "").trim();
    const ctx = _construirCtxFiltro(raw, vendAtual);

    // ── Atualiza UI de estado (vendedor, contador etc.) ──────────────────────
    const tipoTxt = tipoBusca === "gerencial" ? "Gerencial" : tipoBusca === "nfce" ? "NFC-e" : tipoBusca === "nfe" ? "NF-e" : "Todos";
    qs("#sub").textContent = (vendAtual ? ("Vendedor: " + vendAtual) : "Todos os vendedores") + " • Tipo: " + tipoTxt;
    const vtxt = vendAtual || "Todos";
    qs("#vendSel").textContent = vtxt;
    const vt = qs("#vendTopTxt"); if (vt) vt.textContent = vtxt;
    const bv = qs("#btnVend");
    if (bv) bv.setAttribute("data-tip", vendAtual ? "Filtrado: " + vendAtual : "Filtrar por vendedor");

    const gen = ++_renderGen; // cancela renders anteriores pendentes
    try { _dshAgendar(); } catch (e) {} // painel detalhado acompanha os mesmos filtros

    // ── Filtra de forma não-bloqueante: fatias de CHUNK_FIRST ────────────────
    // Para datasets pequenos (<= 2×CHUNK_FIRST) faz tudo de uma vez (síncrono).
    // Para datasets grandes, faz a primeira fatia síncrona (para o usuário ver
    // resultado imediato) e agenda o restante com setTimeout(0).
    const dados = DADOS.vendas;
    const total_itens = dados.length;

    const filtradas = [];
    let soma = 0, idx = 0;
    let hTb = "", hCards = "";
    // Fase 1 síncrona: varre todo o array até encontrar CHUNK_FIRST matches (sem limite artificial)
    const CHUNK_FIRST = _chunkFirst(), CHUNK_REST = _chunkRest();
    while (idx < total_itens && filtradas.length < CHUNK_FIRST) {
        const x = dados[idx];
        if (passaFiltroFast(x, idx, ctx)) {
            filtradas.push({ x, i: idx });
            hTb    += _buildRowTb(x);
            hCards += _buildRowCard(x);
            soma   += Number(x.total || 0);
        }
        idx++;
    }

    _limparTabelas(tb, cards);
    if (tb)    tb.innerHTML    = hTb;
    if (cards) cards.innerHTML = hCards;


    _updateCount(filtradas.length, soma, idx >= total_itens);

    // Se já varreu tudo na fase 1, finaliza
    if (idx >= total_itens) return;

    // Fase 2 — continua filtrando e appendando em fatias assíncronas
    const appendFatia = (fromIdx) => {
        if (gen !== _renderGen) return;

        let hTb2 = "", hCards2 = "", added = 0;
        let i2 = fromIdx;
        while (i2 < total_itens && added < CHUNK_REST) {
            const x = dados[i2];
            if (passaFiltroFast(x, i2, ctx)) {
                filtradas.push({ x, i: i2 });
                hTb2    += _buildRowTb(x);
                hCards2 += _buildRowCard(x);
                soma    += Number(x.total || 0);
                added++;
            }
            i2++;
        }

        if (added > 0) {
            if (tb)    tb.insertAdjacentHTML("beforeend", hTb2);
            if (cards) cards.insertAdjacentHTML("beforeend", hCards2);
        }

        _updateCount(filtradas.length, soma, i2 >= total_itens);

        if (i2 < total_itens) _sched(() => appendFatia(i2));
    };

    _sched(() => appendFatia(idx));
};

const atualizarSelecaoVendedores=()=>{
    const listaEl = qs("#lista"); if (!listaEl) return;
    listaEl.querySelectorAll('.item').forEach(el => {
        const nome = el.querySelector('.nome')?.textContent;
        if((!vendAtual && nome === "Todos") || (vendAtual && nome === vendAtual)) el.classList.add('sel');
        else el.classList.remove('sel');
    });
};

const renderLista=()=>{
    const base=DADOS.vendas.filter(tipoLinhaOk);
    const porVend=new Map();
    let qtdBase=0,totalBase=0;
    for(const x of base){
        const nome=String(x&&x.vendedor||"").trim()||"(sem vendedor)";
        if(!porVend.has(nome))porVend.set(nome,{vendedor:nome,qtd:0,total:0});
        const it=porVend.get(nome);
        it.qtd++; it.total+=Number(x&&x.total||0);
        qtdBase++; totalBase+=Number(x&&x.total||0);
    }
    const vendedores=[...porVend.values()].sort((a,b)=>a.vendedor.localeCompare(b.vendedor,"pt-BR",{sensitivity:"base"}));
    const mk=(root,apos,filtro)=>{
        if(!root)return;
        root.innerHTML="";
        const f=String(filtro||"").trim().toLowerCase();
        const add=(nome,qtd,total,sel,click)=>{
            const div=document.createElement("div");
            div.className="item"+(sel?" sel":"");
            div.addEventListener("click",()=>{_movTransicao(()=>{click();if(apos)apos(); atualizarSelecaoVendedores();});});
            div.innerHTML='<div class="nome">'+esc(nome)+'</div><div class="meta"><div class="qtd">Vendas: '+qtd+'</div><div class="tot">'+esc(fmt(total))+'</div></div>';
            root.appendChild(div);
        };
        add("Todos",qtdBase,totalBase,!vendAtual,()=>{vendAtual="";_invalidarCtxCache();calcSomaSel();renderTabela();});
        for(const v of vendedores){
            if(f&&rmAcento(String(v.vendedor||"")).toLowerCase().indexOf(rmAcento(f))<0)continue;
            add(v.vendedor,v.qtd,v.total,vendAtual===v.vendedor,()=>{vendAtual=v.vendedor;_invalidarCtxCache();calcSomaSel();renderTabela();});
        }
    };
    mk(qs("#lista"),null,"");
    mk(qs("#listaVend"),fecharVendedores,vendFiltro);
};

const renderResumoVend=()=>{
    const el=qs("#vendResumo"); if(!el)return;
    let head=el.querySelector(".sb-head");
    if(!head){ head=document.createElement("div"); head.className="sb-head"; head.innerHTML='<div class="sb-title">Total por vendedor</div>'; el.prepend(head); }
    let body=el.querySelector(".sbResumoBody");
    if(!body){ body=document.createElement("div"); body.className="sbResumoBody"; el.appendChild(body); }
    const arr=Array.isArray(DADOS.vendTotaisDia)?DADOS.vendTotaisDia:[];
    if(!arr.length){body.innerHTML='<div style="opacity:.75;padding:6px 2px">Sem dados hoje</div>';return;}
    let h="";
    for(const x of arr){
        const nome=String(x&&x.vendedor||"").trim()||"(sem vendedor)";
        const g=Number(x&&x.gerencial||0)||0, n=Number(x&&x.nfce||0)||0, t=(Number(x&&x.geral||0)||0)|| (g+n);
        h+='<div class="rv" data-tip="Gerencial: '+esc(fmt(g))+' · NFC-e: '+esc(fmt(n))+'"><div class="n">'+esc(nome)+':</div><div class="v">'+esc(fmt(t))+'</div></div>';
    }
    body.innerHTML=h;
};
// ── MOVIMENTO (v3.12.0) — só no modo de desempenho "Completo" ───────────────
const _movLigado = () => document.documentElement.getAttribute("data-perf") === "completo" && !document.documentElement.hasAttribute("data-recarga");
// SAÍDA ANIMADA (v3.20.0): troca de conteúdo (filtro, limpar, painel) com o recurso
// nativo de transição do navegador — o conteúdo antigo sai (desliza e esmaece) enquanto
// o novo entra. Só no modo Completo; sem o recurso (navegador antigo), no Leve ou no
// recarregamento automático, a troca acontece direto, igual antes. Nunca deixa de
// executar fn (nem em erro).
const _movTransicao = (fn) => {
    if (!_movLigado() || typeof document.startViewTransition !== "function") { fn(); return; }
    let feito = false;
    const rodar = () => { if (feito) return; feito = true; fn(); };
    try { document.startViewTransition(() => { try { rodar(); } catch (e) { console.error(e); } }); }
    catch (e) { rodar(); }
};
// Onda de toque: nasce no ponto do clique e se espalha.
document.addEventListener("pointerdown", (e) => {
    if (!_movLigado() || e.button > 0) return;
    const alvo = e.target && e.target.closest ? e.target.closest(".btn, .tmPerfOp, .dshTopoBtn, .radioBusca .radio, .item") : null;
    if (!alvo) return;
    try {
        const r = alvo.getBoundingClientRect();
        const o = document.createElement("span");
        o.className = "movOnda";
        o.style.left = (e.clientX - r.left) + "px";
        o.style.top = (e.clientY - r.top) + "px";
        o.style.width = Math.max(r.width, r.height) * 2.4 + "px";
        alvo.appendChild(o);
        setTimeout(() => { try { o.remove(); } catch (er) {} }, 650);
    } catch (er) {}
}, { passive: true });
// Números contando até o valor (R$ e inteiros). Guarda o último valor de cada
// elemento: ao mudar o filtro, o número desliza do valor antigo para o novo.
const _movUltimos = new Map();
const _movLerValor = (txt) => {
    const t = String(txt || "").trim();
    if (!/^R\$\s*-?[\d.]+,\d{2}$/.test(t)) return null;
    return Number(t.replace(/[^\d,-]/g, "").replace(",", "."));
};
const _movContar = (el, chave) => {
    const final = _movLerValor(el.textContent);
    if (final === null || !Number.isFinite(final)) return;
    const ini = _movUltimos.has(chave) ? _movUltimos.get(chave) : 0;
    _movUltimos.set(chave, final);
    if (!_movLigado() || Math.abs(final - ini) < 0.005) return;
    const dur = 750, t0 = performance.now(), fim = el.textContent;
    const passo = (agora) => {
        if (!el.isConnected) return;
        const p = Math.min(1, (agora - t0) / dur), k = 1 - Math.pow(1 - p, 3);
        el.textContent = p >= 1 ? fim : fmt(ini + (final - ini) * k);
        if (p < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
};
const _movContarPainel = (el) => {
    el.querySelectorAll(".dshVal, .hudGrande, .hudAnelV, .dshLegIt .dshV").forEach((v, i) => {
        const card = v.closest(".dshCard");
        _movContar(v, "dash:" + (card ? card.getAttribute("data-k") : "") + ":" + i);
    });
};
// Total do topo conta na abertura.
setTimeout(() => { try { const t = document.getElementById("tDiaSel"); if (t) _movContar(t, "topo"); } catch (e) {} }, 120);
// Troca de tema com transição de cores.
const _movTrocaTema = () => {
    if (!_movLigado()) return;
    const h = document.documentElement;
    h.classList.add("movTema");
    clearTimeout(_movTrocaTema._t);
    _movTrocaTema._t = setTimeout(() => h.classList.remove("movTema"), 650);
};
// ── PAINEL DETALHADO (v3.11.0) ───────────────────────────────────────────────
// Indicadores e gráficos SVG feitos aqui mesmo (sem biblioteca externa — o
// relatório funciona sem internet). Acompanham os filtros da tela (vendedor,
// tipo e busca): usam exatamente as vendas que a tabela mostra. Só são
// montados com a visualização "Detalhada" ligada (menu Tema → Visualização).
const _dshVisivel = () => document.documentElement.getAttribute("data-vis") === "detalhada";
const _dshNum = v => { const n = Number(String(v == null ? "" : v).replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const _dshPct = (v, t) => t > 0 ? v / t * 100 : 0;
const _dshPctTxt = p => (p >= 10 || p === 0 ? Math.round(p) : Math.round(p * 10) / 10).toString().replace(".", ",") + "%";
const _dshCompacto = v => {
    const a = Math.abs(v);
    if (a >= 1e6) return "R$ " + (v / 1e6).toFixed(1).replace(".", ",") + " mi";
    if (a >= 1e4) return "R$ " + Math.round(v / 1e3) + " mil";
    if (a >= 1e3) return "R$ " + (v / 1e3).toFixed(1).replace(".", ",") + " mil";
    return "R$ " + Math.round(v);
};
const _DSH_TIPOS = [
    { modelo: 99, nome: "Gerencial", radio: "gerencial", cor: "var(--dsh-1)" },
    { modelo: 65, nome: "NFC-e",     radio: "nfce",      cor: "var(--dsh-2)" },
    { modelo: 55, nome: "NF-e",      radio: "nfe",       cor: "var(--dsh-3)" }
];
const _DSH_CORES = ["var(--dsh-1)", "var(--dsh-2)", "var(--dsh-3)", "var(--dsh-4)", "var(--dsh-5)", "var(--dsh-6)"];

// Anel de porcentagem (KPI).
const _dshAnel = (pct, cor, tam) => {
    const t = tam || 58, r = t / 2 - 4, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct));
    return '<svg class="dshRing" width="' + t + '" height="' + t + '" viewBox="0 0 ' + t + ' ' + t + '" aria-hidden="true">'
        + '<circle cx="' + t / 2 + '" cy="' + t / 2 + '" r="' + r + '" fill="none" stroke="var(--line-soft)" stroke-width="6"/>'
        + '<circle class="dshArco" cx="' + t / 2 + '" cy="' + t / 2 + '" r="' + r + '" fill="none" stroke="' + cor + '" stroke-width="6" stroke-linecap="round"'
        + ' stroke-dasharray="' + (c * p / 100).toFixed(2) + ' ' + c.toFixed(2) + '" transform="rotate(-90 ' + t / 2 + ' ' + t / 2 + ')"/>'
        + '<text class="dshRingTxt" x="50%" y="50%" text-anchor="middle" dominant-baseline="central">' + esc(_dshPctTxt(p)) + '</text></svg>';
};

// Curva suave (Catmull-Rom → Bézier) por uma lista de pontos.
const _dshCurva = (pts, yMin, yMax) => {
    const lim = (y) => (yMin === undefined ? y : Math.max(yMin, Math.min(yMax, y)));
    if (!pts.length) return "";
    if (pts.length === 1) return "M" + pts[0][0] + "," + pts[0][1];
    let d = "M" + pts[0][0].toFixed(1) + "," + pts[0][1].toFixed(1);
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
        const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = lim(p1[1] + (p2[1] - p0[1]) / 6);
        const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = lim(p2[1] - (p3[1] - p1[1]) / 6);
        d += " C" + c1x.toFixed(1) + "," + c1y.toFixed(1) + " " + c2x.toFixed(1) + "," + c2y.toFixed(1) + " " + p2[0].toFixed(1) + "," + p2[1].toFixed(1);
    }
    return d;
};

// Minigráfico (KPI de faturamento).
const _dshSpark = (vals) => {
    if (vals.length < 2) return "";
    const W = 200, H = 34, mx = Math.max(...vals, 1);
    const pts = vals.map((v, i) => [i * W / (vals.length - 1), H - 3 - (v / mx) * (H - 8)]);
    const linha = _dshCurva(pts, 2, H - 3);
    return '<svg class="dshSpark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">'
        + '<defs><linearGradient id="dshSpG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>'
        + '<path class="dshArea" d="' + linha + ' L' + W + ',' + H + ' L0,' + H + ' Z" fill="url(#dshSpG)"/>'
        + '<path class="dshLinha" d="' + linha + '" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>';
};

// Gráfico combinado: barras = quantidade de vendas, área/linha = faturamento.
const _dshCombo = (bk) => {
    if (!bk.length) return '<div class="dshVazio">Sem horários para montar o gráfico.</div>';
    const W = 760, H = 250, mL = 54, mR = 34, mT = 30, mB = 26, iw = W - mL - mR, ih = H - mT - mB;
    const maxV = Math.max(...bk.map(b => b.valor), 1), maxQ = Math.max(...bk.map(b => b.qtd), 1);
    const passo = iw / bk.length, bw = Math.max(4, Math.min(28, passo * 0.5));
    let g = "";
    for (let k = 0; k <= 4; k++) {
        const y = mT + ih - ih * k / 4;
        g += '<line class="dshGrade" x1="' + mL + '" x2="' + (W - mR) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '"/>'
            + '<text x="' + (mL - 6) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end">' + esc(_dshCompacto(maxV * k / 4)) + '</text>'
            + '<text x="' + (W - mR + 6) + '" y="' + (y + 3).toFixed(1) + '">' + Math.round(maxQ * k / 4) + '</text>';
    }
    let barras = "", rotulos = "";
    const salto = Math.ceil(bk.length / 14);
    const pts = bk.map((b, i) => {
        const cx = mL + passo * i + passo / 2;
        const bh = ih * b.qtd / maxQ;
        if (b.qtd > 0) barras += '<rect class="dshCol" x="' + (cx - bw / 2).toFixed(1) + '" y="' + (mT + ih - bh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="3" fill="var(--dsh-2)" fill-opacity=".38" style="animation-delay:' + (i * 25) + 'ms" data-tip="' + esc(b.rot + ": " + b.qtd + " venda(s) · " + fmt(b.valor)) + '"/>';
        if (i % salto === 0) rotulos += '<text x="' + cx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(b.rot) + '</text>';
        return [cx, mT + ih - ih * b.valor / maxV];
    });
    const linha = _dshCurva(pts, mT, mT + ih);
    let pontos = "";
    let iPico = 0; bk.forEach((b, i) => { if (b.valor > bk[iPico].valor) iPico = i; });
    pts.forEach((p, i) => { pontos += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + (i === iPico ? 5 : 3) + '" fill="var(--bg-panel)" stroke="var(--accent)" stroke-width="2" data-tip="' + esc(bk[i].rot + ": " + fmt(bk[i].valor) + " em " + bk[i].qtd + " venda(s)") + '"/>'; });
    const pp = pts[iPico], txtPico = "Pico " + _dshCompacto(bk[iPico].valor);
    const lw = txtPico.length * 6.2 + 14, lx = Math.max(mL, Math.min(W - mR - lw, pp[0] - lw / 2)), ly = Math.max(2, pp[1] - 30);
    return '<svg class="dshSvg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Faturamento e quantidade de vendas">'
        + '<defs><linearGradient id="dshArG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".38"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>'
        + g + barras
        + '<path class="dshArea" d="' + linha + ' L' + pts[pts.length - 1][0].toFixed(1) + ',' + (mT + ih) + ' L' + pts[0][0].toFixed(1) + ',' + (mT + ih) + ' Z" fill="url(#dshArG)"/>'
        + '<path class="dshLinha" d="' + linha + '" fill="none" stroke="var(--accent)" stroke-width="2.5"/>'
        + pontos + rotulos
        + (bk[iPico].valor > 0 ? '<g class="dshPico"><rect x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" width="' + lw.toFixed(1) + '" height="18" rx="4"/><text x="' + (lx + lw / 2).toFixed(1) + '" y="' + (ly + 12.5).toFixed(1) + '" text-anchor="middle">' + esc(txtPico) + '</text></g>' : '')
        + '</svg>';
};

// Rosca com legenda (tipos e formas de pagamento).
const _dshRosca = (segs, centroV, centroS) => {
    const tot = segs.reduce((a, s) => a + s.valor, 0);
    if (!(tot > 0)) return '<div class="dshVazio">Sem valores no filtro atual.</div>';
    const T = 150, r = 56, c = 2 * Math.PI * r;
    let acc = 0, arcos = "";
    segs.forEach((s) => {
        const f = s.valor / tot;
        if (f <= 0) return;
        const vis = Math.max(0, c * f - (segs.length > 1 ? 2 : 0));
        arcos += '<circle class="dshArco" cx="' + T / 2 + '" cy="' + T / 2 + '" r="' + r + '" fill="none" stroke="' + s.cor + '" stroke-width="18"'
            + ' stroke-dasharray="' + vis.toFixed(2) + ' ' + c.toFixed(2) + '" stroke-dashoffset="' + (-c * acc).toFixed(2) + '" transform="rotate(-90 ' + T / 2 + ' ' + T / 2 + ')"'
            + ' data-tip="' + esc(s.nome + ": " + fmt(s.valor) + " (" + _dshPctTxt(f * 100) + ")") + '"/>';
        acc += f;
    });
    let leg = "";
    segs.forEach(s => {
        leg += '<div class="dshLegIt"' + (s.tipo ? ' data-tipo="' + esc(s.tipo) + '" data-tip="Filtrar a tabela por ' + esc(s.nome) + '"' : '') + '>'
            + '<span class="dshDot" style="background:' + s.cor + '"></span><span class="dshNome">' + esc(s.nome) + '</span>'
            + '<span class="dshV">' + esc(fmt(s.valor)) + '</span><span class="dshP">' + esc(_dshPctTxt(_dshPct(s.valor, tot))) + '</span></div>';
    });
    return '<div class="dshRosca"><svg viewBox="0 0 ' + T + ' ' + T + '" aria-hidden="true">'
        + '<circle cx="' + T / 2 + '" cy="' + T / 2 + '" r="' + r + '" fill="none" stroke="var(--line-soft)" stroke-width="18"/>' + arcos
        + '<text class="dshRoscaV" x="50%" y="47%" text-anchor="middle">' + esc(centroV) + '</text>'
        + '<text class="dshRoscaS" x="50%" y="60%" text-anchor="middle">' + esc(centroS) + '</text></svg>'
        + '<div class="dshLeg">' + leg + '</div></div>';
};

// Barras horizontais (ranking de vendedores, produtos).
const _dshBarras = (itens, opc) => {
    if (!itens.length) return '<div class="dshVazio">' + esc((opc && opc.vazio) || "Sem dados no filtro atual.") + '</div>';
    const mx = Math.max(...itens.map(i => i.valor), 1);
    return '<div class="dshBarras">' + itens.map((it, k) =>
        '<div class="dshBarra' + (it.vend !== undefined ? ' dshClic' : '') + (it.sel ? ' dshSel' : '') + '"' + (it.vend !== undefined ? ' data-vend="' + esc(it.vend) + '"' : '') + ' data-tip="' + esc(it.tip || it.nome) + '">'
        + '<span class="dshNome">' + esc(it.nome) + '</span>'
        + '<span class="dshTrilho"><span class="dshEnch" style="display:block;width:' + Math.max(2, it.valor / mx * 100).toFixed(1) + '%;animation-delay:' + (k * 40) + 'ms;' + (it.cor ? 'background:' + it.cor : '') + '"></span></span>'
        + '<span class="dshV">' + esc(it.txt) + (it.extra ? '<small>' + esc(it.extra) + '</small>' : '') + '</span></div>'
    ).join("") + '</div>';
};

// Agrega as vendas do filtro atual.
const _dshDados = () => {
    const rows = DADOS.vendas.filter((x, i) => passaFiltro(x, i));
    const r = { rows, total: 0, qtd: rows.length, tipos: new Map(), vend: new Map(), formas: new Map(), prod: new Map(), dias: new Set(), maior: null };
    for (const x of rows) {
        const v = _dshNum(x.total);
        r.total += v;
        const m = Number(x.modelo || 0);
        const t = r.tipos.get(m) || { valor: 0, qtd: 0 }; t.valor += v; t.qtd++; r.tipos.set(m, t);
        const nv = String(x.vendedor || "").trim() || "(sem vendedor)";
        const vv = r.vend.get(nv) || { valor: 0, qtd: 0 }; vv.valor += v; vv.qtd++; r.vend.set(nv, vv);
        if (!r.maior || v > _dshNum(r.maior.total)) r.maior = x;
        if (x._dtKey) r.dias.add(x._dtKey);
        const fv = x.formasValores && typeof x.formasValores === "object" ? Object.entries(x.formasValores).filter(e => _dshNum(e[1]) > 0) : [];
        if (fv.length) { for (const [f, val] of fv) { const nf = String(f || "").trim().toUpperCase() || "OUTRAS"; r.formas.set(nf, (r.formas.get(nf) || 0) + _dshNum(val)); } }
        else if (v > 0) r.formas.set("NÃO IDENTIFICADA", (r.formas.get("NÃO IDENTIFICADA") || 0) + v);
        for (const it of (Array.isArray(x.itensDetalhe) ? x.itensDetalhe : [])) {
            if (!it || it.cancelado) continue;
            const d = String(it.desc || "").trim(); const tv = it.total === null || it.total === undefined ? null : _dshNum(it.total);
            if (!d || (tv !== null && tv < 0) || /\bDESCONTO\b|\bACR[EÉ]SCIMO\b/i.test(d)) continue;
            const p = r.prod.get(d) || { valor: 0, qtd: 0, temValor: false };
            p.qtd += _dshNum(it.qtd) || 1; if (tv !== null) { p.valor += tv; p.temValor = true; }
            r.prod.set(d, p);
        }
    }
    // Faturamento/quantidade por hora (um dia) ou por dia (período).
    const bk = [];
    if (r.dias.size > 1) {
        const mp = new Map();
        for (const x of rows) { const k = x._dtKey || "?"; const b = mp.get(k) || { valor: 0, qtd: 0 }; b.valor += _dshNum(x.total); b.qtd++; mp.set(k, b); }
        [...mp.keys()].filter(k => k !== "?").sort().forEach(k => { const p = k.split("-"); bk.push({ rot: (p[2] || "") + "/" + (p[1] || ""), valor: mp.get(k).valor, qtd: mp.get(k).qtd }); });
        r.porDia = true;
    } else {
        const hs = new Array(24).fill(null).map(() => ({ valor: 0, qtd: 0 }));
        let hMin = 24, hMax = -1;
        for (const x of rows) {
            const m = String(x.hora || "").match(/^(\d{1,2}):/); if (!m) continue;
            const h = Math.min(23, parseInt(m[1], 10)); hs[h].valor += _dshNum(x.total); hs[h].qtd++;
            hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
        }
        for (let h = hMin; h <= hMax; h++) bk.push({ rot: String(h).padStart(2, "0") + "h", valor: hs[h].valor, qtd: hs[h].qtd });
    }
    r.bk = bk;
    return r;
};

// ── Painel no estilo HUD (tema "HUD Ciano") — v3.11.0 ───────────────────────
// Mesmos dados, desenho próprio inspirado em painéis de controle futuristas:
// anéis grossos de porcentagem, barras sólidas com linhas-guia verticais, linha
// tracejada com marcadores vazados, tabela de estatísticas com faixas e
// vendedores em anéis com a porcentagem numa caixa.
const _hudAnel = (pct, tam, rot) => {
    const t = tam || 104, r = t / 2 - 8, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct));
    return '<svg class="hudAnel" width="' + t + '" height="' + t + '" viewBox="0 0 ' + t + ' ' + t + '" aria-hidden="true">'
        + '<circle cx="' + t / 2 + '" cy="' + t / 2 + '" r="' + r + '" fill="none" stroke="#dbeafe" stroke-opacity=".88" stroke-width="7"/>'
        + '<circle class="dshArco" cx="' + t / 2 + '" cy="' + t / 2 + '" r="' + r + '" fill="none" stroke="var(--accent)" stroke-width="9"'
        + ' stroke-dasharray="' + (c * p / 100).toFixed(2) + ' ' + c.toFixed(2) + '" transform="rotate(-90 ' + t / 2 + ' ' + t / 2 + ')"/>'
        + '<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" class="hudAnelTxt">' + esc(rot || _dshPctTxt(p)) + '</text></svg>';
};
const _hudBarras = (bk) => {
    if (!bk.length) return '<div class="dshVazio">Sem horários para montar o gráfico.</div>';
    const W = 760, H = 240, mL = 16, mR = 34, mT = 14, mB = 26, iw = W - mL - mR, ih = H - mT - mB;
    const maxQ = Math.max(...bk.map(b => b.qtd), 1), passo = iw / bk.length, bw = Math.max(6, Math.min(56, passo * 0.62));
    let g = "";
    for (let k = 0; k <= 3; k++) {
        const y = mT + ih - ih * k / 3;
        g += '<line x1="' + mL + '" x2="' + (W - mR) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="rgba(219,234,254,.14)"/>'
            + '<text x="' + (W - mR + 6) + '" y="' + (y + 3).toFixed(1) + '" class="hudMini">' + Math.round(maxQ * k / 3) + '</text>';
    }
    let corpo = "";
    const salto = Math.ceil(bk.length / 14);
    bk.forEach((b, i) => {
        const cx = mL + passo * i + passo / 2, bh = ih * b.qtd / maxQ;
        corpo += '<line x1="' + cx.toFixed(1) + '" x2="' + cx.toFixed(1) + '" y1="' + mT + '" y2="' + (mT + ih) + '" stroke="rgba(219,234,254,.28)"/>';
        if (b.qtd > 0) corpo += '<rect class="dshCol" x="' + (cx - bw / 2).toFixed(1) + '" y="' + (mT + ih - bh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" fill="var(--accent)" style="animation-delay:' + (i * 30) + 'ms" data-tip="' + esc(b.rot + ": " + b.qtd + " venda(s) · " + fmt(b.valor)) + '"/>';
        if (i % salto === 0) corpo += '<text x="' + cx.toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" class="hudEixo">' + esc(b.rot) + '</text>';
    });
    return '<svg class="dshSvg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Vendas por hora">' + g + corpo
        + '<line x1="' + mL + '" x2="' + (W - mR) + '" y1="' + (mT + ih) + '" y2="' + (mT + ih) + '" stroke="rgba(219,234,254,.55)"/></svg>';
};
const _hudLinha = (bk) => {
    if (bk.length < 2) return '<div class="dshVazio">Poucos horários para a linha.</div>';
    const W = 520, H = 230, mL = 44, mR = 14, mT = 18, mB = 26, iw = W - mL - mR, ih = H - mT - mB;
    let acc = 0; const acum = bk.map(b => (acc += b.valor));
    const mx = Math.max(acc, 1);
    let g = "";
    for (let k = 1; k <= 10; k++) {
        if (k % 2) continue;
        const y = mT + ih - ih * k / 10;
        g += '<text x="' + (mL - 8) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end" class="hudMini">' + (k * 10) + '%</text>';
    }
    const pts = acum.map((v, i) => [mL + iw * i / (bk.length - 1), mT + ih - ih * v / mx]);
    let marc = "";
    const salto = Math.ceil(bk.length / 8);
    pts.forEach((p, i) => {
        if (i % salto === 0 || i === pts.length - 1) {
            marc += '<line x1="' + p[0].toFixed(1) + '" x2="' + p[0].toFixed(1) + '" y1="' + mT + '" y2="' + (mT + ih) + '" stroke="rgba(219,234,254,.22)" stroke-dasharray="3 4"/>'
                + '<text x="' + p[0].toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" class="hudEixo">' + esc(bk[i].rot) + '</text>';
        }
        marc += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4.5" fill="#0a1626" stroke="#dbeafe" stroke-width="1.6" data-tip="' + esc("Até " + bk[i].rot + ": " + fmt(acum[i]) + " (" + _dshPctTxt(_dshPct(acum[i], mx)) + " do dia)") + '"/>';
    });
    return '<svg class="dshSvg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Faturamento acumulado">'
        + '<line x1="' + mL + '" x2="' + mL + '" y1="' + (mT - 6) + '" y2="' + (mT + ih) + '" stroke="rgba(219,234,254,.55)"/>'
        + '<line x1="' + mL + '" x2="' + (W - mR) + '" y1="' + (mT + ih) + '" y2="' + (mT + ih) + '" stroke="rgba(219,234,254,.55)"/>'
        + g + '<path class="dshLinha" d="' + pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ") + '" fill="none" stroke="#9cc6e8" stroke-width="2.6" stroke-dasharray="14 7" stroke-linecap="round"/>' + marc + '</svg>';
};
const _hudRender = (d, el) => {
    const tot = d.total, ticket = d.qtd ? tot / d.qtd : 0;
    const vendArr = [...d.vend.entries()].map(([nome, o]) => ({ nome, ...o })).sort((a, b) => b.valor - a.valor);
    const top = vendArr[0];
    let h = "";
    // Anéis de participação + resumo
    h += '<div class="dshCard dshW4 hudAneis"><div class="dshTit">Participação no faturamento</div><div class="hudAneisLin">';
    for (const tp of _DSH_TIPOS) {
        const o = d.tipos.get(tp.modelo) || { valor: 0, qtd: 0 };
        h += '<div class="hudAnelIt" data-tipo="' + tp.radio + '" data-tip="' + esc(tp.nome + ": " + fmt(o.valor) + " em " + o.qtd + " venda(s) — clique para filtrar") + '">' + _hudAnel(_dshPct(o.valor, tot)) + '<div class="hudAnelNome">' + tp.nome + '</div><div class="hudAnelV">' + esc(fmt(o.valor)) + '</div></div>';
    }
    h += '<div class="hudAnelIt" data-tip="' + esc(top ? top.nome + ": " + fmt(top.valor) : "") + '">' + _hudAnel(top ? _dshPct(top.valor, tot) : 0) + '<div class="hudAnelNome">Destaque</div><div class="hudAnelV">' + esc(top ? top.nome : "—") + '</div></div>';
    h += '</div></div>';
    h += '<div class="dshCard dshW2 hudResumo"><div class="dshTit">Estatísticas do filtro</div>'
        + '<div class="hudGrande">' + esc(fmt(tot)) + '</div><div class="hudLinhaTxt">' + d.qtd + ' venda(s) · ticket médio <b>' + esc(fmt(ticket)) + '</b></div>'
        + (d.maior ? '<div class="hudLinhaTxt">Maior venda <b>' + esc(fmt(_dshNum(d.maior.total))) + '</b> · ' + esc(_tipoLabel(d.maior) + " " + (d.maior.numero || "")) + '</div>' : '')
        + _dshSpark(d.bk.map(b => b.valor)) + '</div>';
    // Barras sólidas + tabela por hora
    h += '<div class="dshCard dshW4"><div class="dshTit">' + (d.porDia ? "Vendas por dia" : "Vendas por hora") + '<span class="dshExtra">nº de vendas</span></div>' + _hudBarras(d.bk) + '</div>';
    const linhasTab = d.bk.filter(b => b.qtd > 0).slice(-8).reverse();
    h += '<div class="dshCard dshW2"><div class="dshTit">' + (d.porDia ? "Por dia" : "Por hora") + '<span class="dshExtra">mais recentes</span></div>'
        + (linhasTab.length ? '<div class="hudTab">' + linhasTab.map(b => '<div class="hudTabLin"><span>' + esc(b.rot) + '</span><span>' + b.qtd + ' venda(s)</span><b>' + esc(fmt(b.valor)) + '</b></div>').join("") + '</div>' : '<div class="dshVazio">Sem vendas.</div>') + '</div>';
    // Linha acumulada + rosca de pagamentos + vendedores
    h += '<div class="dshCard dshW3"><div class="dshTit">Faturamento acumulado<span class="dshExtra">% do total ao longo do ' + (d.porDia ? "período" : "dia") + '</span></div>' + _hudLinha(d.bk) + '</div>';
    const formas = [...d.formas.entries()].sort((a, b) => b[1] - a[1]);
    const segs = formas.slice(0, 5).map(([n, v], i) => ({ nome: n.charAt(0) + n.slice(1).toLowerCase(), valor: v, cor: ["#22d3ee", "#7dd3fc", "#bae6fd", "#0ea5e9", "#e0f2fe"][i] }));
    if (formas.length > 5) segs.push({ nome: "Outras", valor: formas.slice(5).reduce((a, f) => a + f[1], 0), cor: "#38bdf8" });
    h += '<div class="dshCard dshW3 hudPag"><div class="dshTit">Formas de pagamento</div>' + _dshRosca(segs, _dshCompacto(formas.reduce((a, f) => a + f[1], 0)), "PAGO") + '</div>';
    h += '<div class="dshCard dshW6"><div class="dshTit">Vendedores<span class="dshExtra">clique para filtrar</span></div><div class="hudVends">'
        + (vendArr.length ? vendArr.slice(0, 8).map(v => '<div class="hudVend dshBarra' + (v.nome !== "(sem vendedor)" ? ' dshClic' : '') + (vendAtual && v.nome === vendAtual ? ' dshSel' : '') + '" data-vend="' + esc(v.nome === "(sem vendedor)" ? "" : v.nome) + '" data-tip="' + esc(v.nome + ": " + fmt(v.valor) + " em " + v.qtd + " venda(s)") + '">'
            + '<span class="hudCaixa">' + esc(_dshPctTxt(_dshPct(v.valor, tot))) + '</span>' + _hudAnel(_dshPct(v.valor, tot), 74, String(v.qtd)) + '<span class="hudVendNome">' + esc(v.nome) + '</span><span class="hudVendV">' + esc(fmt(v.valor)) + '</span></div>').join("") : '<div class="dshVazio">Sem vendedores.</div>')
        + '</div></div>';
    el.innerHTML = h;
};
// ── Minimizar / restaurar painéis (v3.11.0) ─────────────────────────────────
// Botão SVG no título de cada painel; barra no topo com "minimizar tudo". Estado
// salvo no navegador (por título do painel) — sobrevive às atualizações.
const LS_DASH_MIN = "fdb_dash_min", LS_DASH_TUDO = "fdb_dash_tudo";
const _SVG_MIN = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const _SVG_REST = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="4" y1="9" x2="20" y2="9"/></svg>';
const _dshMinLer = () => { try { const a = JSON.parse(localStorage.getItem(LS_DASH_MIN) || "[]"); return Array.isArray(a) ? a.filter(x => typeof x === "string").slice(0, 60) : []; } catch (e) { return []; } };
const _dshMinSalvar = (a) => { try { localStorage.setItem(LS_DASH_MIN, JSON.stringify(a.slice(0, 60))); } catch (e) {} };
const _dshTudoMin = () => { try { return localStorage.getItem(LS_DASH_TUDO) === "1"; } catch (e) { return false; } };
const _dshChave = (card) => {
    const t = card.querySelector(".dshTit");
    const txt = t ? (t.childNodes[0] && t.childNodes[0].nodeType === 3 ? t.childNodes[0].nodeValue : t.textContent) : "";
    return rmAcento(String(txt || "").trim().toLowerCase()).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "painel";
};
const _dshBotao = (min, rotulo) => '<button type="button" class="dshMinBtn" aria-pressed="' + (min ? "true" : "false") + '" data-tip="' + (min ? "Restaurar " : "Minimizar ") + esc(rotulo) + '" aria-label="' + (min ? "Restaurar " : "Minimizar ") + esc(rotulo) + '">' + (min ? _SVG_REST : _SVG_MIN) + '</button>';
const _dshDecorar = (el) => {
    const mins = _dshMinLer();
    const tudo = _dshTudoMin();
    el.classList.toggle("dshTudoMin", tudo);
    el.querySelectorAll(".dshCard").forEach(card => {
        const k = _dshChave(card);
        card.setAttribute("data-k", k);
        const min = mins.indexOf(k) >= 0;
        card.classList.toggle("dshMin", min);
        const tit = card.querySelector(".dshTit");
        if (tit && !tit.querySelector(".dshMinBtn")) tit.insertAdjacentHTML("beforeend", _dshBotao(min, "painel"));
    });
    const qtdMin = el.querySelectorAll(".dshCard.dshMin").length;
    el.insertAdjacentHTML("afterbegin", '<div class="dshTopo"><span class="dshTopoTit">Painel detalhado</span>'
        + (qtdMin && !tudo ? '<span class="dshTopoInfo">' + qtdMin + ' painel(is) minimizado(s)</span>' : '')
        + '<button type="button" class="dshTopoBtn" data-acao="' + (tudo ? "restaurar-tudo" : "minimizar-tudo") + '">' + (tudo ? _SVG_REST + "Restaurar painel" : _SVG_MIN + "Minimizar painel") + '</button>'
        + (qtdMin && !tudo ? '<button type="button" class="dshTopoBtn" data-acao="restaurar-cards">' + _SVG_REST + 'Restaurar todos</button>' : '')
        + '</div>');
};
const _dshMinAlternar = (card) => {
    const k = card.getAttribute("data-k"); if (!k) return;
    const mins = _dshMinLer(); const i = mins.indexOf(k);
    if (i >= 0) mins.splice(i, 1); else mins.push(k);
    _dshMinSalvar(mins);
    _dshRender();
};
document.addEventListener("click", (e) => {
    const alvo = e.target && e.target.closest ? e.target : null;
    if (!alvo || !alvo.closest("#dash")) return;
    const bMin = alvo.closest(".dshMinBtn");
    if (bMin) { e.stopPropagation(); const card = bMin.closest(".dshCard"); if (card) _movTransicao(() => _dshMinAlternar(card)); return; }
    const bTopo = alvo.closest(".dshTopoBtn");
    if (bTopo) {
        e.stopPropagation();
        const ac = bTopo.getAttribute("data-acao");
        if (ac === "minimizar-tudo") { try { localStorage.setItem(LS_DASH_TUDO, "1"); } catch (er) {} }
        else if (ac === "restaurar-tudo") { try { localStorage.removeItem(LS_DASH_TUDO); } catch (er) {} }
        else if (ac === "restaurar-cards") _dshMinSalvar([]);
        _movTransicao(() => _dshRender());
    }
}, true);
let _dshTimer = 0, _dshPrimeira = !document.documentElement.hasAttribute("data-recarga"), _dshUltChave = "";
const _dshRender = () => {
    const el = document.getElementById("dash");
    if (!el || !_dshVisivel()) return;
    let d;
    try { d = _dshDados(); } catch (e) { el.innerHTML = '<div class="dshCard dshW6"><div class="dshVazio">Não foi possível montar o painel: ' + esc(e.message) + '</div></div>'; return; }
    const _chaveFiltro = vendAtual + "|" + tipoBusca;
    if (_dshUltChave !== _chaveFiltro) { if (_dshUltChave && typeof _movLigado === "function" && _movLigado()) _dshPrimeira = true; _dshUltChave = _chaveFiltro; }
    if (document.documentElement.getAttribute("data-theme") === "hud") {
        el.classList.toggle("dshAnim", _dshPrimeira);
        _hudRender(d, el);
        _dshDecorar(el);
        try { _movContarPainel(el); } catch (e) {}
        _dshPrimeira = false;
        return;
    }
    const tot = d.total;
    const ticket = d.qtd ? tot / d.qtd : 0;
    const vendArr = [...d.vend.entries()].map(([nome, o]) => ({ nome, ...o })).sort((a, b) => b.valor - a.valor);
    const top = vendArr[0];
    const pico = d.bk.reduce((a, b) => (!a || b.valor > a.valor ? b : a), null);
    let h = "";
    // KPIs
    h += '<div class="dshCard dshKpi"><div class="dshTit">Faturamento' + (pico && pico.valor > 0 ? '<span class="dshExtra">pico ' + esc(pico.rot) + '</span>' : '') + '</div>'
        + '<div class="dshVal" data-tip="' + esc(fmt(tot)) + '">' + esc(fmt(tot)) + '</div><div class="dshSub"><b>' + d.qtd + '</b> venda(s)</div>' + _dshSpark(d.bk.map(b => b.valor)) + '</div>';
    h += '<div class="dshCard dshKpi"><div class="dshTit">Ticket médio</div><div class="dshVal">' + esc(fmt(ticket)) + '</div>'
        + (d.maior ? '<div class="dshSub" data-tip="Maior venda: ' + esc(_tipoLabel(d.maior) + " " + (d.maior.numero || "") + " · " + (d.maior.vendedor || "")) + '">Maior: <b>' + esc(fmt(_dshNum(d.maior.total))) + '</b> · ' + esc(String(d.maior.numero || "")) + '</div>' : '<div class="dshSub">—</div>') + '</div>';
    for (const tp of _DSH_TIPOS) {
        const o = d.tipos.get(tp.modelo) || { valor: 0, qtd: 0 };
        h += '<div class="dshCard dshKpi" data-tipo="' + tp.radio + '" data-tip="Filtrar a tabela por ' + tp.nome + '" style="cursor:pointer"><div class="dshTit">' + tp.nome + '</div>'
            + '<div class="dshVal">' + esc(fmt(o.valor)) + '</div>'
            + '<div class="dshKpiLin">' + _dshAnel(_dshPct(o.valor, tot), tp.cor, 46) + '<div class="dshSub"><b>' + o.qtd + '</b> venda(s)<br>do total do filtro</div></div></div>';
    }
    h += '<div class="dshCard dshKpi"><div class="dshTit">Destaque</div>'
        + (top ? '<div class="dshVal" style="font-size:clamp(13px,1.05vw,17px)" data-tip="' + esc(top.nome) + '">' + esc(top.nome) + '</div>'
            + '<div class="dshKpiLin">' + _dshAnel(_dshPct(top.valor, tot), "var(--dsh-4)", 46) + '<div class="dshSub"><b>' + esc(fmt(top.valor)) + '</b><br>' + top.qtd + ' venda(s)</div></div>' : '<div class="dshSub">—</div>') + '</div>';
    // Gráfico combinado + rosca por tipo
    h += '<div class="dshCard dshW4"><div class="dshTit">' + (d.porDia ? "Faturamento e vendas por dia" : "Faturamento e vendas por hora")
        + '<span class="dshExtra">área: faturamento · barras: nº de vendas</span></div>' + _dshCombo(d.bk) + '</div>';
    h += '<div class="dshCard dshW2"><div class="dshTit">Participação por tipo</div>'
        + _dshRosca(_DSH_TIPOS.map(tp => ({ nome: tp.nome, valor: (d.tipos.get(tp.modelo) || { valor: 0 }).valor, cor: tp.cor, tipo: tp.radio })).filter(s => s.valor > 0), _dshCompacto(tot), "TOTAL") + '</div>';
    // Ranking, formas, produtos
    h += '<div class="dshCard dshW2"><div class="dshTit">Ranking de vendedores<span class="dshExtra">clique para filtrar</span></div>'
        + _dshBarras(vendArr.slice(0, 8).map(v => ({ nome: v.nome, valor: v.valor, txt: fmt(v.valor), extra: _dshPctTxt(_dshPct(v.valor, tot)), vend: v.nome === "(sem vendedor)" ? "" : v.nome, sel: vendAtual && v.nome === vendAtual, tip: v.nome + ": " + fmt(v.valor) + " em " + v.qtd + " venda(s)" }))) + '</div>';
    const formas = [...d.formas.entries()].sort((a, b) => b[1] - a[1]);
    const formasSeg = formas.slice(0, 5).map(([n, v], i) => ({ nome: n.charAt(0) + n.slice(1).toLowerCase(), valor: v, cor: _DSH_CORES[i] }));
    if (formas.length > 5) formasSeg.push({ nome: "Outras", valor: formas.slice(5).reduce((a, f) => a + f[1], 0), cor: "var(--dsh-6)" });
    const totFormas = formas.reduce((a, f) => a + f[1], 0);
    h += '<div class="dshCard dshW2"><div class="dshTit">Formas de pagamento</div>' + _dshRosca(formasSeg, _dshCompacto(totFormas), "PAGO") + '</div>';
    const prods = [...d.prod.entries()].map(([nome, o]) => ({ nome, ...o })).sort((a, b) => (b.temValor || a.temValor ? b.valor - a.valor : 0) || b.qtd - a.qtd).slice(0, 8);
    const qtdTxt = q => (Math.round(q * 100) / 100).toString().replace(".", ",");
    h += '<div class="dshCard dshW2"><div class="dshTit">Produtos mais vendidos</div>'
        + _dshBarras(prods.map((p, i) => ({ nome: p.nome, valor: p.temValor ? p.valor : p.qtd, txt: p.temValor ? fmt(p.valor) : qtdTxt(p.qtd) + " un.", extra: p.temValor ? qtdTxt(p.qtd) + " un." : "", cor: "linear-gradient(90deg, var(--dsh-2), var(--dsh-1))", tip: p.nome + ": " + qtdTxt(p.qtd) + " un." + (p.temValor ? " · " + fmt(p.valor) : "") })), { vazio: "Sem detalhe de itens nas vendas do filtro." }) + '</div>';
    el.classList.toggle("dshAnim", _dshPrimeira);
    el.innerHTML = h;
    _dshDecorar(el);
    try { _movContarPainel(el); } catch (e) {}
    _dshPrimeira = false;
};
const _dshAgendar = () => {
    if (!_dshVisivel()) return;
    clearTimeout(_dshTimer);
    _dshTimer = setTimeout(() => { try { _dshRender(); } catch (e) {} }, 60);
};
// Cliques: vendedor do ranking filtra a tabela; tipo (KPI/legenda) marca o filtro de tipo.
document.addEventListener("click", (e) => {
    const alvo = e.target && e.target.closest ? e.target : null;
    if (!alvo || !alvo.closest("#dash")) return;
    const bv = alvo.closest(".dshBarra[data-vend]");
    if (bv) {
        const nome = bv.getAttribute("data-vend") || "";
        _movTransicao(() => {
            vendAtual = vendAtual === nome ? "" : nome;
            _invalidarCtxCache(); calcSomaSel(); renderTabela(); atualizarSelecaoVendedores();
        });
        return;
    }
    const bt = alvo.closest("[data-tipo]");
    if (bt) {
        const tp = bt.getAttribute("data-tipo");
        const rb = document.querySelector('input[name="tipoBusca"][value="' + (tipoBusca === tp ? "todos" : tp) + '"]');
        if (rb) { rb.checked = true; rb.dispatchEvent(new Event("change", { bubbles: true })); }
    }
});
// Visualização (menu Tema): "simplificada" (padrão) ou "detalhada".
const _visPref = () => document.documentElement.getAttribute("data-vis") === "detalhada" ? "detalhada" : "simplificada";
const _visEscolher = (v) => _movTransicao(() => _visAplicar(v));
const _visAplicar = (v) => {
    const val = v === "detalhada" ? "detalhada" : "simplificada";
    try { localStorage.setItem("fdb_vis", val); } catch (e) {}
    document.documentElement.setAttribute("data-vis", val);
    if (val === "detalhada") { _dshPrimeira = true; _dshRender(); }
    else { const el = document.getElementById("dash"); if (el) el.innerHTML = ""; }
    try { _visMarcarMenu(); } catch (e) {}
    try { window.dispatchEvent(new Event("resize")); } catch (e) {}
    try { toast("Visualização", val === "detalhada" ? "Detalhada — painel com gráficos acima da tabela." : "Simplificada — só a tabela."); } catch (e) {}
};
// Tamanho do texto no celular (menu Tema): 80% a 140%, de 10 em 10. Salvo no aparelho.
const ZOOM_NIVEIS = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4];
// Celular e computador guardam o tamanho separado (fdb_zoom_mob / fdb_zoom_pc).
const _zoomEhCel = () => { try { return window.matchMedia("(max-width: 680px)").matches; } catch (e) { return false; } };
const _zoomVar = () => _zoomEhCel() ? "--zoom-mob" : "--zoom-pc";
const _zoomChave = () => _zoomEhCel() ? "fdb_zoom_mob" : "fdb_zoom_pc";
const _zoomAtual = () => { const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(_zoomVar())); return ZOOM_NIVEIS.indexOf(v) >= 0 ? v : 1; };
const _zoomPasso = (dir) => {
    const i = ZOOM_NIVEIS.indexOf(_zoomAtual());
    const novo = dir === 0 ? 1 : ZOOM_NIVEIS[Math.max(0, Math.min(ZOOM_NIVEIS.length - 1, (i < 0 ? 2 : i) + (dir > 0 ? 1 : -1)))];
    const cel = _zoomEhCel(), chave = _zoomChave(), vr = _zoomVar(), h = document.documentElement.style;
    try { if (novo === 1) localStorage.removeItem(chave); else localStorage.setItem(chave, String(novo)); } catch (e) {}
    if (novo === 1) { h.removeProperty(vr); if (cel) h.removeProperty("--zoom-bar"); }
    else { h.setProperty(vr, String(novo)); if (cel) h.setProperty("--zoom-bar", String(Math.min(novo, 1.2))); }
    _zoomMarcarMenu();
    // Sem disparar "resize": o menu fica parado sob o dedo (A+ / A− várias vezes seguidas);
    // só os textos de "uma linha só" são reajustados ao novo tamanho.
    try { if (typeof window.__linhaUnica === "function") window.__linhaUnica(); } catch (e) {}
};
const _zoomMarcarMenu = () => {
    const m = document.getElementById("cfgTela"); if (!m) return;
    const z = _zoomAtual();
    const est = m.querySelector(".tmZoomEstado"); if (est) est.textContent = Math.round(z * 100) + "%";
    m.querySelectorAll(".tmZoomOp").forEach(b => {
        const d = parseInt(b.getAttribute("data-zoom"), 10) || 0;
        b.disabled = (d < 0 && z <= ZOOM_NIVEIS[0]) || (d > 0 && z >= ZOOM_NIVEIS[ZOOM_NIVEIS.length - 1]);
        if (d === 0) b.setAttribute("aria-pressed", z === 1 ? "true" : "false");
    });
};
// ── Recarregar ao detectar mudanças (v3.23.0) ──────────────────────────────
// Por aparelho (localStorage). Desligado: o script do servidor mostra "Há vendas
// novas" + Atualizar em vez de recarregar (ver window.__recargaAutoDesligada no <head>).
const _recLigada = () => !(typeof window.__recargaAutoDesligada === "function" && window.__recargaAutoDesligada());
const _recMarcarMenu = () => {
    const m = document.getElementById("cfgTela"); if (!m) return;
    const lig = _recLigada();
    const cb = m.querySelector("#tmRecAuto"); if (cb) cb.checked = lig;
    const est = m.querySelector(".tmRecEstado"); if (est) est.textContent = lig ? "Automática" : "Manual";
};
const _recEscolher = (ligar) => {
    try { localStorage.setItem("fdb_recarga_auto", ligar ? "1" : "0"); } catch (e) {}
    _recMarcarMenu();
    toast("Atualização", ligar ? "A página recarrega sozinha quando entrar venda." : "As vendas novas continuam entrando, sem recarregar a página.");
    try { if (typeof window.__srvRecargaMudou === "function") window.__srvRecargaMudou(!!ligar); } catch (e) {}
};
const _visMarcarMenu = () => {
    const m = document.getElementById("cfgTela"); if (!m) return;
    const v = _visPref();
    m.querySelectorAll(".tmVisOp").forEach(b => b.setAttribute("aria-checked", b.getAttribute("data-vis") === v ? "true" : "false"));
};
const renderTudo=()=>{
    renderTabela();
    // Sidebar e resumo são menos urgentes — adiados para não disputar o thread
    // com a renderização da tabela principal
    _sched(()=>{ renderLista(); renderResumoVend(); });
};

const abrirModal=x=>{
    linhaAtual=x;
    const tipoLabel=_tipoLabel(x);
    qs("#mTitulo").textContent=tipoLabel+" "+(x.numero||"");
    qs("#mSub").textContent="Vendedor: "+(x.vendedor||"")+(x.caixa?(" | Caixa: "+x.caixa):"")+(x.cliente?(" | Cliente: "+x.cliente):"");
    const body=qs("#mBody"); body.innerHTML="";

    // mk — cria um kv compacto; data-tip é aplicado depois via JS (só se truncar)
    const mk=(k,v,extra)=>{
        const d=document.createElement("div"); d.className="kv kvCompact";
        const _vs=String(v??"");
        // esc(k) por defesa em profundidade: hoje só recebe literais fixos
        // ("Tipo","Número" etc — nunca dado vindo do banco), mas escapar
        // sempre elimina o risco de alguém passar um valor dinâmico aqui no
        // futuro sem perceber que k não era escapado.
        d.innerHTML='<div class="k">'+esc(k)+'</div><div class="v mono'+(extra?" "+extra:"")+'" data-fullval="'+esc(_vs)+'">'+esc(_vs)+'</div>';
        return d;
    };

    // Grid 2 colunas para os campos de info da venda (Tipo, Número, Hora, Total, etc.)
    const kvGrid=document.createElement("div"); kvGrid.className="kvCompactGrid";
    kvGrid.appendChild(mk("Tipo", tipoLabel));
    kvGrid.appendChild(mk("Número", String(x.numero||"")));
    if(x.modelo===55&&x.cliente) kvGrid.appendChild(mk("Cliente", x.cliente));
    if(x.modelo===55&&x.natureza) kvGrid.appendChild(mk("Natureza", x.natureza));
    if(x.caixa) kvGrid.appendChild(mk("Caixa", String(x.caixa||"")));
    if(x.hora){
        // Hora + data do documento (ex.: "16:43 19/05/26"); sem data válida, só a hora.
        const _dtDoc=_dataCurta(x._dtKey);
        const _kvHora=mk("Hora", String(x.hora||"").substring(0,5)+(_dtDoc?" "+_dtDoc:""));
        _kvHora.classList.add("kvHora"); // no celular ocupa a linha inteira (ver CSS .kvHora)
        kvGrid.appendChild(_kvHora);
    }
    kvGrid.appendChild(mk("Total", fmt(x.total||0)));
    // Formas: se tiver valores por forma, exibe "PIX: R$ X | Dinheiro: R$ Y"
    const _fv = x.formasValores || {};
    const _fvEntries = Object.entries(_fv).filter(([,v]) => Number(v) > 0);
    const _formasStr = (_fvEntries.length > 1 && x.modelo !== 55)
        ? _fvEntries.map(([f, v]) => f + ": " + fmtN(v)).join("  |  ")
        : String(x.pagamentos || "");
    kvGrid.appendChild(mk("Formas", _formasStr));
    body.appendChild(kvGrid);

    // kv de itens: ocupa o espaço restante com scroll interno + footer fixo (full width)
    const kv=document.createElement("div"); kv.className="kv kvItens kvCompact";
    kv.innerHTML='<div class="k">Itens</div><div class="v" style="overflow:hidden;min-height:0;display:flex;flex-direction:column;gap:0;"></div>';

    const _det = (x.itensDetalhe || []).filter(i => !i.cancelado);
    if (_det.length > 0) {
        let rows = "";
        let somaFinal = 0;
        let temPreco   = false;
        // Soma apenas os itens com valor positivo — base para calcular o % de cada desconto
        const somaPositiva = _det.reduce((acc, it) =>
            (it.total !== null && Number.isFinite(it.total) && it.total > 0)
                ? acc + it.total : acc, 0);
        for (const it of _det) {
            const _isDesc = it.total !== null && it.total < 0;
            if (it.total !== null && Number.isFinite(it.total)) { somaFinal += it.total; temPreco = true; }
            // Percentual de desconto relativo ao total dos itens positivos
            const _pctStr = (_isDesc && somaPositiva > 0)
                ? ' (' + _fmtPctDesc(Math.abs(it.total) / somaPositiva * 100) + '%)'
                : '';
            const _precoCell = it.total !== null
                ? '<td class="ipreco'+(_isDesc?' desc':'')+'">'+(_isDesc?'−':'')+fmt(Math.abs(it.total))+_pctStr+'</td>'
                : '<td class="ipreco" style="color:var(--text-muted)">—</td>';
            // data-tip NÃO é definido aqui — só será adicionado via JS se o texto realmente truncar
            rows += '<tr>'
                + '<td class="iqtd">'+esc(it.qtd)+'×</td>'
                + '<td class="idesc" data-fulldesc="'+esc(it.desc)+'">'+esc(it.desc)+'</td>'
                + _precoCell
                + '</tr>';
        }

        // Scroll container para as linhas dos itens
        const scrollDiv = document.createElement("div");
        scrollDiv.className = "itensDetalheScroll";
        const tbl = document.createElement("table");
        tbl.className = "itensDetalheList";
        tbl.innerHTML = '<tbody>'+rows+'</tbody>';
        scrollDiv.appendChild(tbl);
        kv.lastChild.appendChild(scrollDiv);

        // Footer sempre visível com o total — fora do scroll
        if (temPreco) {
            const footDiv = document.createElement("div");
            footDiv.className = "itensDetalheFoot";
            footDiv.innerHTML = '<span class="ilabel">Total dos itens</span><span class="itotal mono">'+fmt(somaFinal)+'</span>';
            kv.lastChild.appendChild(footDiv);
        }
    } else {
        const fb = document.createElement("div");
        fb.style.cssText = "color:var(--text-muted);font-size:12px;padding:8px 0";
        fb.textContent = x.is_recebimento ? "Recebimento de Título / Conta" : "Sem itens registrados";
        kv.lastChild.appendChild(fb);
    }
    body.appendChild(kv);

    // Oculta botão gerencial em NF-e
    const bGer=qs("#copiarModalGer");
    if(bGer) bGer.style.display=(x.modelo===99)?"flex":"none";
    const b=qs("#copiarModal"); if(b)b.style.display="flex";
    const b2=qs("#copiarModalSemItens"); if(b2)b2.style.display="flex";
    qs("#ov").classList.add("on"); qs("#ov").setAttribute("aria-hidden","false");

    // Após o layout ser calculado: aplica data-tip SOMENTE onde o texto realmente trunca.
    // Para .idesc (nome do item) e para .v (valores do kv compacto).
    // IMPORTANTE (fix de travada ao abrir): esse loop faz leituras de layout
    // (scrollWidth/clientWidth) para CADA item da venda. Se rodasse no MESMO
    // requestAnimationFrame em que a classe "on" acabou de ser aplicada, ele
    // bloquearia justamente o frame em que o navegador ia pintar a transição
    // de abertura do modal (fade do overlay + scaleIn) — quanto mais itens a
    // venda tiver, mais perceptível a travada. Usando um SEGUNDO rAF aninhado,
    // deixamos o navegador pintar o frame de abertura primeiro (sem bloqueio)
    // e só então, um frame depois, fazemos as leituras de layout — a
    // diferença é imperceptível para quem está vendo (ninguém passa o mouse
    // em <32ms), mas elimina o travamento visual no clique.
    requestAnimationFrame(()=>{
        requestAnimationFrame(()=>{
            // Nomes de itens da tabela — truncados quando a célula é estreita demais
            body.querySelectorAll('td.idesc[data-fulldesc]').forEach(td=>{
                const full=td.getAttribute('data-fulldesc');
                td.removeAttribute('data-fulldesc');
                if(td.scrollWidth > td.clientWidth + 1){
                    td.setAttribute('data-tip', full);
                }
            });
            // Valores dos kv compactos — truncados quando o texto não cabe na célula
            body.querySelectorAll('.kv.kvCompact .v[data-fullval]').forEach(el=>{
                const full=el.getAttribute('data-fullval');
                el.removeAttribute('data-fullval');
                if(el.scrollWidth > el.clientWidth + 1){
                    el.setAttribute('data-tip', full);
                }
            });
        });
    });
};

const handleModalClick = e => {
    const el = e.target.closest('[data-idx]');
    if(!el) return;
    const idx = Number(el.getAttribute('data-idx'));
    if(DADOS.vendas[idx]) abrirModal(DADOS.vendas[idx]);
};
const tbEl = qs("#tb"); if(tbEl) tbEl.addEventListener("click", handleModalClick);
const cardsEl = qs("#cards"); if(cardsEl) cardsEl.addEventListener("click", handleModalClick);

const fecharModal=()=>{
    qs("#ov").classList.remove("on"); qs("#ov").setAttribute("aria-hidden","true");
    const b=qs("#copiarModal");if(b)b.style.display="none";const b1=qs("#copiarModalGer");if(b1)b1.style.display="none";const b2=qs("#copiarModalSemItens");if(b2)b2.style.display="none";
    linhaAtual=null;
};

const abrirAjuda=()=>{
    linhaAtual=null;
    const b=qs("#copiarModal");if(b)b.style.display="none";const b1=qs("#copiarModalGer");if(b1)b1.style.display="none";const b2=qs("#copiarModalSemItens");if(b2)b2.style.display="none";
    qs("#mTitulo").textContent="Coringas disponíveis";
    qs("#mSub").textContent="Use no campo de busca para filtrar por valor e/ou excluir termos.";
    const body=qs("#mBody"); body.innerHTML="";
    const _escM=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const add=(k,v,destaque)=>{const d=document.createElement('div');d.className='kv'+(destaque?' kvNew':'');d.innerHTML='<div class="k">'+_escM(k)+'</div><div class="v">'+_escM(v)+'</div>';body.appendChild(d);};
    const sep=(titulo)=>{const d=document.createElement('div');d.className='kv kvSep';d.innerHTML='<div class="k" style="opacity:.5;font-size:11px;letter-spacing:.06em;text-transform:uppercase">'+_escM(titulo)+'</div><div class="v"></div>';body.appendChild(d);};

    sep("Exclusão por colchetes");
    add("[proibidos] ou [1p]","Use Insert ou Caps+P para adicionar [proibidos] — oculta vendas com itens proibidos");
    add("[-proibidos] ou [-p]","Use Delete para adicionar [-proibidos] — mostra SOMENTE vendas com itens proibidos");
    add("[a,~b,=c]","Exclui termos da lista: a=token, ~b=contém (substring), =c=exato. Separe por vírgula. Ex: [granel,~entrega,=pix]");

    sep("Filtro por valor numérico");
    add("> ou >=","Maior que / Maior ou igual. Ex: >100  Ex com exclusão: >100-pix-debito");
    add("< ou <=","Menor que / Menor ou igual. Ex: <150  Ex com exclusão: <150-granel");
    add("100-200","Intervalo de valores (de 100 até 200, inclusive)");
    add("=151 ou =151*5","Combinação de vendas que somam até 151. Com tolerância: =151*5 (±5)");

    sep("Coringas numéricos (parte inteira)");
    add("*","1+ dígitos e/ou vírgula — casa do começo do valor. Ex: 15* → 15,00 / 150,00 / 1500,00");
    add("/","1+ dígitos antes da vírgula — busca dentro da parte inteira. Ex: /15/ → 115,90 / 2150,00");
    add("?","Exatamente 1 dígito na parte inteira. Ex: 1?0 → 100 / 110 / 190 (dentro do inteiro)");

    sep("Coringas textuais — NOVO");
    add("palavra*","Começa com — ex: RACAO* encontra RACAO PREMIUM, RACAO GATO etc.");
    add("*palavra","Termina com — ex: *GATO encontra RACAO GATO, ALIMENTO GATO etc.");
    add("*palavra*","Contém (equivalente a ~palavra) — ex: *RACAO* encontra qualquer item com RACAO");
    add("p*lavra","Glob livre — * casa qualquer sequência. Ex: R*CAO encontra RACAO, RAÇÃO, RAT CAO etc.");

    sep("OR entre termos — NOVO");
    add("A|B","Mostra vendas que contenham A OU B. Ex: dinheiro|pix  Ex: >100+debito|credito");
    add("A|B|C","Mais de dois. Ex: granel|entrega|desconto  (funciona em inclusão e em exclusão)");

    sep("Campo específico — NOVO");
    add("vendedor:NOME","Filtra pelo vendedor exato (ou glob). Ex: vendedor:FULANO  vend:BELTRANO*");
    add("item:PRODUTO","Filtra por item comprado. Ex: item:*RACAO*  item:GRANEL");
    add("caixa:001","Filtra pelo caixa. Aliases: cx:1  caixa:001");
    add("numero:123","Filtra pelo número do cupom/NF. Alias: num:123");
    add("cliente:NOME","Filtra pelo nome do cliente. Alias: cli:FULANO*");
    add("hora:14","Filtra pelo horário. Ex: hora:14*  hora:08  (compara no campo hora)");
    add("pag:PIX","Filtra pela forma de pagamento. Aliases: pagamento:DINHEIRO  forma:CREDITO");
    add("nat:VENDA","Filtra pela natureza da operação. Alias: natureza:*VENDA*");
    add("tipo:ger","Filtra pelo tipo de documento. Valores: ger / nfce / nfe");

    sep("Frase exata — NOVO");
    add('"ração gato"',"Busca a frase inteira no texto da venda (vendedor, itens, pagamento etc.)");
    add('"ND CAES"+>50',"Combina frase exata com outros filtros via +");

    sep("Combinações (AND via +)");
    add("+ (opcional)","Múltiplos filtros: todos devem satisfazer (AND). Ex: >50+dinheiro+-entrega");
    add("A-B-C","Inclusão A com exclusões B e C (sem +). Ex: carto-credito-debito");
    add("> ou < + exclusão","Ex: >100-pix-credito  <200-granel-gerencia-cartao");
    add("Rádio ao lado da busca","Escolha Todos, Gerencial, NFC-e ou NF-e para restringir a pesquisa ao tipo");
    qs("#ov").classList.add("on"); qs("#ov").setAttribute("aria-hidden","false");
};

const abrirVendedores=()=>{
    const ov=qs("#ovVend"); if(!ov)return;
    ov.classList.add("on"); ov.setAttribute("aria-hidden","false"); vendFiltro="";
    const q=qs("#vendQ"); if(q){q.value="";if(!window.matchMedia("(max-width:680px)").matches)q.focus();}
};
const fecharVendedores=()=>{ const ov=qs("#ovVend"); if(ov){ov.classList.remove("on"); ov.setAttribute("aria-hidden","true");} vendFiltro=""; const q=qs("#vendQ"); if(q)q.value=""; };
const abrirAcoes=()=>{ const ov=qs("#ovAcoes"); if(ov){ov.classList.add("on"); ov.setAttribute("aria-hidden","false");} };
const fecharAcoes=()=>{ const ov=qs("#ovAcoes"); if(ov){ov.classList.remove("on"); ov.setAttribute("aria-hidden","true");} };
// Mini modal "Copiar" (v3.16.0) — botão Copiar da barra do celular.
const abrirCopiar=()=>{ const ov=qs("#ovCopiar"); if(ov){ov.classList.add("on"); ov.setAttribute("aria-hidden","false");} };
const fecharCopiar=()=>{ const ov=qs("#ovCopiar"); if(ov){ov.classList.remove("on"); ov.setAttribute("aria-hidden","true");} };
// Botão Vendas (v3.16.0): rola até o início da lista de vendas (suave, salvo no modo Leve).
const irParaVendas=()=>{
    const alvo=qs(".tableWrap")||qs("#cards"); if(!alvo)return;
    const leve=document.documentElement.getAttribute("data-perf")==="leve";
    try{ alvo.scrollIntoView({behavior:leve?"auto":"smooth",block:"start"}); }catch(e){ alvo.scrollIntoView(true); }
};

// ── Importar proibidos do servidor (v3.22.1) ────────────────────────────────
// Num aparelho com lista própria: traz a lista padrão do servidor para o editor.
// "substituir" troca a lista; "juntar" acrescenta só os termos que faltam. Não
// salva sozinho — a pessoa confere e clica em Salvar.
const _BTN_IMPORTAR_PR = (id1, id2) =>
    '<div class="prImpBtns" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">'
    + '<button class="btn" type="button" id="' + id1 + '" data-tip="Troca a lista deste aparelho pela lista padrão do servidor"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Importar do servidor</button>'
    + '<button class="btn" type="button" id="' + id2 + '" data-tip="Acrescenta à lista deste aparelho os termos do servidor que ainda não estão nela"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Juntar com os do servidor</button>'
    + '</div>';
const _importarProibidosServidor = (ta, formatar, modo, botoes) => {
    if (!ta) return;
    (botoes || []).forEach(b => { if (b) b.disabled = true; });
    const liberar = () => (botoes || []).forEach(b => { if (b) b.disabled = false; });
    _fetchJSON("/api/proibidos-servidor", {cache: "no-store"}).then(d => {
        liberar();
        const srv = (d && Array.isArray(d.proibidos)) ? d.proibidos.map(s => String(s).trim()).filter(Boolean) : null;
        if (!srv) { toast("Importar do servidor", (d && d.erro) || "Não foi possível ler a lista do servidor."); return; }
        if (!srv.length) { toast("Importar do servidor", "O servidor não tem termos proibidos no padrão."); return; }
        const atual = String(ta.value || "").split("\n").map(s => s.trim()).filter(Boolean);
        let nova, novos;
        if (modo === "juntar") {
            const tem = new Set(atual.map(s => s.toLowerCase()));
            const extra = srv.filter(s => { const k = s.toLowerCase(); if (tem.has(k)) return false; tem.add(k); return true; });
            nova = atual.concat(extra); novos = extra.length;
        } else {
            nova = srv.slice(); novos = srv.filter(s => !atual.some(a => a.toLowerCase() === s.toLowerCase())).length;
        }
        if (nova.join("\n") === atual.join("\n")) { toast("Importar do servidor", "A lista já está igual à do servidor."); return; }
        ta.value = nova.join("\n");
        try { if (typeof formatar === "function") formatar(); } catch (_) {}
        toast("Importar do servidor", (modo === "juntar" ? novos + " termo(s) acrescentado(s)" : srv.length + " termo(s) importado(s)") + " — confira e clique em Salvar.");
    }).catch(e => { liberar(); toast("Importar do servidor", "Falha na conexão com o servidor" + (e && e.message ? ": " + e.message : ".")); });
};

const abrirEditorProibidos=()=>{
    // BUG MÉDIO CORRIGIDO: faltava esta guarda (os outros 2 modais dinâmicos,
    // __abrirModalPeriodo e __abrirModalConfig, já tinham). Sem ela, clicar no
    // botão várias vezes antes de fechar o modal anterior registrava um NOVO
    // listener "keydown" (Escape) no document a cada vez — como esse listener
    // só é removido quando a tecla Escape é pressionada, cliques repetidos
    // sem nunca apertar Escape acumulavam listeners indefinidamente (vazamento
    // de memória progressivo).
    if (document.getElementById("ovProib")) return;
    const bg=document.createElement("div"); bg.className="ov"; bg.id="ovProib"; bg.setAttribute("aria-hidden","false");
    const _prRemoto = !!(window.__APARELHO__ && window.__APARELHO__.servidor === false);
    bg.innerHTML='<div class="modal" role="dialog" aria-modal="true"><div class="mhead"><div><div class="mtitle">Proibidos</div><div class="msub">Um por linha — nome do produto a ocultar. Colou separado por vírgula, ponto e vírgula, tabulação ou em lista? O formato é ajustado sozinho. '+(_prRemoto?'Vale só para este aparelho.':'Salvo no servidor (config.json) — padrão de todos os aparelhos.')+'</div></div><div class="btn" id="prFechar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Fechar</div></div><div class="mbody"><textarea id="prTa" spellcheck="false" style="width:100%;height:260px;resize:vertical;border-radius:14px;border:1px solid var(--field-border);background:var(--field-bg);/*color:#e6eaf2;*/padding:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,&quot;Liberation Mono&quot;,&quot;Courier New&quot;,monospace;font-size:12px;outline:none"></textarea><div id="prCont" aria-live="polite" style="font-size:12px;color:var(--text-muted);min-height:18px;padding:4px 2px 0;line-height:1.4"></div>'+(_prRemoto?_BTN_IMPORTAR_PR("prImportar","prJuntar"):'')+'<div id="prMsg" style="font-size:12px;color:var(--text-muted);min-height:18px;padding:4px 0"></div><div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap"><div class="btn" id="prCancelar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.42"/></svg>Restaurar padrão</div><div class="btn" id="prSalvar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>Salvar</div></div></div></div>';
    document.body.appendChild(bg);
    // Fix de transição: className precisa entrar no DOM SEM "on" e ganhar a
    // classe depois (com reflow forçado no meio) — se "on" já vier junto no
    // className, o navegador nunca chega a pintar o estado opacity:0, então
    // não há "de onde" a transição partir e o overlay aparece sem fade (pop
    // instantâneo). Mesmo princípio já usado em _mostrar() para o .reveal.
    void bg.offsetWidth;
    bg.classList.add("on");
    const ta=qs("#prTa",bg);
    // Mostra entradas originais (não normalizadas) para preservar capitalização e filtros de valor
    ta.value=valoresProibidos.join("\n");
    const formatarPr=ligarEditorProibidos(ta,qs("#prCont",bg));
    const msg=qs("#prMsg",bg);
    const _prImp=qs("#prImportar",bg), _prJun=qs("#prJuntar",bg);
    if(_prImp)_prImp.addEventListener("click",()=>_importarProibidosServidor(ta,formatarPr,"substituir",[_prImp,_prJun]));
    if(_prJun)_prJun.addEventListener("click",()=>_importarProibidosServidor(ta,formatarPr,"juntar",[_prImp,_prJun]));
    // BUG FIX (auditoria v2.5.0 — LEAK): "fechar" só removia o elemento do DOM
    // (bg.remove()) mas NUNCA removia o listener "keydown" de Escape — esse
    // listener só se auto-removia quando a tecla Escape era efetivamente
    // pressionada. Fechar o modal por QUALQUER outro caminho (botão "Fechar",
    // "Salvar", ou clique fora do modal) deixava o listener permanentemente
    // registrado em document, retendo na memória a closure inteira do modal
    // (inclusive o nó "bg" já removido do DOM, que assim nunca podia ser
    // coletado pelo GC) — um vazamento a cada abertura/fechamento por esses
    // caminhos. Agora "fechar" remove o listener explicitamente, e é chamado
    // também a partir do Escape (em vez de duplicar a lógica de remoção).
    function escKey(e){ if(e.key==="Escape") fechar(); }
    const fechar=()=>{ document.removeEventListener("keydown",escKey); _fecharOverlayAnimado(bg); };
    qs("#prFechar",bg).addEventListener("click",fechar);
    qs("#prCancelar",bg).addEventListener("click",()=>{
        setProibidosUser(proibidosPadrao);
        _salvarProibidosServidor(proibidosPadrao);
        ta.value=proibidosPadrao.join("\n");
        formatarPr();
        renderTabela();
        toast("Proibidos","Restaurado padrão.");
    });
    qs("#prSalvar",bg).addEventListener("click",()=>{
        const lista=formatarPr();
        setProibidosUser(lista);
        if(msg)msg.textContent="Salvando...";
        _salvarProibidosServidor(lista, ()=>{
            if(msg)msg.textContent="Salvo!";
            setTimeout(()=>{if(msg)msg.textContent="";},2000);
        });
        fechar();
        renderTabela();
        toast("Proibidos","Lista atualizada.");
    });
    bg.addEventListener("click",e=>{if(e.target===bg)fechar();});
    document.addEventListener("keydown",escKey);
};

const _salvarProibidosServidor=(lista, cb)=>{
    _fetchJSON('/api/proibidos',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(lista)
    }).then(d=>{if(cb)cb(d);}).catch(e=>{console.error("Erro ao salvar proibidos no servidor:",e);if(cb)cb(null);});
};

// Exibe elemento com animação reveal (1 segundo)
// displayVal: valor CSS de display a aplicar (default "inline")
// Reutilizável para qualquer elemento — remove a classe após a animação para não bloquear re-trigger
const _mostrar=(el,displayVal)=>{
    if(!el)return;
    const dv=displayVal||"inline";
    if(el.style.display===dv)return; // já visível — não re-anima
    el.classList.remove("reveal");
    el.style.display=dv;
    // Força reflow para garantir que a classe seja reaplicada mesmo se o display não mudou
    void el.offsetWidth;
    el.classList.add("reveal");
    const limpar=()=>{ el.classList.remove("reveal"); el.removeEventListener("animationend",limpar); };
    el.addEventListener("animationend",limpar,{once:true});
};
const _ocultar=(el)=>{ if(!el)return; el.style.display="none"; el.classList.remove("reveal"); };

// Cabeçalho (quantidades, totais e filtros por tipo) — v3.26.0: função, roda na carga e
// a cada atualização sem recarregar.
const _atualizarCabecalho = () => {
    // Contagens reais por modelo — fonte primária e confiável para visibilidade dos badges
    const _cntGer  = DADOS.vendas.filter(x=>Number(x&&x.modelo||0)===99).length;
    const _cntNfce = DADOS.vendas.filter(x=>Number(x&&x.modelo||0)===65).length;
    const _cntNfe  = DADOS.vendas.filter(x=>Number(x&&x.modelo||0)===55).length;
    const elQG=qs("#tQtdGer");    if(elQG)   elQG.textContent  = _cntGer;
    const elQN=qs("#tQtdNfce");   if(elQN)   elQN.textContent  = _cntNfce;
    const elQNfe=qs("#tQtdNfe");  if(elQNfe) elQNfe.textContent= _cntNfe;
    const td=DADOS.totaisDia;
    {
        const b        = qs("#bDiaBrk");
        const mini     = qs("#tDiaBrkMini");
        // Badges de quantidade: exibe somente se houver vendas daquele tipo nos dados
        const badgeNfce= qs("#badgeQtdNfce");
        const badgeNfe = qs("#badgeNfe");
        const nfceMini = qs("#tDiaNfceMini");
        const nfeMini  = qs("#tDiaNfeMini");
        // Visibilidade baseada em contagem real (independente de totaisDia.ok)
        if(badgeNfce) { _cntNfce>0 ? _mostrar(badgeNfce,"inline") : _ocultar(badgeNfce); }
        if(badgeNfe)  { _cntNfe>0  ? _mostrar(badgeNfe,"inline")  : _ocultar(badgeNfe);  }
        if(nfceMini)  { _cntNfce>0 ? _mostrar(nfceMini,"inline")  : _ocultar(nfceMini);  }
        if(nfeMini)   { _cntNfe>0  ? _mostrar(nfeMini,"inline")   : _ocultar(nfeMini);   }
        if(td&&td.ok){
            qs("#tDiaSel").textContent  = fmt(td.selecionado||0);
            qs("#tDiaGer").textContent  = fmt(td.gerencial||0);
            if(qs("#tDiaNfce")) qs("#tDiaNfce").textContent = fmt(td.nfce||0);
            if(qs("#tDiaNfe"))  qs("#tDiaNfe").textContent  = fmt(td.nfe||0);
            // Só mostra o breakdown (mini) quando há mais de um tipo de documento com valor
            const _tiposComValor = [(td.gerencial||0)>0,(td.nfce||0)>0,(td.nfe||0)>0].filter(Boolean).length;
            if(mini) { _tiposComValor > 1 ? _mostrar(mini,"inline") : _ocultar(mini); }
            if(!Number(td.selecionado||0)){ _ocultar(b); } else { _mostrar(b,"inline-flex"); }
        }else{
            qs("#tDiaSel").textContent = fmt(DADOS.totais.total||0);
            if(mini) _ocultar(mini);
            if(b) _mostrar(b,"inline-flex");
        }
    }
    // Mostra/oculta radios conforme tipos presentes nos dados.
    // Se houver apenas um tipo, oculta o container inteiro (não faz sentido filtrar).
    // Se houver mais de um, exibe apenas os radios dos tipos presentes + "Todos".
    {
        const temGer  = DADOS.vendas.some(x=>Number(x&&x.modelo||0)===99);
        const temNfce = DADOS.vendas.some(x=>Number(x&&x.modelo||0)===65);
        const temNfe  = DADOS.vendas.some(x=>Number(x&&x.modelo||0)===55);
        const tiposPresentes = [temGer, temNfce, temNfe].filter(Boolean).length;
        const radioBox = qs("#radioBusca");
        const rGer   = qs("#radioLblGer");
        const rNfce  = qs("#radioLblNfce");
        const rNfe   = qs("#radioLblNfe");
        if (tiposPresentes <= 1) {
            // Apenas um tipo — esconde o seletor inteiro
            if (radioBox) _ocultar(radioBox);
        } else {
            // Múltiplos tipos — exibe o container e apenas os radios presentes
            if (radioBox) { radioBox.style.display = ""; }
            if (rGer)  temGer  ? _mostrar(rGer,"")  : _ocultar(rGer);
            if (rNfce) temNfce ? _mostrar(rNfce,"") : _ocultar(rNfce);
            if (rNfe)  temNfe  ? _mostrar(rNfe,"")  : _ocultar(rNfe);
        }
    }
};
_atualizarCabecalho();

let debounceBusca;
qs("#q").addEventListener("input",e=>{
    clearTimeout(debounceBusca);
    const n = DADOS.vendas.length;
    // Delay cresce com o volume: <200 dados=100ms, <500=200ms, <2000=300ms, ≥2000=450ms
    const delay = n > 2000 ? 450 : n > 500 ? 300 : n > 200 ? 200 : 100;
    const valor = String(e.target.value||"");
    debounceBusca = setTimeout(() => _movTransicao(() => {
        qAtual=valor.trim();
        _invalidarCtxCache();
        const p=parseBusca(qAtual); qInc=p.inc;
        calcSomaSel();
        renderTabela();
    }), delay);
});

document.querySelectorAll('input[name="tipoBusca"]').forEach(el=>el.addEventListener("change",e=>{ const _tpNovo=String(e.target&&e.target.value||"todos"); _movTransicao(()=>{
    tipoBusca=_tpNovo;
    _invalidarCtxCache();
    // Se o vendedor selecionado não existe no novo tipo, limpa a seleção
    if(tipoBusca!=="todos"&&vendAtual&&!DADOS.vendas.some(x=>tipoLinhaOk(x)&&x.vendedor===vendAtual)){
        vendAtual=""; _invalidarCtxCache(); atualizarSelecaoVendedores();
    }
    calcSomaSel(); renderTabela();
}); }));
const _fnLimpar=()=>_movTransicao(()=>{vendAtual="";qAtual="";qInc="";tipoBusca="todos";_invalidarCtxCache();qs("#q").value="";const rb=qs('input[name="tipoBusca"][value="todos"]');if(rb)rb.checked=true;calcSomaSel();renderTabela();atualizarSelecaoVendedores();_atualizarXLimpar();toast("Filtro limpo","Mostrando todos.");});
qs("#limpar").addEventListener("click",_fnLimpar);
const _btnLimTab=qs("#limparTabela");if(_btnLimTab)_btnLimTab.addEventListener("click",_fnLimpar);

// Visibilidade do ✕ dentro do input — aparece só quando há conteúdo no campo (variável string, não emoji)
const _atualizarXLimpar = () => {
    const btnX = qs("#limpar");
    const qEl  = qs("#q");
    if (!btnX || !qEl) return;
    const temConteudo = String(qEl.value || "").length > 0;
    if (temConteudo) btnX.classList.add("visivel");
    else             btnX.classList.remove("visivel");
};
qs("#q").addEventListener("input", _atualizarXLimpar);
// Estado inicial (pode haver valor pré-preenchido)
_atualizarXLimpar();
qs("#ajuda").addEventListener("click",abrirAjuda);
const btnPro=qs("#proibidos");if(btnPro)btnPro.addEventListener("click",()=>{const inp=qs("#q");if(!inp)return;let v=String(inp.value||"");if(v.toLowerCase().indexOf("[proibidos]")<0)v=(v+" [proibidos]").trim();inp.value=v;qAtual=v.trim();_invalidarCtxCache();const p=parseBusca(qAtual);qInc=p.inc;calcSomaSel();renderTabela();_atualizarXLimpar();toast("Filtro","Aplicado [proibidos].");});

qs("#copiarTudo").addEventListener("click",()=>{copiarTexto(montarTextoCopia(false,false));toast("Copiado","Conteúdo completo (com dinheiro).");});
qs("#copiarTudoItens").addEventListener("click",()=>{copiarTexto(montarTextoCopiaItens(false,false));toast("Copiado","Conteúdo completo + itens.");});
qs("#copiarSemDinheiro").addEventListener("click",()=>{copiarTexto(montarTextoCopia(true,false));toast("Copiado","Ignorando vendas com Dinheiro.");});
qs("#copiarGerencial").addEventListener("click",()=>{
    // Gerencial real: modelo 99 + número começa com 0 (padStart de gerencial) + NÃO é recebimento avulso
    const filtradas=DADOS.vendas.map((x,i)=>({x,i}))
    .filter(o=>Number(o.x&&o.x.modelo||0)===99 && !o.x.is_recebimento && String(o.x&&o.x.numero||"").startsWith("0") && passaFiltro(o.x,o.i))
    .map(o=>o.x);
    let out="";
    if(vendAtual){ out+=vendAtual+":\n"; for(const x of filtradas)out+=String(x.numero||"")+"\n"; }
    else{
        const map=new Map();
        for(const x of filtradas){ const v=x.vendedor||"(sem vendedor)"; if(!map.has(v))map.set(v,[]); map.get(v).push(x); }
        const vendes=[...map.keys()].sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));
        for(const v of vendes){ out+=v+":\n"; for(const x of map.get(v))out+=String(x.numero||"")+"\n"; out+="\n"; }
    }
    copiarTexto(out.trim()); toast("Copiado","Somente números de gerencial.");
});

qs("#editarProibidos").addEventListener("click",abrirEditorProibidos);
const PH_DESK="Buscar... Excluir: -termo (1) ou [termo,~contém,=igual,proibidos,-proibidos] (múltiplos)  |  Valor: >100, 10-20, 12*3, 12/3, 12?  |  Múltiplos: +  |  Soma: =151 ou =151*2";
const PH_MOB="Buscar... (ex: >50+CARTAO+-VENDEDOR+[-proibidos])";
const ajustarPlaceholder=()=>{const q=qs("#q");if(!q)return;q.placeholder=window.matchMedia("(max-width:680px)").matches?PH_MOB:PH_DESK;};
ajustarPlaceholder(); window.addEventListener("resize",ajustarPlaceholder);

const clicar=sel=>{const el=qs(sel);if(el)el.dispatchEvent(new MouseEvent("click",{bubbles:true}));};
const acoes=qs("#acoes");if(acoes)acoes.addEventListener("click",function(){ __abrirModalConfig(); });
// Bandeja → Dispositivos → "Configurações do aparelho..." abre /?cfgAparelho=<chave>
// no computador do servidor: abre o modal já com as preferências daquele aparelho.
(function(){
    try{
        const u=new URL(location.href), ch=u.searchParams.get("cfgAparelho");
        if(!ch)return;
        u.searchParams.delete("cfgAparelho");
        try{ history.replaceState(history.state,"",u.pathname+(u.search||"")+u.hash); }catch(_){}
        if(!/^([a-f0-9]{32}|ip:[0-9A-Za-z.:%-]{2,60})$/.test(ch))return;
        if(window.__APARELHO__&&window.__APARELHO__.servidor===false)return;
        setTimeout(()=>{ __abrirModalConfig({aparelho:ch}); },400);
    }catch(_){}
})();
const btnCel=qs("#btnCelular");if(btnCel)btnCel.addEventListener("click",function(){ __abrirModalQr(); });
const acoesFechar=qs("#acoesFechar");if(acoesFechar)acoesFechar.addEventListener("click",fecharAcoes);
const ovA=qs("#ovAcoes");if(ovA)ovA.addEventListener("click",e=>{if(e.target===ovA)fecharAcoes();});
const copiarFechar=qs("#copiarFechar");if(copiarFechar)copiarFechar.addEventListener("click",fecharCopiar);
const ovC=qs("#ovCopiar");if(ovC)ovC.addEventListener("click",e=>{if(e.target===ovC)fecharCopiar();});
const a1=qs("#aCopiarTudo");if(a1)a1.addEventListener("click",()=>{clicar("#copiarTudo");fecharCopiar();});
const a2=qs("#aCopiarTudoItens");if(a2)a2.addEventListener("click",()=>{clicar("#copiarTudoItens");fecharCopiar();});
const a3=qs("#aCopiarSemDinheiro");if(a3)a3.addEventListener("click",()=>{clicar("#copiarSemDinheiro");fecharCopiar();});
const a4=qs("#aCopiarGerencial");if(a4)a4.addEventListener("click",()=>{clicar("#copiarGerencial");fecharCopiar();});
const a5=qs("#aProibidos");if(a5)a5.addEventListener("click",()=>{clicar("#editarProibidos");fecharAcoes();});
const a6=qs("#aVendedores");if(a6)a6.addEventListener("click",()=>{fecharAcoes();renderLista();abrirVendedores();});
const a7=qs("#aAjuda");if(a7)a7.addEventListener("click",()=>{fecharAcoes();abrirAjuda();});
const a8=qs("#aLimpar");if(a8)a8.addEventListener("click",()=>{_fnLimpar();fecharAcoes();});
const mb1=qs("#mbCopiar");if(mb1)mb1.addEventListener("click",abrirCopiar);
const mb2=qs("#mbVendas");if(mb2)mb2.addEventListener("click",irParaVendas);
const mb3=qs("#mbMais");if(mb3)mb3.addEventListener("click",abrirAcoes);
// ── Atualizar sem recarregar (v3.26.0) ─────────────────────────────────────
// Com "Recarregar relatório ao detectar mudanças" DESLIGADO, venda nova continua
// entrando sozinha — só que sem recarregar a página: busca a página nova em segundo
// plano, troca só os dados e redesenha. Filtros, busca, rolagem, painel e janelas
// abertas ficam como estão. Chamada pelo script do servidor no lugar do reload.
(function(){
    let rodando = false, deNovo = false;
    const pegarDados = async () => {
        for (let t = 0; t < 12; t++) {
            const r = await fetch(location.pathname + location.search, { cache: "no-store", credentials: "same-origin" });
            if (!r.ok) throw new Error("HTTP " + r.status);
            const doc = new DOMParser().parseFromString(await r.text(), "text/html");
            const el = doc.getElementById("dados");
            if (el) return { dados: JSON.parse(el.textContent || "{}"), doc };
            await new Promise(res => setTimeout(res, 700));   // ainda gerando ("Gerando relatório...")
        }
        throw new Error("o relatório novo não ficou pronto a tempo");
    };
    const aplicar = (novo, doc) => {
        _prepararDados(novo);
        DADOS = novo;
        _indexarVendas();
        _dupLerListas(); _dupAplicarSalvas(); _dupMarcarLinhas(); _dupAtualizarBotao();
        _atualizarCabecalho();
        try {   // "Gerado em" do relatório novo
            const g = doc.querySelectorAll(".badgeHora"), a = document.querySelectorAll(".badgeHora");
            a.forEach((el, i) => { if (g[i]) el.textContent = g[i].textContent; });
        } catch (_) {}
        _tdHtmlCache.clear(); _miniHtmlCache.clear();
        _invalidarCtxCache(); _passaFiltroKeyCache = "";
        somaKey = ""; calcSomaSel();
        renderTudo();
        try { if (_dshVisivel()) _dshRender(); } catch (_) {}
        try { if (typeof window.__linhaUnica === "function") window.__linhaUnica(); } catch (_) {}
    };
    window.__atualizarSemRecarregar = async () => {
        if (rodando) { deNovo = true; return true; }
        rodando = true;
        try {
            const r = await pegarDados();
            aplicar(r.dados, r.doc);
            return true;
        } catch (e) {
            console.warn("[atualizar sem recarregar] " + (e && e.message || e));
            return false;
        } finally {
            rodando = false;
            if (deNovo) { deNovo = false; setTimeout(() => { window.__atualizarSemRecarregar(); }, 250); }
        }
    };
})();

// Voltar ao topo no celular (v3.21.1): aparece depois de descer ~1,2 tela (mínimo 500px).
(function(){
    const bt=qs("#btnTopo"); if(!bt)return;
    const mq=window.matchMedia("(max-width:680px)");
    let pend=false, vis=false;
    const atualizar=()=>{
        pend=false;
        const y=window.scrollY||document.documentElement.scrollTop||0;
        const mostrar=mq.matches && y>Math.max(500,window.innerHeight*1.2);
        if(mostrar===vis)return; vis=mostrar;
        bt.classList.toggle("vis",mostrar);
        bt.setAttribute("aria-hidden",mostrar?"false":"true");
        bt.tabIndex=mostrar?0:-1;
    };
    const agendar=()=>{ if(pend)return; pend=true; requestAnimationFrame(atualizar); };
    window.addEventListener("scroll",agendar,{passive:true});
    window.addEventListener("resize",agendar);
    bt.addEventListener("click",()=>{
        const leve=document.documentElement.getAttribute("data-perf")==="leve";
        try{ window.scrollTo({top:0,behavior:leve?"auto":"smooth"}); }catch(e){ window.scrollTo(0,0); }
    });
    atualizar();
})();
const vendQ=qs("#vendQ");if(vendQ)vendQ.addEventListener("input",e=>{vendFiltro=String(e.target.value||"");renderLista();});
const btnVend=qs("#btnVend");if(btnVend)btnVend.addEventListener("click",()=>{renderLista();abrirVendedores();});
const vendFechar=qs("#vendFechar");if(vendFechar)vendFechar.addEventListener("click",fecharVendedores);
const ovVend=qs("#ovVend");if(ovVend)ovVend.addEventListener("click",e=>{if(e.target===ovVend)fecharVendedores();});

qs("#copiarModal").addEventListener("click",()=>{if(!linhaAtual)return;copiarTexto((linhaAtual.vendedor||"(sem vendedor)")+":\n"+linhaCopiaItens(linhaAtual));toast("Copiado","Linha (com itens).");});
qs("#copiarModalGer").addEventListener("click",()=>{if(!linhaAtual)return;copiarTexto(String(linhaAtual.numero||""));toast("Copiado","Somente gerencial.");});
qs("#copiarModalSemItens").addEventListener("click",()=>{if(!linhaAtual)return;copiarTexto((linhaAtual.vendedor||"(sem vendedor)")+":\n"+linhaCopiaSemItens(linhaAtual));toast("Copiado","Linha (sem itens).");});
qs("#fechar").addEventListener("click",fecharModal);
qs("#ov").addEventListener("click",e=>{if(e.target===qs("#ov"))fecharModal();});

document.addEventListener("keydown",e=>{
    if(e.key==="Escape"){
        const ovc=qs("#ovCopiar");if(ovc&&ovc.classList.contains("on")){fecharCopiar();return;}
        const ova=qs("#ovAcoes");if(ova&&ova.classList.contains("on")){fecharAcoes();return;}
        const ovv=qs("#ovVend");if(ovv&&ovv.classList.contains("on")){fecharVendedores();return;}
        fecharModal();
    }
});

// Atalhos de proibidos: Delete → [-proibidos], Insert / CapsLock+P → [proibidos].
// BUG FIX (v2.9.2): o atalho era capturado na página INTEIRA, inclusive dentro
// de campos de texto — com preventDefault, a tecla Delete deixava de apagar
// (na busca, na lista de proibidos, nas configurações) e digitar "P" com
// CapsLock ligado em qualquer campo disparava o filtro em vez de escrever a
// letra. Agora: fora de campos de texto funciona como antes; dentro da busca
// (#q) o Delete só vira atalho quando não há nada à frente do cursor para
// apagar, e CapsLock+P digita normalmente; nos demais campos, nunca dispara.
const _ehCampoEditavel = el => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || ""));
// Cliques de conveniência do atalho (aba Gerencial + vendedor "Todos") —
// protegidos: elemento ausente não pode derrubar o handler.
const _atalhoSelecionarGerencialTodos = () => {
    try { const r = document.querySelector(".radio#radioLblGer"); if (r) r.click(); } catch(_) {}
    try {
        const n = document.evaluate("//div[@id='lista']//div[contains(@class, 'item')]//div[contains(@class, 'nome') and normalize-space()='Todos']",
            document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        if (n) n.click();
    } catch(_) {}
};
document.addEventListener("keydown",e=>{
    const k=String(e.key||""); const isInsert=k==="Insert"; const isCapsP=(k.toLowerCase()==="p"&&e.getModifierState&&e.getModifierState("CapsLock")); const isDelete=k==="Delete";
    if(!isInsert&&!isCapsP&&!isDelete)return;
    if(e.ctrlKey||e.altKey||e.metaKey)return; // combinações ficam para as teclas personalizadas
    const alvo=e.target;
    if(_ehCampoEditavel(alvo)){
        if(alvo.id!=="q")return;
        if(isCapsP)return; // digitação normal de "P" na busca
        if(isDelete){
            const tam=String(alvo.value||"").length;
            const semSelecao=alvo.selectionStart===alvo.selectionEnd;
            if(!(semSelecao&&alvo.selectionEnd>=tam))return; // há o que apagar: Delete normal
        }
    }
    e.preventDefault(); const inp=qs("#q"); if(!inp)return;
    let v=String(inp.value||"");
    if(isDelete){
        if(v.toLowerCase().indexOf("[-proibidos]")<0)v=(v+" [-proibidos]").trim();
        inp.value=v; qAtual=v.trim(); const p=parseBusca(qAtual); qInc=p.inc; calcSomaSel(); renderTabela(); _atualizarXLimpar(); toast("Filtro","Aplicado [-proibidos].");
        _atalhoSelecionarGerencialTodos();
    }else{
        if(k==="Insert") _atalhoSelecionarGerencialTodos();
        if(v.toLowerCase().indexOf("[proibidos]")<0)v=(v+" [proibidos]").trim();
        inp.value=v; qAtual=v.trim(); const p=parseBusca(qAtual); qInc=p.inc; calcSomaSel(); renderTabela(); _atualizarXLimpar(); toast("Filtro","Aplicado [proibidos].");
    }
});

// ── AÇÕES VINCULÁVEIS A TECLAS DE ATALHO ──────────────────────────────
const ACOES_DISPONIVEIS = [
    { value: "",                          label: "(nenhuma — só executa o comando)" },
    { value: "click:#aCopiarTudo",        label: "\u25b8 Copiar tudo" },
    { value: "click:#aCopiarTudoItens",   label: "\u25b8 Copiar tudo + itens" },
    { value: "click:#aCopiarSemDinheiro", label: "\u25b8 Copiar sem dinheiro" },
    { value: "click:#aCopiarGerencial",   label: "\u25b8 Copiar só gerencial" },
    { value: "click:#aProibidos",         label: "\u25b8 Editar proibidos" },
    { value: "click:#aVendedores",        label: "\u25b8 Filtrar por vendedor" },
    { value: "click:#aAjuda",             label: "\u25b8 Ajuda de coringas" },
    { value: "click:#aLimpar",            label: "\u25b8 Limpar filtros" },
    { value: "click:#btnTema",            label: "\u25b8 Abrir menu de temas" },
    { value: "tema:proximo",              label: "\u25b8 Próximo tema (alternar)" },
    { value: "tema:anterior",             label: "\u25b8 Tema anterior" },
    { value: "click:#btnModalPeriodo",    label: "\u25b8 Gerar por período" },
    { value: "radio:tipoBusca:todos",     label: "\u25cf Tipo: Todos" },
    { value: "radio:tipoBusca:gerencial", label: "\u25cf Tipo: Gerencial" },
    { value: "radio:tipoBusca:nfce",      label: "\u25cf Tipo: NFC-e" },
    { value: "radio:tipoBusca:nfe",       label: "\u25cf Tipo: NF-e" }
];
const _executarAcao = (v) => {
    v = String(v || "").trim(); if (!v) return;
    const sep = v.indexOf(":"); if (sep < 0) return;
    const tipo = v.slice(0, sep), resto = v.slice(sep + 1);
    // try/catch defensivo: "acao" normalmente só vem do <select> controlado
    // (ACOES_DISPONIVEIS), mas também é lido de config.json — que pode ser
    // editado manualmente no servidor. Um valor malformado aqui não deve
    // derrubar o handler global de keydown (que trataria TODAS as teclas
    // de atalho personalizadas, não só esta).
    try {
        if (tipo === "click") { const el = qs(resto); if (el) el.click(); }
        else if (tipo === "tema") {
            if (resto === "proximo") _ciclarTema(1);
            else if (resto === "anterior") _ciclarTema(-1);
        }
        else if (tipo === "radio") {
            const pts = resto.split(":"); if (pts.length < 2) return;
            const el = document.querySelector('input[name="' + pts[0] + '"][value="' + pts[1] + '"]');
            if (el) { el.checked = true; el.dispatchEvent(new Event("change", {bubbles:true})); }
        } else if (tipo === "checkbox") {
            const el = qs(resto);
            if (el && el.type === "checkbox") { el.checked = !el.checked; el.dispatchEvent(new Event("change", {bubbles:true})); }
        }
    } catch (e) {
        console.warn("[teclas personalizadas] falha ao executar ação \"" + v + "\":", e && e.message);
    }
};

// ── Teclas de atalho personalizadas ──────────────────────────────────────────
// Cada entrada em window.__teclasPersonalizadas: { tecla: "F2", comando: "[-proibidos]>150" }
// A tecla pode ser qualquer e.key (F1-F12, Insert, Delete, Home, End, PageUp, PageDown, etc.)
// ou combinação Ctrl+tecla / Alt+tecla (ex: "Ctrl+F2", "Alt+Delete").
// O comando é inserido integralmente na caixa de busca e executado.
document.addEventListener("keydown", function _tpHandler(e) {
    var _tp = window.__teclasPersonalizadas;
    if (!Array.isArray(_tp) || !_tp.length) return;
    // Não dispara se o foco está em input/textarea que NÃO seja a caixa de busca
    var _ae = document.activeElement;
    if (_ae && _ae.id !== "q" && (_ae.tagName === "INPUT" || _ae.tagName === "TEXTAREA" || _ae.isContentEditable)) return;
    // Monta string da tecla pressionada com modificadores
    var _k = String(e.key || "");
    var _teclaAtual = (_k.startsWith("F") && /^F\d+$/.test(_k)) || ["Insert","Delete","Home","End","PageUp","PageDown"].indexOf(_k)>=0
        ? (e.ctrlKey?"Ctrl+":"") + (e.altKey?"Alt+":"") + _k
        : (e.ctrlKey && !e.altKey ? "Ctrl+" + _k : (e.altKey && !e.ctrlKey ? "Alt+" + _k : null));
    if (!_teclaAtual) return;
    var _entrada = null;
    for (var _i=0; _i<_tp.length; _i++) {
        if (String(_tp[_i].tecla||"").trim().toLowerCase() === _teclaAtual.toLowerCase()) { _entrada=_tp[_i]; break; }
    }
    if (!_entrada) return;
    e.preventDefault();
    var inp = qs("#q"); if (!inp) return;
    _executarAcao(_entrada.acao);
    var _cmd = String(_entrada.comando || "").trim();
    inp.value = _cmd;
    qAtual = _cmd;
    _invalidarCtxCache();
    var p = parseBusca(qAtual); qInc=p.inc;
    calcSomaSel(); renderTabela(); _atualizarXLimpar();
    var _temAcao = !!String(_entrada.acao || "").trim();
    toast("Atalho " + String(_entrada.tecla||""), _cmd || (_temAcao ? "Ação executada." : "Busca limpa."));
});

qs("#atualizar")?.addEventListener("click", () => {
    window.location.href = "/atualizar";
});

qs("#btnModalPeriodo")?.addEventListener("click", () => {
    __abrirModalPeriodo();
});

var __abrirModalPeriodo = function() {
    if (document.getElementById("ovPeriodo")) return;
    var _hoje = new Date();
    var _p = function(n) { return String(n).padStart(2, "0"); };
    var _hojeISO = _hoje.getFullYear() + "-" + _p(_hoje.getMonth()+1) + "-" + _p(_hoje.getDate());
    var _bg = document.createElement("div");
    _bg.className = "ov sheet";
    _bg.id = "ovPeriodo";
    _bg.setAttribute("aria-hidden", "false");
    _bg.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true" style="max-width:420px">' +
          '<div class="mhead">' +
            '<div>' +
              '<div class="mtitle">Gerar por periodo</div>' +
              '<div class="msub">Informe o intervalo de datas desejado</div>' +
            '</div>' +
            '<button class="btn" id="perFechar" type="button"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Fechar</button>' +
          '</div>' +
          '<div class="mbody" style="gap:16px;padding-bottom:24px">' +
            '<div class="kv">' +
              '<div class="k">Data inicial</div>' +
              '<input type="date" id="perInicio" value="' + _hojeISO + '" class="input" style="flex:1">' +
            '</div>' +
            '<div class="kv">' +
              '<div class="k">Data final</div>' +
              '<input type="date" id="perFim" value="' + _hojeISO + '" class="input" style="flex:1">' +
            '</div>' +
            '<div id="perStatus" style="display:none;text-align:center;padding:8px 0;font-size:13px;color:var(--text-muted)">Gerando relatorio, aguarde...</div>' +
            '<button class="btn" id="perGerar" type="button" style="width:100%;min-height:48px;height:auto;padding:12px 18px;font-size:15px;font-weight:700;white-space:normal;line-height:1.3;gap:10px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>Gerar relatório</button>' +
          '</div>' +
        '</div>';
    document.body.appendChild(_bg);
    // Fix de transição (mesmo princípio do modal Proibidos): "on" só depois
    // do reflow, senão o overlay aparece sem fade.
    void _bg.offsetWidth;
    _bg.classList.add("on");
    // BUG FIX (auditoria v2.5.0 — LEAK): mesma classe de vazamento corrigida no
    // modal Proibidos — ver comentário detalhado em abrirEditorProibidos().
    // _fechar agora remove o listener "keydown" de Escape explicitamente, em
    // vez de depender de o usuário pressionar Escape para isso acontecer.
    function _escPer(e) { if (e.key === "Escape") _fechar(); }
    var _fechar = function() { document.removeEventListener("keydown", _escPer); _fecharOverlayAnimado(_bg); };
    document.getElementById("perFechar").addEventListener("click", _fechar);
    _bg.addEventListener("click", function(e) { if (e.target === _bg) _fechar(); });
    document.addEventListener("keydown", _escPer);
    document.getElementById("perGerar").addEventListener("click", function() {
        var inicio = document.getElementById("perInicio").value;
        var fim    = document.getElementById("perFim").value;
        if (!inicio || !fim) { toast("Erro", "Informe as duas datas."); return; }
        if (inicio > fim) { toast("Erro", "A data inicial deve ser anterior ou igual a final."); return; }
        var _st  = document.getElementById("perStatus");
        var _btn = document.getElementById("perGerar");
        if (_st)  _st.style.display = "block";
        if (_btn) { _btn.disabled = true; _btn.textContent = "Gerando..."; }
        window.location.href = "/periodo?i=" + encodeURIComponent(inicio) + "&f=" + encodeURIComponent(fim);
    });
};

// ── QR code para abrir no celular (v3.21.0) ────────────────────────────────
// Imagem e endereço vêm do servidor (/qr.svg e /api/qr): sempre o IP desta máquina na
// rede, nunca "localhost" (que no celular apontaria para o próprio celular).
var __abrirModalQr = function() {
    if (document.getElementById("ovQr")) return;
    var _bg = document.createElement("div");
    _bg.className = "ov sheet"; _bg.id = "ovQr"; _bg.setAttribute("aria-hidden", "false");
    _bg.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true" aria-label="Abrir no celular" style="max-width:400px">' +
          '<div class="mhead"><div><div class="mtitle">Abrir no celular</div>' +
          '<div class="msub">Aponte a câmera do celular para o código.</div></div>' +
          '<button class="btn" id="qrFechar" type="button"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Fechar</button></div>' +
          '<div class="mbody" style="gap:12px;padding:16px 18px 20px">' +
            // v3.23.0: "Fora da loja" = endereço do Tailscale (rede privada; funciona no 4G/outro Wi-Fi).
            '<div class="tmPerfOps qrAbas" role="tablist" aria-label="Onde o celular está">' +
              '<button type="button" class="tmPerfOp qrAba" role="tab" data-aba="loja" aria-checked="true">Na loja (Wi-Fi)</button>' +
              '<button type="button" class="tmPerfOp qrAba" role="tab" data-aba="fora" aria-checked="false">Fora da loja</button>' +
            '</div>' +
            '<div class="qrCaixa"><img id="qrImg" alt="QR code do endereço do relatório" src="/qr.svg?t=' + Date.now() + '"></div>' +
            '<div class="qrUrl" id="qrUrl">…</div>' +
            '<button class="btn" id="qrCopiar" type="button" style="width:100%;justify-content:center;min-height:42px"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copiar endereço</button>' +
            '<div class="qrDica" id="qrDica">O celular precisa estar no <b>mesmo Wi-Fi</b> desta máquina. Também dá para digitar o endereço no navegador do celular.</div>' +
          '</div>' +
        '</div>';
    document.body.appendChild(_bg);
    void _bg.offsetWidth;
    _bg.classList.add("on");
    function _escQr(e) { if (e.key === "Escape") _fechar(); }
    var _fechar = function() { document.removeEventListener("keydown", _escQr); _fecharOverlayAnimado(_bg); };
    document.getElementById("qrFechar").addEventListener("click", _fechar);
    _bg.addEventListener("click", function(e) { if (e.target === _bg) _fechar(); });
    document.addEventListener("keydown", _escQr);
    var _img = document.getElementById("qrImg");
    _img.addEventListener("error", function() {
        var cx = _img.parentNode; if (cx) cx.innerHTML = '<div class="qrDica" style="padding:90px 10px">Não foi possível gerar o QR code — o servidor está ligado?</div>';
    });
    var _qrDados = { url: location.origin + "/", externo: null };
    var _DICA_LOJA = 'O celular precisa estar no <b>mesmo Wi-Fi</b> desta máquina. Também dá para digitar o endereço no navegador do celular.';
    var _DICA_FORA = 'Funciona em qualquer lugar (4G, outro Wi-Fi) com o app <b>Tailscale</b> ligado no celular, na <b>mesma conta</b> desta máquina. Rede privada e criptografada — só os seus aparelhos entram.';
    var _DICA_SEM_TS = '<b>Para acessar fora da loja:</b><br>1. Instale o <b>Tailscale</b> nesta máquina (tailscale.com/download) e entre com uma conta.<br>2. Instale o app <b>Tailscale</b> no celular e entre com a <b>mesma conta</b>.<br>3. Abra esta janela de novo: aparece o QR code para usar em qualquer lugar.<br>Grátis, criptografado e sem abrir porta no roteador.';
    var _abaQr = "loja";
    var _mostrarAba = function(aba) {
        _abaQr = aba;
        _bg.querySelectorAll(".qrAba").forEach(function(b) { b.setAttribute("aria-checked", b.getAttribute("data-aba") === aba ? "true" : "false"); });
        var u = document.getElementById("qrUrl"), d = document.getElementById("qrDica"), cx = _img.parentNode, cp = document.getElementById("qrCopiar");
        var fora = aba === "fora", end = fora ? _qrDados.externo : _qrDados.url;
        if (cx) cx.style.display = end ? "" : "none";
        if (u) { u.style.display = end ? "" : "none"; u.textContent = end || ""; }
        if (cp) cp.style.display = end ? "" : "none";
        if (end) _img.src = "/qr.svg?" + (fora ? "externo=1&" : "") + "t=" + Date.now();
        if (d) d.innerHTML = fora ? (end ? _DICA_FORA : _DICA_SEM_TS) : _DICA_LOJA;
    };
    _bg.querySelectorAll(".qrAba").forEach(function(b) { b.addEventListener("click", function() { _mostrarAba(b.getAttribute("data-aba")); }); });
    _fetchJSON("/api/qr", {cache: "no-store"}).then(function(r) {
        if (r && r.url) _qrDados.url = r.url;
        _qrDados.externo = (r && r.externo) ? String(r.externo) : null;
        var u = document.getElementById("qrUrl"); if (u && _abaQr === "loja") u.textContent = _qrDados.url;
    }).catch(function() { var u = document.getElementById("qrUrl"); if (u) u.textContent = location.origin + "/"; });
    document.getElementById("qrCopiar").addEventListener("click", function() {
        var u = document.getElementById("qrUrl"); if (!u || !u.textContent) return;
        copiarTexto(u.textContent); toast("Copiado", "Endereço do relatório: " + u.textContent);
    });
};

// ── Modal de configurações (acionado via botão Editar configurações ou tray → SSE navigate-hash:config) ───
// v3.22.0 — preferências por aparelho: num aparelho da rede o modal vira "Minhas
// preferências" (duração dos avisos, proibidos e teclas — só dele); no computador do
// servidor edita o padrão de todos e, com { aparelho: chave }, as de um aparelho.
var __abrirModalConfig = function(opcoes) {
    if (document.getElementById("ovConfig")) return;
    var _op = (opcoes && typeof opcoes === "object" && !opcoes.type) ? opcoes : {};
    var _alvo = typeof _op.aparelho === "string" ? _op.aparelho : "";
    var _bg = document.createElement("div");
    _bg.className = "ov sheet";
    _bg.id = "ovConfig";
    _bg.setAttribute("aria-hidden", "false");

    // BUG FIX (auditoria v2.5.0 — LEAK): mesma classe de vazamento corrigida nos
    // modais Proibidos e Período — ver comentário detalhado em
    // abrirEditorProibidos(). Aqui o listener de Escape só é criado dentro do
    // .then() assíncrono (depois que /api/config responde), então guardamos a
    // referência numa variável do escopo externo para que _fechar (definido
    // antes disso) consiga removê-lo também.
    var _escCfgHandler = null;
    var _fechar = function() {
        if (_escCfgHandler) { document.removeEventListener("keydown", _escCfgHandler); _escCfgHandler = null; }
        _fecharOverlayAnimado(document.getElementById("ovConfig"));
    };

    // Carrega valores atuais do servidor antes de montar o HTML
    _fetchJSON("/api/config" + (_alvo ? "?aparelho=" + encodeURIComponent(_alvo) : ""), {cache: "no-store"})
    .catch(function(){ return {}; })
    .then(function(cfg) {
        cfg = (cfg && typeof cfg === "object") ? cfg : {};
        var _apPag = window.__APARELHO__ || null;
        var _remoto = cfg.servidor === false || (cfg.servidor === undefined && !!_apPag && _apPag.servidor === false);
        if (_remoto) _alvo = "";                         // aparelho da rede só edita as dele
        var _soPrefs = _remoto || !!_alvo;
        var _pers = (cfg.personalizado && typeof cfg.personalizado === "object") ? cfg.personalizado : {};
        var _rotPers = { toastDuration: "duração dos avisos", proibidos: "termos proibidos", teclasPersonalizadas: "teclas de atalho" };
        var _listaPers = Object.keys(_rotPers).filter(function(k){ return _pers[k]; }).map(function(k){ return _rotPers[k]; });
        var _apTxt = cfg.aparelho && cfg.aparelho.texto ? String(cfg.aparelho.texto) : "";
        var _escondeSrv = _soPrefs ? ' style="display:none"' : '';
        // XSS FIX (v2.8.0): valores do servidor entram no HTML abaixo — escapados
        // com esc() (& < > "), não só aspas.
        var _pn  = esc(String(cfg.appName  || ""));
        var _pi  = parseInt(cfg.pollInterval || 100, 10);
        var _ml  = parseInt(cfg.maxLogLines  || 1000, 10);
        var _fv  = String(cfg.favicon        || "");
        var _td  = parseInt(cfg.toastDuration || 5000, 10);
        var _jh  = parseInt(cfg.janelaCorrecaoHoraMin || 180, 10);
        var _prArr = Array.isArray(cfg.proibidos) ? cfg.proibidos : [];

        // Aplica a duração de toast imediatamente ao abrir o modal (só se forem as
        // preferências desta própria tela — não as de outro aparelho).
        if (!_alvo) window.__TOAST_MS = Math.max(500, _td);

        _bg.innerHTML =
          '<div class="modal cfgModal" role="dialog" aria-modal="true">' +
            '<div class="mhead">' +
              '<div>' +
                '<div class="mtitle">' + (_alvo ? 'Preferências do aparelho' : (_remoto ? 'Minhas preferências' : 'Editar configurações')) + '</div>' +
                '<div class="msub">' + (_alvo
                    ? 'Aparelho: <b>' + esc(_apTxt || "?") + '</b> — valem só para ele; aplicadas na tela dele na hora.'
                    : (_remoto
                        ? 'Valem só para este aparelho' + (_apTxt ? ' (' + esc(_apTxt) + ')' : '') + ' — os outros não são afetados. Nome, intervalo, log, janela de correção e ícone só podem ser alterados no computador do servidor.'
                        : 'Padrão de todos os aparelhos (cada um pode ter as suas preferências). Avançado: config.json.')) + '</div>' +
                (_soPrefs ? '<div class="msub" id="cfgPersInfo" style="margin-top:4px">' + (_listaPers.length ? 'Próprias: ' + esc(_listaPers.join(", ")) + '.' : 'Seguindo o padrão do servidor.') + '</div>' : '') +
              '</div>' +
              '<button class="btn" id="cfgFechar" type="button"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Fechar</button>' +
            '</div>' +
            '<div class="mbody" style="gap:14px;padding-bottom:24px">' +
              // Apelido do aparelho (v3.25.0): só para reconhecer na lista e no log.
              (_soPrefs
                ? '<div class="kv" style="flex-direction:column;gap:8px">' +
                    '<div class="k">' + (_alvo ? 'Nome do aparelho' : 'Nome deste aparelho') + ' <span style="font-weight:400;text-transform:none;letter-spacing:0">(apelido para reconhecer na lista de aparelhos e no log' + (cfg.aparelho && cfg.aparelho.nome ? ' — o nome real "' + esc(cfg.aparelho.nome) + '" não muda' : ' — não muda o nome real do aparelho') + ')</span></div>' +
                    '<input type="text" id="cfgApelido" class="input" maxlength="40" autocomplete="off" placeholder="ex.: Celular do Caixa 1" value="' + esc(String((cfg.aparelho && cfg.aparelho.apelido) || "")) + '">' +
                  '</div>'
                : '') +
              (_alvo ? '' :
              '<div class="kv" id="cfgTela" style="flex-direction:column;align-items:stretch;gap:0">' +
                '<div class="k">Nesta tela <span style="font-weight:400;text-transform:none;letter-spacing:0">(só neste aparelho — vale na hora, sem salvar)</span></div>' +
                _htmlPrefsTela() +
              '</div>') +
              '<div class="kv"' + _escondeSrv + '>' +
                '<div class="k">Nome do sistema</div>' +
                '<input type="text" id="cfgAppName" value="' + _pn + '" class="input" placeholder="ex: Minha Loja" style="flex:1">' +
              '</div>' +
              '<div class="kv"' + _escondeSrv + '>' +
                '<div class="k">Intervalo de atualização automática (ms)</div>' +
                '<input type="number" id="cfgPollInterval" value="' + _pi + '" min="100" step="50" class="input" style="flex:1">' +
              '</div>' +
              '<div class="kv"' + _escondeSrv + '>' +
                '<div class="k">Máx. linhas de log interno</div>' +
                '<input type="number" id="cfgMaxLogLines" value="' + _ml + '" min="100" step="100" class="input" style="flex:1">' +
              '</div>' +
              '<div class="kv">' +
                '<div class="k">Duração das mensagens de aviso (ms)</div>' +
                '<div style="display:flex;gap:8px;align-items:center;flex:1">' +
                  '<input type="number" id="cfgToastDuracao" value="' + _td + '" min="500" max="30000" step="500" class="input" style="flex:1">' +
                  '<button class="btn" type="button" id="cfgToastReset" data-tip="Restaurar duração padrão (5 segundos)" style="white-space:nowrap"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.42"/></svg>Padrão (5s)</button>' +
                '</div>' +
              '</div>' +
              '<div class="kv"' + _escondeSrv + '>' +
                '<div class="k" data-tip="Gerenciais com hora no futuro ou entre 3 min e este tempo atrás passam a usar a hora atual; mais antigas são ignoradas.">Janela de correção de horário (min)</div>' +
                '<div style="display:flex;gap:8px;align-items:center;flex:1">' +
                  '<input type="number" id="cfgJanelaHora" value="' + _jh + '" min="5" max="720" step="5" class="input" style="flex:1">' +
                  '<button class="btn" type="button" id="cfgJanelaReset" data-tip="Restaurar janela padrão (3 horas)" style="white-space:nowrap"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.42"/></svg>Padrão (3h)</button>' +
                '</div>' +
              '</div>' +
              '<div class="kv" style="flex-direction:column;gap:8px' + (_soPrefs ? ';display:none' : '') + '">' +
                '<div class="k">Ícone (favicon)</div>' +
                '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
                  '<input type="text" id="cfgFaviconPath" value="' + esc(_fv) + '" class="input" placeholder="Caminho do arquivo ou vazio para padrão" style="flex:1;min-width:0">' +
                  '<button class="btn" type="button" id="cfgFaviconPick" data-tip="Selecionar arquivo de imagem do computador"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>Procurar</button>' +
                  '<input type="file" id="cfgFaviconFile" accept=".png,.ico,.jpg,.jpeg" style="display:none">' +
                '</div>' +
                '<div id="cfgFaviconInfo" style="font-size:11px;color:var(--text-muted);padding-left:2px">' +
                  (_fv ? 'Atual: ' + esc(_fv) : 'Usando favicon.png padrão da pasta do sistema') +
                '</div>' +
              '</div>' +
              '<div class="kv" style="flex-direction:column;gap:8px">' +
                '<div class="k">Termos proibidos <span style="font-weight:400;text-transform:none;letter-spacing:0">(um por linha — oculta vendas com esses produtos; listas coladas em outro formato são ajustadas sozinhas)</span></div>' +
                '<textarea id="cfgProibidos" spellcheck="false" style="width:100%;min-height:130px;resize:vertical;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--bg-app);color:var(--text-main);padding:10px 12px;font-family:ui-monospace,Consolas,monospace;font-size:12px;outline:none;transition:border-color .15s"></textarea>' +
                '<div id="cfgProibCont" aria-live="polite" style="font-size:12px;color:var(--text-muted);min-height:18px;padding:4px 2px 0;line-height:1.4"></div>' +
                (_soPrefs ? _BTN_IMPORTAR_PR("cfgPrImportar", "cfgPrJuntar") : '') +
              '</div>' +
              '<div class="kv" style="flex-direction:column;gap:8px">' +
                '<div class="k">Teclas de atalho <span style="font-weight:400;text-transform:none;letter-spacing:0">(tecla → executa comando na caixa de busca)</span></div>' +
                '<div style="font-size:11px;color:var(--text-muted);padding-left:2px;line-height:1.5">Suporta F1–F12, Insert, Delete, Home, End, PageUp, PageDown e combinações Ctrl+ / Alt+.<br>Clique em "Gravar tecla" e pressione a tecla desejada. O comando aceita todos os coringas.</div>' +
                '<div id="cfgTeclasLista" style="display:flex;flex-direction:column;gap:8px"></div>' +
                '<button class="btn" type="button" id="cfgAddTecla" style="align-self:flex-start"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Adicionar atalho</button>' +
              '</div>' +
              (_soPrefs
                ? '<button class="btn" type="button" id="cfgRestaurarAp"' + (_listaPers.length ? '' : ' disabled') + ' style="align-self:flex-start"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.42"/></svg>Voltar ao padrão do servidor</button>'
                : '<div class="kv" style="flex-direction:column;gap:8px">' +
                    '<div class="k">Aparelhos da rede</div>' +
                    '<label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;line-height:1.4;cursor:pointer"><input type="checkbox" id="cfgAplicarTodos" style="margin-top:2px">Aplicar duração dos avisos, proibidos e teclas a TODOS os aparelhos (apaga as preferências próprias deles)</label>' +
                    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><select id="cfgApSel" class="input" style="flex:1;min-width:0;cursor:pointer"><option value="">Editar as preferências de um aparelho conectado...</option></select>' +
                    '<button class="btn" type="button" id="cfgApEditar" disabled>Editar</button></div>' +
                  '</div>') +
              '<div id="cfgStatus" style="display:none;text-align:center;padding:8px 0;font-size:13px;color:var(--text-muted)">Salvando...</div>' +
              '<button class="btn" id="cfgSalvar" type="button" style="width:100%;min-height:48px;height:auto;padding:12px 18px;font-size:15px;font-weight:700;white-space:normal;line-height:1.3;gap:10px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>' + (_soPrefs ? 'Salvar preferências' : 'Salvar configurações') + '</button>' +
            '</div>' +
          '</div>';

        document.body.appendChild(_bg);

        // Opções da tela (visualização, desempenho, atualização, texto) — v3.24.0
        _ligarPrefsTela(document.getElementById("cfgTela"));

        // Popula textarea de proibidos
        document.getElementById("cfgProibidos").value = _prArr.join("\n");

        // Estilo focus na textarea
        var _ta = document.getElementById("cfgProibidos");
        _ta.addEventListener("focus", function(){ _ta.style.borderColor = "var(--accent)"; });
        _ta.addEventListener("blur",  function(){ _ta.style.borderColor = "var(--border)"; });
        // Contador de termos + ajuste automático do formato (um por linha).
        var _formatarCfgPr = ligarEditorProibidos(_ta, document.getElementById("cfgProibCont"));
        var _cfgImp = document.getElementById("cfgPrImportar"), _cfgJun = document.getElementById("cfgPrJuntar");
        if (_cfgImp) _cfgImp.addEventListener("click", function(){ _importarProibidosServidor(_ta, _formatarCfgPr, "substituir", [_cfgImp, _cfgJun]); });
        if (_cfgJun) _cfgJun.addEventListener("click", function(){ _importarProibidosServidor(_ta, _formatarCfgPr, "juntar", [_cfgImp, _cfgJun]); });

        // ── Teclas de atalho ──────────────────────────────────────────────────
        var _teclasArr = Array.isArray(cfg.teclasPersonalizadas)
            ? cfg.teclasPersonalizadas.map(function(t){ return {tecla:String(t.tecla||""),comando:String(t.comando||""),acao:String(t.acao||"")}; })
            : (Array.isArray(window.__teclasPersonalizadas) ? window.__teclasPersonalizadas.map(function(t){ return {tecla:String(t.tecla||""),comando:String(t.comando||""),acao:String(t.acao||"")}; }) : []);


        // Para as preferências de aparelho só vai o que MUDOU (v3.22.0): o que não foi
        // mexido continua seguindo o padrão do servidor.
        var _normTeclas = function(a) { return JSON.stringify((a || []).filter(function(t){ return t && t.tecla && (t.comando || t.acao); }).map(function(t){ return [String(t.tecla), String(t.comando || ""), String(t.acao || "")]; })); };
        var _teclasOrig = _normTeclas(_teclasArr);
        var _prOrig = JSON.stringify(_prArr.map(String));
        var _apelidoOrig = String((cfg.aparelho && cfg.aparelho.apelido) || "").trim();

        var _teclaValida = function(k, ctrl, alt) {
            if (!k) return false;
            var fn = /^F\d+$/.test(k);
            var esp = ["Insert","Delete","Home","End","PageUp","PageDown"].indexOf(k) >= 0;
            if (fn || esp) return true;
            // Ctrl ou Alt com qualquer tecla imprimível (1 char) ou Enter/Tab/Space etc.
            if (ctrl || alt) return k.length >= 1;
            return false;
        };

        var _renderTeclaRow = function(i) {
            var t = _teclasArr[i];
            var row = document.createElement("div");
            row.className = "cfgTeclaLin";
            row.setAttribute("data-tecla-idx", i);

            var inpTecla = document.createElement("input");
            inpTecla.className = "input";
            inpTecla.readOnly = true;
            inpTecla.placeholder = "Clique → pressione";
            inpTecla.value = t.tecla || "";
            inpTecla.className = "input cfgTecla";
            inpTecla.title = "Clique aqui e pressione a tecla de atalho";

            var btnGravar = document.createElement("button");
            btnGravar.className = "btn";
            btnGravar.type = "button";
            btnGravar.textContent = "Gravar tecla";
            btnGravar.classList.add("cfgTeclaGravar");

            var inpCmd = document.createElement("input");
            inpCmd.className = "input";
            inpCmd.placeholder = "ex: [-proibidos,dinheiro]>150";
            inpCmd.value = t.comando || "";
            inpCmd.className = "input cfgTeclaCmd";
            inpCmd.title = "Comando executado na caixa de busca ao pressionar a tecla (opcional se houver ação)";

            var selAcao = document.createElement("select");
            selAcao.className = "input";
            selAcao.className = "input cfgTeclaAcao";
            selAcao.title = "Ação opcional disparada antes do comando";
            ACOES_DISPONIVEIS.forEach(function(a) {
                var opt = document.createElement("option");
                opt.value = a.value; opt.textContent = a.label;
                if ((t.acao || "") === a.value) opt.selected = true;
                selAcao.appendChild(opt);
            });
            selAcao.addEventListener("change", function() {
                if (_teclasArr[i]) _teclasArr[i].acao = selAcao.value;
            });

            var btnRem = document.createElement("button");
            btnRem.className = "btn";
            btnRem.type = "button";
            btnRem.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
            btnRem.title = "Remover este atalho";
            btnRem.classList.add("cfgTeclaRem");

            // Atualiza teclasArr ao editar comando
            inpCmd.addEventListener("input", function() {
                if (_teclasArr[i]) _teclasArr[i].comando = inpCmd.value;
            });

            // Captura tecla pressionada
            var _capturando = false;
            var _stopCapture = function(cancel) {
                _capturando = false;
                btnGravar.textContent = "Gravar tecla";
                btnGravar.style.background = "";
                inpTecla.style.borderColor = "var(--border)";
                if (cancel && _teclasArr[i]) inpTecla.value = _teclasArr[i].tecla || "";
            };
            var _onKey = function(ev) {
                // Ignora modificadores sozinhos
                if (["Control","Alt","Shift","Meta"].indexOf(ev.key) >= 0) return;
                ev.preventDefault();
                ev.stopPropagation();
                var _k = String(ev.key || "");
                var _ctrl = ev.ctrlKey; var _alt = ev.altKey;
                if (!_teclaValida(_k, _ctrl, _alt)) {
                    toast("Tecla inválida", "Use F1–F12, Ins, Del, Home, End, PgUp, PgDn ou Ctrl/Alt+tecla.");
                    _stopCapture(true);
                    document.removeEventListener("keydown", _onKey, true);
                    return;
                }
                var _teclaStr = (_ctrl?"Ctrl+":"") + (_alt?"Alt+":"") + _k;
                // Verifica duplicata
                var _dup = false;
                for (var _d=0; _d<_teclasArr.length; _d++) {
                    if (_d !== i && String(_teclasArr[_d].tecla||"").toLowerCase() === _teclaStr.toLowerCase()) { _dup=true; break; }
                }
                if (_dup) { toast("Tecla já usada", _teclaStr + " já está atribuída a outro atalho."); _stopCapture(true); document.removeEventListener("keydown",_onKey,true); return; }
                inpTecla.value = _teclaStr;
                if (_teclasArr[i]) _teclasArr[i].tecla = _teclaStr;
                _stopCapture(false);
                document.removeEventListener("keydown", _onKey, true);
            };

            btnGravar.addEventListener("click", function() {
                if (_capturando) { _stopCapture(true); document.removeEventListener("keydown",_onKey,true); return; }
                _capturando = true;
                btnGravar.textContent = "Aguardando...";
                btnGravar.style.background = "var(--accent)";
                inpTecla.style.borderColor = "var(--accent)";
                inpTecla.value = "";
                document.addEventListener("keydown", _onKey, true);
                // Cancela se clicar fora
                setTimeout(function(){ if(_capturando){ _stopCapture(true); document.removeEventListener("keydown",_onKey,true); } }, 8000);
            });

            btnRem.addEventListener("click", function() {
                _teclasArr.splice(i, 1);
                _renderTeclaLista();
            });

            row.appendChild(inpTecla);
            row.appendChild(btnGravar);
            row.appendChild(inpCmd);
            row.appendChild(selAcao);
            row.appendChild(btnRem);
            return row;
        };

        var _renderTeclaLista = function() {
            var lista = document.getElementById("cfgTeclasLista");
            if (!lista) return;
            lista.innerHTML = "";
            for (var _ti=0; _ti<_teclasArr.length; _ti++) {
                lista.appendChild(_renderTeclaRow(_ti));
            }
        };
        _renderTeclaLista();

        document.getElementById("cfgAddTecla").addEventListener("click", function() {
            _teclasArr.push({tecla:"", comando:"", acao:""});
            _renderTeclaLista();
            // Foca o botão gravar da linha recém-adicionada
            var lista = document.getElementById("cfgTeclasLista");
            if (lista) {
                var btns = lista.querySelectorAll("button");
                if (btns.length >= 2) btns[btns.length-2].click();
            }
        });

        // Botão restaurar padrão do toast
        var _jReset = document.getElementById("cfgJanelaReset");
        if (_jReset) _jReset.addEventListener("click", function() {
            document.getElementById("cfgJanelaHora").value = 180;
        });
        document.getElementById("cfgToastReset").addEventListener("click", function() {
            document.getElementById("cfgToastDuracao").value = 5000;
        });

        // Botão fechar
        document.getElementById("cfgFechar").addEventListener("click", _fechar);
        _bg.addEventListener("click", function(e){ if (e.target === _bg) _fechar(); });
        _escCfgHandler = function(e){ if (e.key === "Escape") _fechar(); };
        document.addEventListener("keydown", _escCfgHandler);

        // File picker de favicon
        var MAX_FAVICON_BYTES = 2 * 1024 * 1024; // 2MB — favicon não precisa ser maior que isso
        var _fileInp = document.getElementById("cfgFaviconFile");
        document.getElementById("cfgFaviconPick").addEventListener("click", function(){
            if (!_soPrefs) _fileInp.click();
        });
        // Preferências de aparelho (v3.22.0): voltar ao padrão do servidor; no
        // computador do servidor, escolher um aparelho conectado para editar.
        var _restAp = document.getElementById("cfgRestaurarAp");
        if (_restAp) _restAp.addEventListener("click", function() {
            _restAp.disabled = true;
            _fetchJSON("/api/config" + (_alvo ? "?aparelho=" + encodeURIComponent(_alvo) : ""), {
                method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({restaurar: true})
            }).then(function(d) {
                if (d && d.ok) {
                    if (!_alvo && typeof window.__aplicarPrefs === "function") window.__aplicarPrefs();
                    toast("Preferências", _alvo ? "O aparelho voltou ao padrão do servidor." : "Este aparelho voltou ao padrão do servidor.");
                    _fechar();
                } else { _restAp.disabled = false; toast("Erro", (d && d.erro) || "Falha desconhecida."); }
            }).catch(function(e) { _restAp.disabled = false; toast("Erro de rede", e.message || "Falha na conexão com o servidor."); });
        });
        var _apSel = document.getElementById("cfgApSel"), _apEd = document.getElementById("cfgApEditar");
        if (_apSel && _apEd) {
            _fetchJSON("/api/dispositivos", {cache: "no-store"}).then(function(d) {
                var lista = (d && Array.isArray(d.dispositivos)) ? d.dispositivos.filter(function(x){ return x && x.chavePreferencias; }) : [];
                if (!lista.length) { _apSel.options[0].textContent = "Nenhum aparelho conectado agora"; return; }
                lista.forEach(function(x) {
                    var o = document.createElement("option");
                    o.value = String(x.chavePreferencias);
                    o.textContent = (x.apelido ? "“" + x.apelido + "” — " : "") + (x.nome ? x.nome + " — " : "") + x.ip + " — " + [x.tipo, x.modelo].filter(Boolean).join(" ") +
                        (Array.isArray(x.preferenciasProprias) && x.preferenciasProprias.length ? " (próprias: " + x.preferenciasProprias.join(", ") + ")" : " (padrão)");
                    _apSel.appendChild(o);
                });
            }).catch(function(){ _apSel.options[0].textContent = "Não foi possível listar os aparelhos"; });
            _apSel.addEventListener("change", function(){ _apEd.disabled = !_apSel.value; });
            _apEd.addEventListener("click", function() {
                var ch = _apSel.value; if (!ch) return;
                _fechar();
                setTimeout(function(){ __abrirModalConfig({aparelho: ch}); }, 360);
            });
        }
        _fileInp.addEventListener("change", function(){
            var f = _fileInp.files && _fileInp.files[0];
            if (!f) return;
            var _info = document.getElementById("cfgFaviconInfo");
            // Validação de tamanho ANTES de ler o arquivo — evita travar a aba
            // lendo um ArrayBuffer enorme e sobrecarregar o upload sem necessidade.
            if (f.size > MAX_FAVICON_BYTES) {
                _fileInp.value = "";
                if (_info) _info.textContent = "Arquivo muito grande (" + Math.round(f.size/1024) + " KB) — máximo permitido: " + Math.round(MAX_FAVICON_BYTES/1024) + " KB.";
                toast("Ícone muito grande", "Escolha um arquivo de até " + Math.round(MAX_FAVICON_BYTES/1024) + " KB.");
                return;
            }
            if (_info) _info.textContent = "Arquivo selecionado: " + f.name + " (" + Math.round(f.size/1024) + " KB) — será enviado ao salvar.";
            document.getElementById("cfgFaviconPath").value = "";
        });

        // Salvar
        document.getElementById("cfgSalvar").addEventListener("click", function() {
            var _btn = document.getElementById("cfgSalvar");
            var _st  = document.getElementById("cfgStatus");
            var _aplTodosEl = document.getElementById("cfgAplicarTodos");
            var aplTodos = !_soPrefs && !!(_aplTodosEl && _aplTodosEl.checked);
            var an   = String(document.getElementById("cfgAppName").value     || "").trim();
            var pi   = parseInt(document.getElementById("cfgPollInterval").value, 10) || 100;
            var ml   = parseInt(document.getElementById("cfgMaxLogLines").value, 10)  || 1000;
            var td   = parseInt(document.getElementById("cfgToastDuracao").value, 10) || 5000;
            var jh   = parseInt(document.getElementById("cfgJanelaHora").value, 10);
            var fv   = String(document.getElementById("cfgFaviconPath").value || "").trim();
            var pr   = _formatarCfgPr();
            var favFile = !_soPrefs && _fileInp.files && _fileInp.files[0];

            if (!_soPrefs && !an) { toast("Erro", "O nome do sistema não pode estar vazio."); return; }
            if (!_soPrefs && pi < 100) { toast("Erro", "Intervalo mínimo: 100 ms."); return; }
            if (!_soPrefs && ml < 100) { toast("Erro", "Mínimo de 100 linhas de log."); return; }
            if (td < 500 || td > 60000) { toast("Erro", "Duração do aviso: entre 500 e 60000 ms."); return; }
            if (!_soPrefs && !(jh >= 5 && jh <= 720)) { toast("Erro", "Janela de correção de horário: entre 5 e 720 minutos."); return; }

            _btn.disabled = true; _btn.textContent = "Salvando...";
            if (_st) _st.style.display = "block";

            var _doSave = function() {
                var _corpo = _soPrefs ? {} : {appName: an, pollInterval: pi, maxLogLines: ml, favicon: fv, toastDuration: td, janelaCorrecaoHoraMin: jh, proibidos: pr, teclasPersonalizadas: _teclasArr, aplicarTodos: aplTodos};
                if (_soPrefs) {
                    var _apEl = document.getElementById("cfgApelido");
                    var _apVal = _apEl ? String(_apEl.value || "").replace(/\s+/g, " ").trim().slice(0, 40) : _apelidoOrig;
                    if (_apVal !== _apelidoOrig) _corpo.apelido = _apVal;
                    if (td !== _td) _corpo.toastDuration = td;
                    if (JSON.stringify(pr.map(String)) !== _prOrig) _corpo.proibidos = pr;
                    if (_normTeclas(_teclasArr) !== _teclasOrig) _corpo.teclasPersonalizadas = _teclasArr;
                    if (!Object.keys(_corpo).length) {
                        if (_st) _st.style.display = "none";
                        _btn.disabled = false; _btn.textContent = "Salvar preferências";
                        toast("Preferências", "Nada foi alterado.");
                        _fechar();
                        return;
                    }
                }
                _fetchJSON("/api/config" + (_alvo ? "?aparelho=" + encodeURIComponent(_alvo) : ""), {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify(_corpo)
                })
                .then(function(d){
                    if (_st) _st.style.display = "none";
                    _btn.disabled = false; _btn.textContent = _soPrefs ? "Salvar preferências" : "Salvar configurações";
                    if (d.ok) {
                        if (!_alvo) {
                            // Aplica duração imediatamente
                            window.__TOAST_MS = Math.max(500, td);
                            // Aplica teclas de atalho imediatamente (sem recarregar)
                            window.__teclasPersonalizadas = _teclasArr.filter(function(t){ return t.tecla && (t.comando || t.acao); });
                        }
                        if (_remoto) {
                            // Sem regerar o relatório (vale só aqui): aplica a lista na hora.
                            if (_corpo.proibidos) { try { setProibidosUser(pr); renderTabela(); } catch (_e) {} }
                            toast("Preferências salvas", _corpo.apelido !== undefined && Object.keys(_corpo).length === 1 ? (_corpo.apelido ? "Este aparelho agora se chama “" + _corpo.apelido + "”." : "Apelido removido.") : "Valem só para este aparelho.");
                        } else if (_alvo) {
                            toast("Preferências do aparelho salvas", "Aplicadas na tela dele agora.");
                        } else {
                            toast("Configurações salvas", aplTodos ? "Padrão aplicado a todos os aparelhos. O relatório será atualizado em breve." : "O relatório será atualizado em breve.");
                        }
                        _fechar();
                    } else {
                        toast("Erro ao salvar", d.erro || "Falha desconhecida.");
                    }
                })
                .catch(function(e){
                    if (_st) _st.style.display = "none";
                    _btn.disabled = false; _btn.textContent = _soPrefs ? "Salvar preferências" : "Salvar configurações";
                    toast("Erro de rede", e.message || "Falha na conexão com o servidor.");
                });
            };

            if (favFile) {
                var _reader = new FileReader();
                _reader.onload = function(ev) {
                    var ab = ev.target.result;
                    _fetchJSON("/api/upload-favicon", {
                        method: "POST",
                        headers: {"Content-Type": "application/octet-stream"},
                        body: ab
                    })
                    .then(function(d){
                        if (d.ok) {
                            fv = "";
                        } else {
                            toast("Aviso — ícone", d.erro || "Falha no upload, usando ícone anterior.");
                        }
                        _doSave();
                    })
                    .catch(function(){
                        toast("Aviso — ícone", "Falha no upload do ícone, salvando demais configurações.");
                        _doSave();
                    });
                };
                _reader.readAsArrayBuffer(favFile);
            } else {
                _doSave();
            }
        });
    });

    // Mostra spinner enquanto carrega
    _bg.innerHTML = '<div class="modal" role="dialog" aria-modal="true" style="max-width:480px;min-height:200px;align-items:center;justify-content:center;display:flex"><div class="msub" style="text-align:center;padding:40px">Carregando configurações...</div></div>';
    document.body.appendChild(_bg);
    // Fix de transição (mesmo princípio dos modais Proibidos e Por período):
    // "on" só depois do reflow, senão o overlay aparece sem fade — aqui é
    // ainda mais perceptível porque é a PRIMEIRA coisa que o usuário vê
    // (o spinner "Carregando configurações...").
    void _bg.offsetWidth;
    _bg.classList.add("on");
    _bg.addEventListener("click", function(e){ if (e.target === _bg) _fechar(); });
};

const fixHead=()=>{
    const tbl=qs("table"); if(!tbl)return;
    const thead=tbl.querySelector("thead"); if(!thead)return;
    const sync=()=>{const sbw=tbl.offsetWidth-tbl.clientWidth;tbl.style.setProperty("--sbw",(sbw>0?sbw:0)+"px");thead.style.transform="translateX("+(-tbl.scrollLeft)+"px)";};
    tbl.addEventListener("scroll",sync,{passive:true}); window.addEventListener("resize",sync,{passive:true}); sync();
};
/**
 * Correção Sequencial Anti-Loop para #bDiaBrk
 * Gatilho: Mudança de clientWidth em div.top
 * Padrão: Formal | Pt-BR | Zero Flickering
 */
(() => {
    'use strict';
    const $ = (s) => document.querySelector(s);
    // GARANTIA (v3.8.7): o CSS já impede o estouro sozinho — .badges quebra
    // de linha quando falta espaço e o próprio total quebra por dentro em
    // último caso (ver .badges/#bDiaBrk no <style>). Este bloco só tenta
    // manter tudo em UMA linha antes de deixar quebrar: oculta a hora,
    // encolhe o botão de vendedor e compacta os badges, nessa ordem.
    //
    // "Precisa de ajuste" = o total saiu da tela OU desceu para outra linha.
    const precisaAjuste = (el) => {
        if (!el || el.offsetParent === null) return false;
        const r = el.getBoundingClientRect();
        const larg = document.documentElement.clientWidth || window.innerWidth;
        if (r.right > larg + 0.5 || r.left < -0.5) return true;
        const primeiro = el.parentElement && el.parentElement.querySelector(".badge");
        if (primeiro && primeiro !== el) {
            const r0 = primeiro.getBoundingClientRect();
            if (r0.height > 0 && r.top > r0.top + 4) return true;      // desceu para a linha de baixo
            if (r0.height > 0 && r.height > r0.height * 1.5) return true; // quebrou o próprio texto
        }
        return false;
    };

    // Etapas, da mais leve para a mais forte. A cada verificação tudo é
    // desfeito e reaplicado SÓ até caber — as leituras de layout são
    // síncronas e o navegador só pinta no fim: sem piscada, sem vai-e-volta.
    const etapas = [
        () => { const bh = $("div.badge.badgeHora:not(.badgeGeradoMobile)"); if (bh) bh.style.display = "none"; },
        () => { const vb = $(".vendBtn"); if (vb) vb.style.maxWidth = "110px"; },
        () => { const vb = $(".vendBtn"); if (vb) vb.style.maxWidth = "85px"; },
        () => {
            const vb = $(".vendBtn"); if (vb) vb.style.maxWidth = "0";
            const icon = $("span.vendIcon"); if (icon) icon.style.transform = "translateX(4px)";
        },
        () => { const t = $("div.top"); if (t) t.classList.add("badgesCompactos"); }
    ];
    const restaurar = () => {
        const bh = $("div.badge.badgeHora:not(.badgeGeradoMobile)"); if (bh) bh.style.display = "";
        const vb = $(".vendBtn"); if (vb) vb.style.maxWidth = "";
        const icon = $("span.vendIcon"); if (icon) icon.style.transform = "";
        const t = $("div.top"); if (t) t.classList.remove("badgesCompactos");
    };

    let verificando = false;
    const executarVerificacao = () => {
        const alvo = $("#bDiaBrk");
        if (!alvo || verificando) return;
        verificando = true;
        try {
            restaurar();
            for (const etapa of etapas) {
                if (!precisaAjuste(alvo)) break;
                etapa();
            }
        } catch (_) { /* layout é cosmético — nunca derruba a página */ }
        finally { verificando = false; }
    };

    // Agenda UMA verificação por quadro, venha de onde vier o gatilho.
    let agendado = 0;
    const agendar = () => {
        if (agendado) return;
        agendado = requestAnimationFrame(() => { agendado = 0; executarVerificacao(); });
    };

    // Gatilhos: largura da barra, tamanho/conteúdo do próprio total (valores
    // que mudam depois), fontes web terminando de carregar (alargam o texto
    // depois do "load" — causa do estouro que sobrava na v3.8.6) e resize.
    const observador = new ResizeObserver(() => { if (!verificando) agendar(); });
    const mutacoes = new MutationObserver(agendar);
    const iniciar = () => {
        const topDiv = $("div.top");
        const alvo = $("#bDiaBrk");
        if (!topDiv) return;
        observador.disconnect();
        observador.observe(topDiv);
        mutacoes.disconnect();
        if (alvo) mutacoes.observe(alvo, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["style"] });
        executarVerificacao();
        try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(agendar).catch(() => {}); } catch (_) {}
        try { if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", agendar); } catch (_) {}
    };

    window.addEventListener("resize", agendar, { passive: true });

    // O <script> fica no fim do <body>: se tudo já estava em cache, o "load"
    // já passou — checa readyState antes de anexar o listener.
    if (document.readyState === "complete") {
        agendar();
    } else {
        window.addEventListener("load", agendar, { passive: true, once: true });
    }
    // Rede de segurança: algumas fontes/estilos chegam depois de tudo isso.
    setTimeout(agendar, 1500);

    // NÃO chama iniciar() aqui — renderTudo() ainda não rodou,
    // então div.top não existe no DOM e a chamada seria silenciosa.
    // Expõe a função para ser chamada logo abaixo, após o DOM estar pronto.
    window.__nc_iniciarResize = iniciar;
})();
// ── RECARREGAMENTO SEM PISCAR (v3.19.0) ─────────────────────────────────────
// Antes de recarregar sozinha (venda nova), a página guarda rolagem e filtros; a nova
// os aplica antes do 1º desenho (filtros) e logo depois (rolagem, quando a lista já
// tem altura). Chamado pelo script do servidor (window.__antesRecarga).
window.__antesRecarga = () => {
    try {
        const tb = document.querySelector("table");
        sessionStorage.setItem("__recarga_auto__", JSON.stringify({
            ts: Date.now(), url: location.pathname + location.search,
            y: Math.round(window.scrollY || 0), tabela: tb ? Math.round(tb.scrollTop || 0) : 0,
            // posição DENTRO da lista (o topo pode mudar de altura na tela nova)
            lista: (() => { const tw = document.querySelector(".tableWrap"); return tw ? Math.round(-tw.getBoundingClientRect().top) : null; })(),
            conteudo: (() => { const c = document.querySelector(".content"); return c ? Math.round(c.scrollTop || 0) : 0; })(),
            q: String((qs("#q") || {}).value || ""), tipo: tipoBusca, vend: vendAtual
        }));
    } catch (e) {}
};
const _recInfo = window.__recargaInfo || null;
if (_recInfo) {
    try {
        const rq = String(_recInfo.q || "").slice(0, 500);
        if (rq && qs("#q")) { qs("#q").value = rq; qAtual = rq.trim(); qInc = parseBusca(qAtual).inc; }
        const rt = String(_recInfo.tipo || "todos");
        const rb = document.querySelector('input[name="tipoBusca"][value="' + rt.replace(/[^a-z0-9-]/gi, "") + '"]');
        if (rb && rt !== "todos") { rb.checked = true; tipoBusca = rt; }
        const rv = String(_recInfo.vend || "");
        if (rv && DADOS.vendas.some(x => x && x.vendedor === rv)) vendAtual = rv;
        _invalidarCtxCache(); calcSomaSel();
    } catch (e) {}
}
renderTudo();
fixHead();
if (_recInfo) {
    try { _atualizarXLimpar(); } catch (e) {}
    // A lista é desenhada em fatias e o topo ainda se ajusta (letra/linhas): reaplica a
    // posição a cada quadro por 1,5 s — relativa ao início da lista, não absoluta. Se a
    // pessoa tocar/rolar nesse meio-tempo, para na hora (nunca briga com o dedo).
    const t0 = Date.now();
    let mexeu = false;
    const parar = () => { mexeu = true; };
    ["touchstart", "wheel", "pointerdown", "keydown"].forEach(ev => window.addEventListener(ev, parar, { passive: true, once: true, capture: true }));
    const rolar = () => {
        if (mexeu) return;
        try {
            const tb = document.querySelector("table"), ct = document.querySelector(".content"), tw = document.querySelector(".tableWrap");
            if (typeof _recInfo.lista === "number" && _recInfo.lista > 0 && tw) {
                const alvo = Math.round(tw.getBoundingClientRect().top + window.scrollY + _recInfo.lista);
                if (Math.abs(window.scrollY - alvo) > 1) window.scrollTo(0, alvo);
            } else if (_recInfo.y > 0 && Math.abs(window.scrollY - _recInfo.y) > 1) window.scrollTo(0, _recInfo.y);
            if (tb && _recInfo.tabela > 0 && Math.abs(tb.scrollTop - _recInfo.tabela) > 1) tb.scrollTop = _recInfo.tabela;
            if (ct && _recInfo.conteudo > 0 && Math.abs(ct.scrollTop - _recInfo.conteudo) > 1) ct.scrollTop = _recInfo.conteudo;
        } catch (e) { return; }
        if (Date.now() - t0 < 1500) requestAnimationFrame(rolar);
    };
    requestAnimationFrame(rolar);
    // Tirar o atributo faria o navegador disparar AGORA as animações de entrada de tudo
    // que já está na tela (piscaria aos 1,5 s). Então os elementos atuais ficam com
    // animação desligada no próprio elemento; os que surgirem depois (lista refeita ao
    // filtrar, painel) animam normal. Janelas e menu ficam de fora (abrem com animação).
    setTimeout(() => {
        try {
            // (durante o atributo toda animação lê "none", então não dá para escolher pelo
            // estilo calculado: vale para tudo dentro da página; janelas/menu/avisos ficam fora de .app)
            document.querySelectorAll(".app, .app *").forEach(el => { el.style.animation = "none"; });
        } catch (e) {}
        document.documentElement.removeAttribute("data-recarga");
    }, 1500);
}
// div.top agora existe (criado por renderTudo).
// Chama iniciar() de forma síncrona: observador registrado +
// executarVerificacao() disparada imediatamente com layout já computado.
if (typeof window.__nc_iniciarResize === "function") {
    window.__nc_iniciarResize();
    delete window.__nc_iniciarResize;
}
// ── UMA LINHA SÓ NO CELULAR (v3.18.0) ───────────────────────────────────────
// Até 680 px: badges do topo, título e contagem da tabela e os dados de cada venda
// tentam ficar numa linha só — se o texto não cabe, a letra diminui (até um mínimo);
// só se nem assim couber, volta ao tamanho normal e quebra linha. Leituras e escritas
// de layout em lote (2-3 cálculos por rodada, não um por elemento). No PC, desfaz tudo.
(() => {
    const MQ = window.matchMedia ? window.matchMedia("(max-width: 680px)") : null;
    const alvosFixos = () => Array.prototype.slice.call(document.querySelectorAll(".top .badges > .badge, .tableTitle, #count"));
    const MIN = (el) => el.classList.contains("tableTitle") ? 11 : 8.5;
    const transborda = (el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 0.5;
    const desfazer = (els) => els.forEach(el => { if (el.hasAttribute("data-linha")) { el.style.fontSize = ""; el.style.whiteSpace = ""; el.removeAttribute("data-linha"); } });
    const ajustar = (els) => {
        els = els.filter(el => el && el.isConnected && el.offsetParent !== null);
        if (!els.length) return;
        els.forEach(el => { el.style.fontSize = ""; el.style.whiteSpace = "nowrap"; el.setAttribute("data-linha", "1"); });
        const base = els.map(el => parseFloat(getComputedStyle(el).fontSize) || 12);
        const med = els.map(el => [el.scrollWidth, el.clientWidth]);
        const tam = els.map((el, i) => {
            const sw = med[i][0], cw = med[i][1];
            if (!(cw > 0) || sw <= cw + 0.5) return 0;
            return Math.max(MIN(el), Math.floor(base[i] * cw / sw * 10) / 10);
        });
        els.forEach((el, i) => { if (tam[i]) el.style.fontSize = tam[i] + "px"; });
        // 2ª tentativa (arredondamentos, espaçamento entre letras): meio pixel a menos.
        const quase = els.map((el, i) => tam[i] && transborda(el) && tam[i] - 0.5 >= MIN(el));
        els.forEach((el, i) => { if (quase[i]) el.style.fontSize = (tam[i] - 0.5) + "px"; });
        // Nem no mínimo coube: tamanho normal e quebra de linha.
        const naoCabe = els.map(el => transborda(el));
        els.forEach((el, i) => { if (naoCabe[i]) { el.style.fontSize = ""; el.style.whiteSpace = "normal"; } });
    };
    const ehCelular = () => !!(MQ && MQ.matches);
    let rafTudo = 0, rafCards = 0, obs = null;
    // As escritas do próprio ajuste (style dos badges) também viram "mutação": descarta
    // esses avisos logo depois, senão o observador chamaria o ajuste em laço.
    const descartarProprios = () => { try { if (obs) obs.takeRecords(); } catch (_) {} };
    const tudo = () => {
        if (rafTudo) return;
        rafTudo = requestAnimationFrame(() => {
            rafTudo = 0;
            try {
                const cards = Array.prototype.slice.call(document.querySelectorAll("#cards .cardMeta, #cards .cardPay"));
                if (!ehCelular()) desfazer(alvosFixos().concat(cards));
                else ajustar(alvosFixos().concat(cards));
            } catch (_) { /* cosmético — nunca derruba a página */ }
            descartarProprios();
        });
    };
    // Cartões novos (a lista é desenhada em fatias): só os que ainda não foram ajustados.
    const novosCards = () => {
        if (rafCards || !ehCelular()) return;
        rafCards = requestAnimationFrame(() => {
            rafCards = 0;
            try { ajustar(Array.prototype.slice.call(document.querySelectorAll("#cards .cardMeta:not([data-linha]), #cards .cardPay:not([data-linha])"))); } catch (_) {}
        });
    };
    try {
        const cardsEl = document.getElementById("cards");
        if (cardsEl) new MutationObserver(novosCards).observe(cardsEl, { childList: true });
        obs = new MutationObserver((lista) => {
            // Mudanças de estilo nos próprios badges vêm dos ajustes de layout (este e o
            // antigo do topo, que oculta a hora) — reagir a elas criaria um laço entre os
            // dois. Textos e as partes do total aparecendo/sumindo, sim, pedem novo ajuste.
            if (lista.some(r => r.type !== "attributes" || !(r.target.classList && r.target.classList.contains("badge")))) tudo();
        });
        const badges = document.querySelector(".top .badges"); if (badges) obs.observe(badges, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["style"] });
        const sub = document.getElementById("sub"); if (sub) obs.observe(sub, { childList: true, characterData: true, subtree: true });
        const cnt = document.getElementById("count"); if (cnt) obs.observe(cnt, { childList: true, characterData: true, subtree: true });
        window.addEventListener("resize", tudo, { passive: true });
        if (MQ && MQ.addEventListener) MQ.addEventListener("change", tudo);
        try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(tudo).catch(() => {}); } catch (_) {}
        window.__linhaUnica = tudo;
        tudo(); setTimeout(tudo, 600);
    } catch (_) {}
})();
// ── AUTO-TESTE no navegador (v3.1.0) ─────────────────────────────────────
// Junta o resultado do auto-teste do servidor (DADOS.autoteste, calculado na geração) com
// uma conferência do que ESTÁ NA TELA agora — que pode diferir do servidor depois das
// decisões do painel "Duplicatas" (linhas reconstituídas + totais ajustados à mão).
// Sem ação do usuário: avisa por caixa de mensagem (toast) só quando o conjunto de alertas
// muda, e mantém o botão "Auto-teste" para rever a lista a qualquer momento.
// Nunca pode derrubar o relatório: tudo em try/catch.
const LS_AUTOTESTE_VISTO = "__autoteste_visto__::";
const executarAutoTesteCliente = () => {
    const achados = [];
    const vendas = Array.isArray(DADOS.vendas) ? DADOS.vendas : [];
    const fmtR = n => "R$ " + Number(n || 0).toFixed(2).replace(".", ",");
    const tol = 0.005;
    const soma = vendas.reduce((a, v) => a + (Number(v && v.total) || 0), 0);
    const totais = DADOS.totais || {};
    if (Math.abs(Number(totais.total || 0) - soma) > tol) {
        achados.push({ nivel: "critico", codigo: "TOTAL_DIA_DIVERGE_NAVEGADOR",
            msg: "Na tela, o total do dia (" + fmtR(totais.total) + ") não bate com a soma das vendas listadas (" + fmtR(soma) + ")." });
    }
    const td = DADOS.totaisDia;
    if (td && td.ok) {
        const porTipo = Number(td.gerencial || 0) + Number(td.nfce || 0) + Number(td.nfe || 0);
        if (Math.abs(porTipo - soma) > tol) {
            achados.push({ nivel: "critico", codigo: "TOTAL_TIPO_DIVERGE_NAVEGADOR",
                msg: "Na tela, Gerencial + NFC-e + NF-e (" + fmtR(porTipo) + ") não bate com a soma das vendas (" + fmtR(soma) + ")." });
        }
    }
    const porVend = Array.isArray(DADOS.vendTotaisDia) ? DADOS.vendTotaisDia : [];
    const somaVend = porVend.reduce((a, x) => a + (Number(x && x.geral) || 0), 0);
    if (porVend.length && Math.abs(somaVend - soma) > tol) {
        achados.push({ nivel: "critico", codigo: "TOTAL_VENDEDOR_DIVERGE_NAVEGADOR",
            msg: "Na tela, a soma por vendedor (" + fmtR(somaVend) + ") não bate com a soma das vendas (" + fmtR(soma) + ")." });
    }
    const vistos = new Set(), repetidos = [];
    for (const v of vendas) {
        const chave = String(v && v.tipo) + "|" + String((v && v.numero) || "").replace(/^0+/, "") + "|" + String((v && v._dtKey) || "");
        if (vistos.has(chave)) repetidos.push(v.tipo + " " + v.numero); else vistos.add(chave);
    }
    if (repetidos.length) {
        achados.push({ nivel: "critico", codigo: "DOCUMENTO_REPETIDO_NAVEGADOR",
            msg: "Na tela, documento listado mais de uma vez: " + repetidos.slice(0, 5).join(", ") + "." });
    }
    return achados;
};

const abrirAutoTeste = (todos, verificacoes) => {
    if (document.getElementById("ovAuto")) return; // guarda contra abertura dupla
    const bg = document.createElement("div"); bg.className = "ov"; bg.id = "ovAuto"; bg.setAttribute("aria-hidden", "false");
    // fechar/escKey ANTES de qualquer uso; consultas escopadas em bg (o bg só entra no
    // documento depois de montado) — mesma ordem do painel de Duplicatas.
    const escKey = e => { if (e.key === "Escape") fechar(); };
    const fechar = () => { document.removeEventListener("keydown", escKey); _fecharOverlayAnimado(bg); };
    const cor = { critico: "var(--st-crit)", aviso: "var(--st-warn)", info: "var(--st-info)" };
    const rotulo = { critico: "crítico", aviso: "aviso", info: "informativo" };
    const ordem = { critico: 0, aviso: 1, info: 2 };
    const itens = todos.slice().sort((a, b) => (ordem[a.nivel] - ordem[b.nivel]));
    const linha = a => '<div style="padding:9px 10px;border-bottom:1px solid var(--line-soft);font-size:13px">'
        + '<span style="color:' + (cor[a.nivel] || cor.info) + '">● ' + esc(rotulo[a.nivel] || a.nivel) + '</span> '
        + '<b>' + esc(a.codigo) + '</b> <span style="opacity:.55">(' + esc(a.origem) + ')</span>'
        + '<div style="margin-top:3px;opacity:.9">' + esc(a.msg) + '</div></div>';
    const corpo = itens.length === 0
        ? '<div style="padding:16px;opacity:.75;font-size:13px">Nenhum problema encontrado nesta geração.</div>'
        : itens.map(linha).join("");
    bg.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><div class="mhead"><div><div class="mtitle">Auto-teste</div>'
        + '<div class="msub">' + esc(verificacoes) + ' verificações no servidor + conferência da tela. Roda sozinho a cada atualização.</div></div>'
        + '<div class="btn" id="autoFechar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Fechar</div></div>'
        + '<div class="mbody" style="max-height:60vh;overflow:auto;padding-top:0">' + corpo + '</div></div>';
    bg.querySelector("#autoFechar").addEventListener("click", fechar);
    bg.addEventListener("click", e => { if (e.target === bg) fechar(); });
    document.body.appendChild(bg);
    void bg.offsetWidth;
    bg.classList.add("on");
    document.addEventListener("keydown", escKey);
};

const iniciarAutoTeste = () => {
    const doServidor = (DADOS.autoteste && Array.isArray(DADOS.autoteste.achados)) ? DADOS.autoteste.achados : [];
    const verificacoes = (DADOS.autoteste && Number(DADOS.autoteste.verificacoes)) || 0;
    const doNavegador = executarAutoTesteCliente();
    const todos = doServidor.map(a => ({ nivel: a.nivel, codigo: a.codigo, msg: a.msg, origem: "servidor" }))
        .concat(doNavegador.map(a => ({ nivel: a.nivel, codigo: a.codigo, msg: a.msg, origem: "navegador" })));
    const alertas = todos.filter(a => a.nivel !== "info");
    const btn = document.getElementById("btnAutoteste");
    if (btn) {
        btn.addEventListener("click", () => abrirAutoTeste(todos, verificacoes));
        if (alertas.length) {
            btn.style.display = "";
            const temCritico = alertas.some(a => a.nivel === "critico");
            btn.style.color = temCritico ? "var(--st-crit)" : "var(--st-warn)";
            const badge = document.getElementById("badgeAutoteste");
            if (badge) badge.textContent = "(" + alertas.length + ")";
        }
    }
    // Aviso por caixa de mensagem só quando o conjunto de alertas MUDA (o relatório
    // recarrega a cada venda nova — repetir o toast a cada recarga seria ruído).
    let chaveVisto = LS_AUTOTESTE_VISTO + String(DADOS.data || "");
    const assinatura = alertas.map(a => a.codigo + ":" + a.msg).join("|");
    let anterior = null;
    try { anterior = localStorage.getItem(chaveVisto); } catch (e) { anterior = null; }
    if (!alertas.length) {
        try { localStorage.removeItem(chaveVisto); } catch (e) { /* sem storage: só perde a memória do aviso */ }
        return;
    }
    if (anterior === assinatura) return;
    try { localStorage.setItem(chaveVisto, assinatura); } catch (e) { /* idem */ }
    const crit = alertas.filter(a => a.nivel === "critico").length;
    const texto = alertas.length === 1
        ? (crit ? "⚠ " : "") + alertas[0].msg
        : (crit ? "⚠ " : "") + alertas.length + " alertas (" + crit + " crítico(s)) — abra o botão Auto-teste para ver";
    toast("Auto-teste", texto.length > 220 ? texto.slice(0, 217) + "..." : texto);
    // Problema visto SÓ no navegador não chega ao log do servidor sozinho: reporta uma vez.
    for (const a of doNavegador) {
        try {
            fetch("/api/log-error", { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ msg: "AUTOTESTE(navegador) " + a.codigo + ": " + a.msg, src: String(location.pathname) }) }).catch(() => {});
        } catch (e) { /* relatório offline/sem fetch: sem log remoto */ }
    }
};
try { iniciarAutoTeste(); } catch (erroAutoTeste) { console.error("Auto-teste falhou (o relatório segue normal):", erroAutoTeste); }
</script>
</body></html>`;
// PRECISÃO FIX (v2.6.4): gravação atômica do HTML (arquivo temporário +
// rename) em vez de writeFileSync direto no destino. Motivo concreto: o
// fast-poll de servidor-relatorio.js MATA gerações em andamento de propósito
// (kill-and-restart) sempre que chega venda nova durante uma geração — é o
// comportamento normal em horário de movimento, não uma exceção rara. Com
// escrita direta, um kill que caísse no meio do writeFileSync deixava o
// arquivo de destino truncado no disco. O rename é atômico no nível do
// sistema de arquivos, então o destino nunca existe pela metade: ou é o
// HTML anterior (íntegro), ou o novo (íntegro). O tmp leva o PID no nome
// para nunca colidir com outra geração rodando em paralelo (relatórios de
// período são gerados em processos separados e simultâneos).
try {
    const _tmpSaida = saida + ".tmp" + process.pid;
    try {
        fs.writeFileSync(_tmpSaida, html, "utf8");
        fs.renameSync(_tmpSaida, saida);
    } catch (eAtomico) {
        // Fallback: se o rename falhar (destino travado por antivírus/indexador
        // do Windows, ou tmp e destino em volumes diferentes), grava direto —
        // melhor um relatório gravado de forma não-atômica que nenhum.
        tentarSilencioso(() => { if (fs.existsSync(_tmpSaida)) fs.unlinkSync(_tmpSaida); });
        fs.writeFileSync(saida, html, "utf8");
    }
} catch (eWrite) {
    clearTimeout(_globalTimeout); _dbRef = null;
    tentarSilencioso(() => db.detach());
    console.log("ERRO ao gravar '" + saida + "': " + eWrite.message);
    process.exit(1);
}
    tick("arquivo gravado");

    // Persiste cache de horas fixadas somente quando houve nova entrada,
    // evitando escrita desnecessária em disco a cada execução.
    if (_horaChavesAlteradas.size > 0 || _horaSituacoes.size > 0) {
        try {
            // CONCORRÊNCIA FIX (v2.8.0): este arquivo é gravado também pelo
            // servidor e por outras gerações rodando em paralelo. Antes, aqui
            // se gravava _horaCache INTEIRO — a cópia lida no início desta
            // execução — apagando qualquer entrada gravada por outro processo
            // nesse intervalo. Agora relê o disco (estado mais recente), mantém
            // só o dia atual e aplica apenas as chaves que ESTA execução criou
            // ou migrou. Se outro processo já gravou a mesma chave no formato
            // novo ({tipo,hora}), a dele prevalece: a hora fixada é a da
            // primeira visão, e reescrevê-la faria a venda "pular" de horário.
            let _disco = {};
            try {
                const _rawDisco = fs.readFileSync(_horaCacheFile, "utf8").replace(/^\uFEFF/, "");
                const _pDisco = JSON.parse(_rawDisco);
                if (_pDisco && typeof _pDisco === "object" && !Array.isArray(_pDisco)) _disco = _pDisco;
            } catch (_) { /* ausente/corrompido: começa só com as chaves desta execução */ }
            const _final = Object.create(null);
            for (const [k, val] of Object.entries(_disco)) {
                if (k.startsWith(_hojeISO + "|")) _final[k] = val;
            }
            for (const k of _horaChavesAlteradas) {
                const _atual = _final[k];
                const _discoTemFormatoNovo = _atual && typeof _atual === "object" && !Array.isArray(_atual);
                if (!_discoTemFormatoNovo) _final[k] = _horaCache[k];
            }
            // SITUAÇÃO (v3.8.0): venda com hora fixada que foi cancelada ou
            // convertida (gerencial → NFC-e/NF-e) ganha "situacao" (e
            // "convertidaEm"); se voltou a ficar ativa, os campos saem. A hora
            // fixada nunca muda aqui. Só chaves que já existem no arquivo.
            let _mudouSituacao = false;
            for (const [k, sit] of _horaSituacoes) {
                const _ent = _final[k];
                if (_ent === undefined) continue;
                const _obj = (_ent && typeof _ent === "object" && !Array.isArray(_ent))
                    ? Object.assign({}, _ent) : _normalizarEntradaHoraCache(_ent);
                const _antes = JSON.stringify([_obj.situacao || null, _obj.convertidaEm || null]);
                if (sit) {
                    _obj.situacao = sit.situacao;
                    if (sit.convertidaEm) _obj.convertidaEm = sit.convertidaEm; else delete _obj.convertidaEm;
                } else {
                    delete _obj.situacao; delete _obj.convertidaEm;
                }
                if (JSON.stringify([_obj.situacao || null, _obj.convertidaEm || null]) !== _antes) {
                    _final[k] = _obj; _mudouSituacao = true;
                }
            }
            if (_horaChavesAlteradas.size === 0 && !_mudouSituacao) throw { semMudanca: true };
            // ORDENAÇÃO: reordena por tipo/número antes de gravar — ver
            // comentário completo em _ordenarHoraCache, acima.
            const _json = JSON.stringify(_ordenarHoraCache(_final), null, 2);
            // Gravação atômica (tmp + rename): este processo pode levar kill do
            // fast-poll no meio da escrita; o arquivo nunca fica pela metade.
            const _tmpCache = _horaCacheFile + ".tmp" + process.pid;
            try {
                fs.writeFileSync(_tmpCache, _json, "utf8");
                fs.renameSync(_tmpCache, _horaCacheFile);
            } catch (eAtomicoCache) {
                tentarSilencioso(() => { if (fs.existsSync(_tmpCache)) fs.unlinkSync(_tmpCache); });
                fs.writeFileSync(_horaCacheFile, _json, "utf8");
            }
        } catch (e) {
            // {semMudanca:true}: nada novo para gravar (nem hora nem situação).
            if (!(e && e.semMudanca)) console.warn("Aviso: não foi possível salvar hora-fixada-cache.json —", e && e.message);
        }
    }

    // Aviso de pronto (v3.6.0): HTML e cache de horas já estão gravados. O
    // servidor conclui a geração e avisa o navegador NESTE momento, sem esperar
    // o fechamento das conexões abaixo (~100 ms). Linha exata, sozinha.
    if (_correcoesHora.length) {
        tentarSilencioso(() => process.stdout.write("@@CORRECOES_HORA@@" + JSON.stringify(_correcoesHora.slice(0, 200)) + "\n"));
    }
    tentarSilencioso(() => process.stdout.write("@@RELATORIO_PRONTO@@\n"));
    clearTimeout(_globalTimeout);
    _dbRef = null;
    // PRECISÃO FIX (v2.6.4): detach() sem try/catch AQUI, no caminho de
    // SUCESSO, era capaz de transformar uma geração bem-sucedida em falha.
    // Neste ponto o HTML já foi gravado em disco e o cache de hora já foi
    // salvo — só falta encerrar a conexão. Se detach() lançasse (conexão já
    // derrubada pelo servidor Firebird, rede caindo no exato momento, etc.),
    // a exceção subia para o .catch() de rodar(), que imprime "ERRO FATAL" e
    // faz process.exit(1). Como servidor-relatorio.js detecta falha por
    // "code !== 0", ele descartava um relatório PERFEITO e mandava regerar,
    // até 5 vezes (MAX_TENTATIVAS_SPAWN) — desperdício puro, e o usuário
    // esperando por algo que já estava pronto. Fechar a conexão é
    // best-effort: o processo encerra logo em seguida e o SO libera o socket
    // de qualquer forma.
    tentarSilencioso(() => db.detach());
    console.log("OK: " + saida);
    });
    };
    rodar().catch(e => {
        clearTimeout(_globalTimeout);
        console.log("ERRO FATAL em rodar(): " + String(e && e.message || e));
        tentarSilencioso(() => { if (_dbRef) { _dbRef.detach(); _dbRef = null; } });
        process.exit(1);
    });
})();