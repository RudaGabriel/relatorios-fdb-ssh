"use strict";
// Firebird simulado para os testes automáticos (substitui "node-firebird").
// O estado do "banco" vem de estado.json na pasta de trabalho do teste e cada
// UPDATE/geração é registrado em sql.log — os testes leem esses dois arquivos.
// Só responde às consultas que o servidor e o gerador realmente fazem; as
// demais devolvem lista vazia.
const fs = require("fs");
const path = require("path");

const RAIZ = process.env.MOCK_FB_DIR || process.cwd();
const ESTADO = path.join(RAIZ, "estado.json");
const LOG = path.join(RAIZ, "sql.log");

const lerEstado = () => {
    try { return JSON.parse(fs.readFileSync(ESTADO, "utf8")); }
    catch (_) { return { nfce: [], pag: [], ger: [] }; }
};
const registrar = linha => { try { fs.appendFileSync(LOG, linha + "\n"); } catch (_) {} };
const hojeUTC = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); };

function query(sql, params, cb) {
    const st = lerEstado();
    const s = String(sql).replace(/\s+/g, " ").trim();
    setImmediate(() => {
        try {
            if (/^UPDATE/i.test(s)) { registrar("UPDATE " + JSON.stringify(params) + " :: " + s.slice(0, 40)); return cb(null, []); }
            if (/AS VELHA FROM nfce/i.test(s))     return cb(null, (st.nfce || []).filter(r => (r.modelo || 65) !== 99).map(r => ({ NUMERO: r.numero, VELHA: r.hora < params[0] ? 1 : 0 })));
            if (/AS VELHA FROM pagament/i.test(s)) return cb(null, (st.pag || []).map(r => ({ NUMERO: r.numero, VELHA: r.hora < params[0] ? 1 : 0 })));
            // Aplica o mesmo filtro de janela do SQL real:
            // hora > agora (futuro) OU (hora >= início da janela E hora < agora).
            // params: [dh, dh, horaAtual, horaLimiteJanela, horaAtual]
            if (/AS HORA_VAL/.test(s)) return cb(null, (st.ger || [])
                .filter(r => r.hora > params[2] || (r.hora >= params[3] && r.hora < params[4]))
                .map(r => ({ NUMERO: r.numero, HORA_VAL: r.hora, CANC: "N", TOT: 10 })));
            // (antes do esquema: esta consulta também cita RDB$RELATION_NAME IN (...))
            // Índices (catálogo): estado.semIndice=true simula banco sem nenhum
            // índice; estado.indices=["NFCE.DATA", ...] só os listados.
            if (/RDB\$INDEX_SEGMENTS/.test(s)) {
                if (st.semIndice) return cb(null, []);
                const lista = st.indices || ["NFCE.DATA", "PAGAMENT.DATA", "VENDAS.SAIDAD"];
                return cb(null, lista.map(x => ({ T: x.split(".")[0], C: x.split(".")[1] })));
            }
            // Fast-poll completo (servidor v2.12.0): esquema das tabelas e a consulta
            // por tipo com assinatura. estado.semHash=true simula um Firebird que
            // recusa a consulta completa (o servidor deve cair no modo básico).
            if (/RDB\$RELATION_NAME\) IN \('NFCE','PAGAMENT','VENDAS'\)/.test(s)) {
                const esq = {
                    NFCE: ["DATA", "TOTAL", "NUMERONF", "GERENCIAL", "CAIXA", "VENDEDOR", "MODELO", "CANCELADO", "HORA"],
                    PAGAMENT: ["DATA", "VALOR", "PEDIDO", "FORMA", "CAIXA"],
                    VENDAS: st.vendas ? ["SAIDAD", "NUMERONF", "TOTAL", "MODELO", "VENDEDOR"] : []
                };
                const linhas = [];
                Object.keys(esq).forEach(t => esq[t].forEach(c => linhas.push({ T: t, C: c })));
                return cb(null, linhas);
            }
            // Servidor v2.15.0+: a consulta pode trazer qualquer combinação das
            // tabelas (NFCE tem G_SIG, PAGAMENT tem PAG_SIG, VENDAS tem NFV_SIG) —
            // devolve só os campos das tabelas consultadas.
            if (/\bG_SIG|PAG_SIG|NFV_SIG/.test(s)) {
                if (st.semHash) return cb(new Error("Function unknown: HASH"));
                const h = txt => { let x = 0; for (const ch of String(txt)) x = (x * 31 + ch.charCodeAt(0)) % 1000003; return x; };
                const o = {};
                const tipo = m => m === 99 ? "G" : m === 65 ? "NFC" : m === 55 ? "NF" : "OUT";
                ["G", "NFC", "NF", "OUT"].forEach(t => { o[t + "_QT"] = 0; o[t + "_TOT"] = 0; o[t + "_SIG"] = 0; });
                o.N_CANC = 0; o.N_PEND = 0; o.N_SVEND = 0;
                for (const r of st.nfce || []) {
                    const m = r.modelo || 65, v = r.total === undefined ? 10 : r.total, canc = r.cancelado ? 1 : 0;
                    const vend = r.vendedor === undefined ? "ANA" : r.vendedor;
                    o.N_CANC += canc;
                    if (!canc && v > 0) {
                        const t = tipo(m);
                        o[t + "_QT"]++; o[t + "_TOT"] += v;
                        o[t + "_SIG"] += h([r.numero, r.gerencial || "", "1", v, vend, m].join("|"));
                        if (!vend) o.N_SVEND++;
                    } else if (!canc && (m === 65 || m === 55)) o.N_PEND++;
                }
                const pag = st.pag || [];
                o.PAG_QT = pag.length; o.PAG_TOT = pag.reduce((a, r) => a + (r.valor || 10), 0); o.PAG_N = pag.length;
                o.PAG_SIG = pag.reduce((a, r) => a + h([r.numero, "1", r.forma || "01 DINHEIRO", r.valor || 10].join("|")), 0);
                o.PAG_SFORMA = 0;
                const vd = st.vendas || [];
                o.NFV_QT = vd.length; o.NFV_TOT = vd.reduce((a, r) => a + (r.total || 10), 0);
                o.NFV_SIG = vd.reduce((a, r) => a + h([r.numero, r.total || 10, r.vendedor || ""].join("|")), 0); o.NFV_CANC = 0;
                const temN = /\bG_SIG/.test(s), temP = /PAG_SIG/.test(s), temV = /NFV_SIG/.test(s);
                Object.keys(o).forEach(k => {
                    const tab = /^PAG_/.test(k) ? temP : /^NFV_/.test(k) ? temV : temN;
                    if (!tab) delete o[k];
                });
                return cb(null, [o]);
            }
            if (/FP_QT/.test(s)) return cb(null, [{ FP_QT: (st.nfce || []).length, FP_TOT: (st.nfce || []).length * 10, FP_PEND: 0, FP_SVEND: 0, FP_SFORMA: 0 }]);
            if (/QT_G/.test(s))  return cb(null, [{ QT_G: 0, TOT_G: 0, QT_NFC: (st.nfce || []).length, TOT_NFC: (st.nfce || []).length * 10, QT_NF: 0, TOT_NF: 0, QT_PAG: 0, TOT_PAG: 0 }]);
            if (/rdb\$relation_fields rf/i.test(s) && params[0] === "NFCE")
                return cb(null, ["NUMERONF", "GERENCIAL", "HORA", "CANCELADO", "MODELO", "VENDEDOR"].map(c => ({ C: c })));
            // ALTERACA (itens das vendas): estado.alt = [{ pedido, desc, qtd, total }].
            // "pedido" e' o numero (ou gerencial) da venda em estado.nfce.
            if (/rdb\$relation_fields rf/i.test(s) && params[0] === "ALTERACA")
                return cb(null, ["DATA", "PEDIDO", "CAIXA", "DESCRICAO", "QUANTIDADE", "TOTAL", "ITEM"].map(c => ({ C: c })));
            if (/from ALTERACA where DATA between/i.test(s))
                return cb(null, (st.alt || []).map(r => ({
                    DATA: hojeUTC(), PED: String(r.pedido), CX: "1", DESCRICAO: r.desc, QUANTIDADE: r.qtd || 1,
                    VENDEDOR_ALT: null, HORA_ALT: "", TOTAL_ITEM: r.total === undefined ? null : r.total
                })));
            if (/from nfce n where n.data between/i.test(s)) {
                registrar("GERACAO");
                // estado.atrasoGeracaoMs: simula banco lento na consulta da geração.
                const _resp = (st.nfce || []).map(r => ({
                    // r.canc: "S" = cancelada, "T" = gerencial convertida (vínculo na coluna
                    // GERENCIAL da NFC-e/NF-e nova, r.gerencial).
                    DATA: hojeUTC(), MODELO: r.modelo || 65, TOTAL: r.total === undefined ? 10 : r.total, CAIXA: "1", VENDEDOR_NFCE: "ANA",
                    CANC: r.canc || "N", SIT: "", EMI: "", HORA: r.hora, CLI_NOME: "", NAT_OP: "",
                    VAL_NUMERONF: r.numero, VAL_GERENCIAL: r.gerencial || null
                }));
                return st.atrasoGeracaoMs ? setTimeout(() => cb(null, _resp), st.atrasoGeracaoMs) : cb(null, _resp);
            }
            return cb(null, []);
        } catch (e) { cb(e); }
    });
}

