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
            if (/AS HORA_VAL/.test(s))             return cb(null, (st.ger || []).map(r => ({ NUMERO: r.numero, HORA_VAL: r.hora, CANC: "N", TOT: 10 })));
            if (/FP_QT/.test(s)) return cb(null, [{ FP_QT: (st.nfce || []).length, FP_TOT: (st.nfce || []).length * 10, FP_PEND: 0, FP_SVEND: 0, FP_SFORMA: 0 }]);
            if (/QT_G/.test(s))  return cb(null, [{ QT_G: 0, TOT_G: 0, QT_NFC: (st.nfce || []).length, TOT_NFC: (st.nfce || []).length * 10, QT_NF: 0, TOT_NF: 0, QT_PAG: 0, TOT_PAG: 0 }]);
            if (/rdb\$relation_fields rf/i.test(s) && params[0] === "NFCE")
                return cb(null, ["NUMERONF", "GERENCIAL", "HORA", "CANCELADO", "MODELO", "VENDEDOR"].map(c => ({ C: c })));
            if (/from nfce n where n.data between/i.test(s)) {
                registrar("GERACAO");
                return cb(null, (st.nfce || []).map(r => ({
                    DATA: hojeUTC(), MODELO: r.modelo || 65, TOTAL: 10, CAIXA: "1", VENDEDOR_NFCE: "ANA",
                    CANC: "N", SIT: "", EMI: "", HORA: r.hora, CLI_NOME: "", NAT_OP: "",
                    VAL_NUMERONF: r.numero, VAL_GERENCIAL: r.gerencial || null
                })));
            }
            return cb(null, []);
        } catch (e) { cb(e); }
    });
}

const novaConexao = () => ({
    query,
    detach(cb) { if (cb) cb(); },
    transaction(_iso, cb) { cb(null, { query, rollback(c) { if (c) c(); } }); }
});

module.exports = {
    attach(opts, cb) {
        const esperada = process.env.MOCK_SENHA || "masterkey";
        if (opts.password !== esperada) return setImmediate(() => cb(new Error("senha incorreta")));
        if (/offline/.test(String(opts.database)) && !fs.existsSync(path.join(RAIZ, "online.flag")))
            return setImmediate(() => cb(new Error("offline")));
        setImmediate(() => cb(null, novaConexao()));
    },
    ISOLATION_READ_UNCOMMITTED: 1,
    ISOLATION_READ_COMMITTED: 2
};