// Imita o node-firebird 1.x: db.connection.startTransaction(opções, cb). Toda
// transação que NÃO for somente leitura (readOnly) é registrada em sql.log como
// "TX_ESCRITA" — os testes exigem que isso nunca aconteça.
const novaTransacao = opcoes => {
    const ro = !!(opcoes && typeof opcoes === "object" && !Array.isArray(opcoes) && opcoes.readOnly);
    if (!ro) registrar("TX_ESCRITA " + JSON.stringify(opcoes));
    return { query, execute: query, commit(c) { if (c) c(); }, rollback(c) { if (c) c(); } };
};
const novaConexao = () => {
    const connection = { startTransaction(opcoes, cb) { if (typeof opcoes === "function") { cb = opcoes; opcoes = null; } setImmediate(() => cb(null, novaTransacao(opcoes))); } };
    return {
        connection,
        // db.query direto (sem transação explícita) = transação padrão de ESCRITA no driver real.
        query(sql, params, cb) { registrar("TX_ESCRITA db.query"); return query(sql, params, cb); },
        detach(cb) { if (cb) cb(); },
        transaction(opcoes, cb) { connection.startTransaction(opcoes, cb); }
    };
};

module.exports = {
    attach(opts, cb) {
        const esperada = process.env.MOCK_SENHA || "masterkey";
        if (opts.password !== esperada) return setImmediate(() => cb(new Error("senha incorreta")));
        if (/offline/.test(String(opts.database)) && !fs.existsSync(path.join(RAIZ, "online.flag")))
            return setImmediate(() => cb(new Error("offline")));
        setImmediate(() => cb(null, novaConexao()));
    },
    ISOLATION_READ_UNCOMMITTED: [15, 17],
    ISOLATION_READ_COMMITTED: [15, 18],
    ISOLATION_READ_COMMITTED_READ_ONLY: [15, 18]
};
