"use strict";

/**
 * servidor-relatorio.js
 *
 * - Auto-deteccao do FDB no sistema local
 * - Auto-descoberta do IP do servidor Firebird na rede (scan porta 3050)
 * - SSE /api/events: notifica abas abertas quando dados mudam (reload)
 * - /api/navigate/hoje  /api/navigate/periodo/D1/D2: foco de aba pelo tray
 * - /api/sse-clients: quantas abas SSE abertas (usado pelo tray)
 * - /api/status: qt e total do dia para polling do browser
 * - /api/db-status: status da conexao
 * - pollInterval lido do config.json (padrao 1000 ms, minimo 200 ms)
 * - extrairStatusDoHtml le <script id="dados"> para valores corretos
 * - /selecionar-fdb: picker manual do SMALL.FDB quando nao encontrado automaticamente
 * - /api/abrir-picker-fdb: abre dialogo nativo Windows para selecionar .fdb
 * - /api/salvar-fdb: salva caminho FDB no config.json e reinicia conexao
 */

// ===== Logger Global seguro — flush debounced 300ms =====
const _fs = require('fs');
const _util = require('util');
const _path = require('path');
const LOG_PATH = _path.join(__dirname, 'relatorio.log');
// MAX_LOG_LINES é sobrescrito depois que config.json é carregado (ver abaixo)
var MAX_LOG_LINES = 1000;
let _logBuffer = [];
let _logFlushTimer = null;
// Carrega linhas existentes no buffer ao iniciar
try {
    const _existing = _fs.readFileSync(LOG_PATH, "utf8");
    _logBuffer = _existing.split("\n").filter(l => l.trim()).slice(-MAX_LOG_LINES);
} catch(e) {}
function _flushLog() {
    try { _fs.writeFileSync(LOG_PATH, _logBuffer.join("\n") + "\n"); } catch(e) {}
}
function logToFile(...args) {
    try {
        const msg = args.map(a => typeof a === "string" ? a : _util.inspect(a)).join(" ");
        const d = new Date();
        const _p2 = function(n) { return String(n).padStart(2,"0"); };
        const ts = "[" + _p2(d.getDate()) + "-" + _p2(d.getMonth()+1) + "-" + d.getFullYear() + "]";
        _logBuffer.push(ts + " " + msg);
        if (_logBuffer.length > MAX_LOG_LINES) _logBuffer = _logBuffer.slice(-MAX_LOG_LINES);
        clearTimeout(_logFlushTimer);
        _logFlushTimer = setTimeout(_flushLog, 300);
    } catch(e) {}
}

const origLog = console.log, origError = console.error, origWarn = console.warn, origInfo = console.info;
console.log = function(...args) { logToFile(...args); origLog.apply(console, args); };
console.error = function(...args) { logToFile('ERROR:', ...args); origError.apply(console, args); };
console.warn = function(...args) { logToFile('WARN:', ...args); origWarn.apply(console, args); };
console.info = function(...args) { logToFile(...args); origInfo.apply(console, args); };

process.on("uncaughtException", function (err) {
    logToFile("[UNCAUGHT EXCEPTION]", err && (err.stack || err));
    origError("[UNCAUGHT EXCEPTION]", err && (err.stack || err));
    clearTimeout(_logFlushTimer); _flushLog();
});
process.on("unhandledRejection", function (reason) {
    logToFile("[UNHANDLED REJECTION]", reason && (reason.stack || reason));
    origError("[UNHANDLED REJECTION]", reason && (reason.stack || reason));
    clearTimeout(_logFlushTimer); _flushLog();
});
process.on("exit", function() { clearTimeout(_logFlushTimer); _flushLog(); });

var http     = require("http");
var net      = require("net");
var spawn    = require("child_process").spawn;
var path     = require("path");
var fs       = require("fs");
var os       = require("os");

var Firebird = null;
try { Firebird = require("node-firebird"); } catch(e) {}

// ---------------------------------------------------------------------------
// Utilitarios
// ---------------------------------------------------------------------------
var logTs = function(msg) {
    var d=new Date(), p=function(n){return String(n).padStart(2,"0");};
    console.log("["+p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds())+"] "+msg);
};
var hoje = function() {
    var d=new Date(), p=function(n){return String(n).padStart(2,"0");};
    return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());
};
var isoParaBR = function(iso) {
    var m=String(iso||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? (m[3]+"/"+m[2]+"/"+m[1]) : String(iso||"");
};
var escH = function(s) {
    return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;")
        .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
};

// ---------------------------------------------------------------------------
// Argumentos CLI
// ---------------------------------------------------------------------------
var args=process.argv.slice(2);
var pegar=function(k){
    var i=args.indexOf(k);
    return (i>=0&&i+1<args.length)?String(args[i+1]||"").trim():"";
};
var PORT   = parseInt(pegar("--porta")||"7734",10);
var USER   = pegar("--user") || "SYSDBA";
var PASS   = pegar("--pass") || "masterkey";
var SCRIPT = path.join(__dirname,"gerar-relatorio-html.js");
var FAVICON= path.join(__dirname,"favicon.png");
var CONFIG = path.join(__dirname,"config.json");
var TMP    = path.join(os.tmpdir(),"relatorio_srv.html");
var NO_BROWSER = args.includes("--no-browser");
var TMP_DIR    = os.tmpdir();
var HORA_FIXADA_CACHE = path.join(__dirname, "hora-fixada-cache.json");

// ---------------------------------------------------------------------------
// Config persistente
// ---------------------------------------------------------------------------
var loadConfig=function(){
    try{
        var raw=fs.readFileSync(CONFIG,"utf8")
            .replace(/^\uFEFF/,"")
            .replace(/:\s*0+(\d+)/g,": $1");
        return JSON.parse(raw);
    }catch(e){return {};}
};
var saveConfig=function(obj){
    try{
        var rawAtual="";
        try{ rawAtual=fs.readFileSync(CONFIG,"utf8").replace(/^\uFEFF/,"").trim(); }catch(e){}
        var atual={};
        if(rawAtual){
            try{ atual=JSON.parse(rawAtual); }
            catch(e){
                logToFile("WARN saveConfig: JSON inválido no config.json — gravação abortada para preservar dados. Erro: "+e.message);
                return;
            }
        }
        if(typeof atual!=="object"||Array.isArray(atual)) atual={};
        var merged=Object.assign({},atual,obj);
        if(Object.keys(merged).length===0){
            logToFile("WARN saveConfig: merge resultou em objeto vazio — gravação abortada.");
            return;
        }
        fs.writeFileSync(CONFIG,JSON.stringify(merged,null,2),"utf8");
    }catch(e){logToFile("WARN saveConfig: "+e.message);}
};

var updateConfigKey=function(key,value){
    try{
        var rawAtual="";
        try{ rawAtual=fs.readFileSync(CONFIG,"utf8").replace(/^\uFEFF/,"").trim(); }catch(e){}
        var obj={};
        if(rawAtual){
            try{ obj=JSON.parse(rawAtual); }
            catch(e){
                logToFile("WARN updateConfigKey("+key+"): JSON inválido — abortando para não perder dados. Erro: "+e.message);
                return;
            }
        }
        if(typeof obj!=="object"||Array.isArray(obj)) obj={};
        obj[key]=value;
        fs.writeFileSync(CONFIG,JSON.stringify(obj,null,2),"utf8");
    }catch(e){logToFile("WARN updateConfigKey("+key+"): "+e.message);}
};

var appCfg        = loadConfig();
var APP_NAME      = (appCfg.appName&&appCfg.appName.trim()) ? appCfg.appName.trim() : "Relatorios";
var POLL_INTERVAL = (appCfg.pollInterval && parseInt(appCfg.pollInterval,10) >= 100)
    ? parseInt(appCfg.pollInterval,10) : 200; // mínimo absoluto de 100ms — previne loop sem pausa
var TOAST_DURATION = (appCfg.toastDuration && parseInt(appCfg.toastDuration,10)>=500)
    ? parseInt(appCfg.toastDuration,10) : 4000; // ms — duração padrão do toast de notificação
// spawnTimeoutMs configurável via config.json.
// Padrão: 10 s. Mínimo: 5 s. Máximo: 120 s (clamp ampliado — comporta bancos remotos lentos).
// O clamp anterior (10 s) ignorava silenciosamente valores maiores definidos pelo usuário.
var _cfgTms = appCfg.spawnTimeoutMs ? parseInt(appCfg.spawnTimeoutMs, 10) : 10000;
var SPAWN_TIMEOUT_CFG = Math.min(Math.max(isNaN(_cfgTms) ? 10000 : _cfgTms, 5000), 120000);

if (appCfg.maxLogLines && parseInt(appCfg.maxLogLines,10) >= 100) {
    MAX_LOG_LINES = parseInt(appCfg.maxLogLines,10);
}
if (_logBuffer.length > MAX_LOG_LINES) _logBuffer = _logBuffer.slice(-MAX_LOG_LINES);

if (appCfg.porta&&appCfg.porta>0) PORT = parseInt(appCfg.porta,10);

// ---------------------------------------------------------------------------
// Auto-deteccao do caminho FDB
// ---------------------------------------------------------------------------
var _fdbCandidatos=function(){
    var pf86=process.env["ProgramFiles(x86)"]||"C:\\Program Files (x86)";
    var pf  =process.env["ProgramFiles"]      ||"C:\\Program Files";
    var pd  =process.env["ProgramData"]       ||"C:\\ProgramData";
    return [
        pf86+"\\SmallSoft\\Small Commerce\\SMALL.FDB",
        pf  +"\\SmallSoft\\Small Commerce\\SMALL.FDB",
        pd  +"\\SmallSoft\\Small Commerce\\SMALL.FDB",
        "C:\\SmallSoft\\Small Commerce\\SMALL.FDB",
        "C:\\Dados\\SMALL.FDB",
        "C:\\SmallCommerce\\SMALL.FDB",
    ];
};

var detectFdbLocal=function(){
    var cands=_fdbCandidatos();
    for(var i=0;i<cands.length;i++){
        try{
            if(fs.existsSync(cands[i])){
                logTs("FDB local encontrado: "+cands[i]);
                return cands[i];
            }
        }catch(e){}
    }
    return null;
};

var detectFdbPath=function(){
    var local=detectFdbLocal();
    if(local)return local;
    var pf86=process.env["ProgramFiles(x86)"]||"C:\\Program Files (x86)";
    return pf86+"\\SmallSoft\\Small Commerce\\SMALL.FDB";
};

var parseFdb=function(fdb){
    var m=String(fdb||"").match(/^([0-9.]+|[a-zA-Z0-9_-]+):([a-zA-Z]:\\.*|\/.*)/);
    if(m)return{host:m[1],dbPath:m[2]};
    return{host:"127.0.0.1",dbPath:fdb};
};

// detectLocalIP melhorada: ignora adapters virtuais/VPN, usa score por sub-rede
// e aceita fbHostHint para priorizar o IP na mesma /24 do banco.
var detectLocalIP = function(fbHostHint) {
    var ifaces = os.networkInterfaces();
    var SKIP_NAMES = ["vmware","virtualbox","vbox","hyper-v","loopback","pseudo","isatap",
                      "teredo","tunnel","vpn","tap","tun","wsl","docker","radio","bluetooth",
                      "6to4","vethernet"];
    function isSkip(name) {
        var nl = String(name||"").toLowerCase();
        return SKIP_NAMES.some(function(s){ return nl.indexOf(s) >= 0; });
    }
    // Prefixo /24 do host do banco — aumenta score de IPs na mesma sub-rede
    var subnetPrefix = null;
    if (fbHostHint && /^\d{1,3}\.\d{1,3}\.\d{1,3}\./.test(fbHostHint)) {
        subnetPrefix = fbHostHint.split(".").slice(0,3).join(".") + ".";
    }
    var candidates = [];
    for (var n in ifaces) {
        if (isSkip(n)) continue;
        var list = ifaces[n];
        for (var i = 0; i < list.length; i++) {
            var a = list[i];
            var isV4 = (a.family === "IPv4" || a.family === 4);
            if (!isV4 || a.internal || a.address === "127.0.0.1") continue;
            var score = 0;
            if (subnetPrefix && a.address.indexOf(subnetPrefix) === 0) score += 100;
            if (/^192\.168\./.test(a.address))                          score += 10;
            else if (/^10\./.test(a.address))                           score += 5;
            else if (/^172\.(1[6-9]|2\d|3[01])\./.test(a.address))     score += 4;
            candidates.push({addr: a.address, score: score});
        }
    }
    if (!candidates.length) return null;
    candidates.sort(function(a,b){ return b.score - a.score; });
    return candidates[0].addr;
};

var cfg      = loadConfig();
var fdbArg   = pegar("--fdb");

// ---------------------------------------------------------------------------
// logProtegido — evita duplicar linhas fixas no log ao reiniciar no mesmo dia.
// Definido antes da detecção de FDB para que "=== Servidor iniciado ===" seja
// sempre a primeira linha protegida gravada no arquivo de log.
// Zera automaticamente à meia-noite.
// ---------------------------------------------------------------------------
var _logProtSet = new Set();
var _logProtDia = (function() {
    var d = new Date(), p = function(n) { return String(n).padStart(2,"0"); };
    return p(d.getDate()) + "-" + p(d.getMonth()+1) + "-" + d.getFullYear();
})();
try {
    var _logFullRaw = _fs.readFileSync(LOG_PATH, "utf8").split("\n");
    _logFullRaw.forEach(function(linha) {
        if (linha.indexOf("[" + _logProtDia) === 0) {
            var m = linha.match(/^\[[^\]]+\]\s*\[[^\]]+\]\s*(.+)$/);
            if (m) _logProtSet.add(m[1].trim());
        }
    });
} catch(e) {
    _logBuffer.forEach(function(linha) {
        if (linha.indexOf("[" + _logProtDia) === 0) {
            var m = linha.match(/^\[[^\]]+\]\s*\[[^\]]+\]\s*(.+)$/);
            if (m) _logProtSet.add(m[1].trim());
        }
    });
}
(function _agendarResetLogProt() {
    var agora  = new Date();
    var amanha = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1, 0, 0, 3);
    setTimeout(function() {
        _logProtSet.clear();
        _queryLogsHoje = false;
        _nfceCorrigidasHoje.clear();
        _pagCorrigidosHoje.clear();
        _statusChangeTs = 0; // reseta a meia-noite — evita reloads espúrios no dia seguinte
        // Limpa entradas antigas do hora-fixada-cache (dias anteriores ao atual)
        try {
            var _dhHoje = hoje();
            Object.keys(_horaFixadaCache).forEach(function(k) {
                var kDate = k.split("|")[0];
                if (kDate && kDate < _dhHoje) delete _horaFixadaCache[k];
            });
            _salvarHoraFixadaCache();
        } catch(_hfc) {}
        _logProtDia = (function() {
            var d = new Date(), p = function(n) { return String(n).padStart(2,"0"); };
            return p(d.getDate()) + "-" + p(d.getMonth()+1) + "-" + d.getFullYear();
        })();
        _agendarResetLogProt();
    }, amanha.getTime() - agora.getTime());
})();
function logProtegido(msg) {
    if (_logProtSet.has(msg)) return;
    _logProtSet.add(msg);
    logTs(msg);
}

// Flag: linhas de progresso do filho (>>, OK:) só aparecem na 1ª geração do dia.
// Resetado à meia-noite junto com _logProtSet (ver _agendarResetLogProt acima).
var _queryLogsHoje = false;

// ---------------------------------------------------------------------------
// SVG Icons (Lucide-style, stroke="currentColor") — substituem todos os emojis.
// Usados em botões HTML, spans decorativos e innerHTML de elementos de status.
// ---------------------------------------------------------------------------

// Pasta aberta — botões "Procurar" (14 × 14)
var SVG_FOLDER =
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"' +
    ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' +
    ' style="display:inline;vertical-align:-2px;margin-right:5px">' +
    '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5' +
    'H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>' +
    '</svg>';

// Banco de dados — ícone decorativo grande (48 × 48)
var SVG_DATABASE =
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24"' +
    ' fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<ellipse cx="12" cy="5" rx="9" ry="3"/>' +
    '<path d="M3 5v14a9 3 0 0 0 18 0V5"/>' +
    '<path d="M3 12a9 3 0 0 0 18 0"/>' +
    '</svg>';

// Timer / stopwatch — status "encerrando processo" (13 × 13, para innerHTML)
var SVG_TIMER =
    '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"' +
    ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' +
    ' style="display:inline;vertical-align:-2px;margin-right:4px">' +
    '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="2" y2="5"/>' +
    '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/>' +
    '</svg>';

// Seta anti-horária — status "tentativa N/M" (13 × 13, para innerHTML)
var SVG_RETRY =
    '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"' +
    ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' +
    ' style="display:inline;vertical-align:-2px;margin-right:4px">' +
    '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>' +
    '<path d="M3 3v5h5"/>' +
    '</svg>';

// Triângulo de aviso — status "sem resposta" (13 × 13, para innerHTML)
var SVG_WARN =
    '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"' +
    ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' +
    ' style="display:inline;vertical-align:-2px;margin-right:4px">' +
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>' +
    '<line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/>' +
    '</svg>';


var _descreverMudanca = function(qtAntes, qtDepois, totAntes, totDepois) {
    var partes = [];
    if (qtAntes !== qtDepois) {
        // agora mostra qtDepois primeiro, depois o sinal, depois qtAntes
        partes.push("vendas " + qtDepois + (qtDepois > qtAntes ? " > " : " < ") + qtAntes);
    }
    if (Math.abs(totDepois - totAntes) > 0.005) {
        // mesmo padrão: valor depois, sinal, valor antes
        partes.push("total R$" + totDepois.toFixed(2) + (totDepois > totAntes ? " > " : " < ") + "R$" + (totAntes||0).toFixed(2));
    }
    return partes.length ? partes.join(" | ") : "sem diferença detectável";
};

// Compara estado anterior × atual por tipo (G = gerencial, NFC = NFC-e, NF = NF-e).
// Emite ">" quando o valor subiu e "<" quando caiu — detectado via POLL_INTERVAL.
// Retorna {mudou:bool, descricao:string}.
var _descreverMudancaTipo = function(ant, atu) {
    var partes = [];
    var tipos = [
        {chave:"g",   rotulo:"Ger"},
        {chave:"nfc", rotulo:"NFC-e"},
        {chave:"nf",  rotulo:"NF-e"}
    ];
    tipos.forEach(function(t) {
        var a = ant[t.chave], b = atu[t.chave];
        if (!a || a.qt < 0) return;
        if (a.qt !== b.qt) {
            // Agora valor novo primeiro, sinal de comparação, valor antigo
            partes.push(t.rotulo+" vendas "+b.qt+(b.qt > a.qt ? " > " : " < ")+a.qt);
        }
        if (Math.abs(b.tot - a.tot) > 0.005) {
            partes.push(t.rotulo+" total R$"+b.tot.toFixed(2)+(b.tot > a.tot ? " > " : " < ")+"R$"+a.tot.toFixed(2));
        }
    });
    return {mudou: partes.length > 0, descricao: partes.join(" | ")};
};

// Primeira linha protegida — deve aparecer antes de qualquer outro log de inicialização.
(function() {
    var _marcaDia = "=== Servidor iniciado " + isoParaBR(hoje()) + " ===";
    if (!_logProtSet.has(_marcaDia)) {
        _logProtSet.add(_marcaDia);
        logTs(_marcaDia);
        clearTimeout(_logFlushTimer); _flushLog();
    }
})();

var FDB_PATH, FDB_HOST;
if (fdbArg) {
    FDB_PATH = parseFdb(fdbArg).dbPath;
    FDB_HOST = parseFdb(fdbArg).host;
    logTs("FDB via argumento CLI: "+FDB_HOST+":"+FDB_PATH);
} else {
    var _fdbLocal = detectFdbLocal();
    if (_fdbLocal) {
        FDB_PATH = _fdbLocal;
        FDB_HOST = "127.0.0.1";
        logTs("FDB local detectado → conectando em 127.0.0.1");
    } else {
        FDB_PATH = detectFdbPath();
        FDB_HOST = (cfg.fbHost && String(cfg.fbHost).trim()) ? String(cfg.fbHost).trim() : "127.0.0.1";
        logTs("FDB não encontrado localmente → tentando host de rede: "+FDB_HOST);
    }
}
var FDB = FDB_HOST+":"+FDB_PATH;

var _maquinaIPCfg    = (cfg.maquinaIP && String(cfg.maquinaIP).trim()) ? String(cfg.maquinaIP).trim() : null;
var _maquinaIPDetect = detectLocalIP(FDB_HOST);
var _maquinaIP       = _maquinaIPDetect || _maquinaIPCfg || null;
var BIND_ADDR        = _maquinaIP ? "0.0.0.0" : "127.0.0.1";

// ---------------------------------------------------------------------------
// Limite de tamanho para corpos de requisições POST — protege contra DoS.
// ---------------------------------------------------------------------------
var MAX_BODY_BYTES = 512 * 1024; // 512 KB — suficiente para todos os payloads esperados

// Lê o corpo de uma requisição com limite de tamanho.
// Chama cb(null, bodyString) em sucesso ou cb(err) se exceder o limite.
var lerBodySeguro = function(req, cb) {
    var chunks = [], totalBytes = 0, _cbCalled = false;
    var _done = function(err, val) {
        if (_cbCalled) return; // previne double-callback: req.destroy → cb(err) + req.on("error")
        _cbCalled = true;
        cb(err, val);
    };
    req.on("data", function(chunk) {
        if (_cbCalled) return; // descarta chunks após limite excedido
        totalBytes += chunk.length;
        if (totalBytes > MAX_BODY_BYTES) {
            try { req.destroy(); } catch(_) {}
            _done(new Error("Payload muito grande (máx " + MAX_BODY_BYTES + " bytes)."));
            return;
        }
        chunks.push(chunk);
    });
    req.on("end",   function()  { _done(null, Buffer.concat(chunks).toString("utf8")); });
    req.on("error", function(e) { _done(e); });
};

// maquinaIP detectado sempre sobrescreve config.json — garante que mudanças
// de rede (DHCP, troca de adapter) sejam sempre refletidas no próximo boot.
if (_maquinaIPDetect) {
    try { updateConfigKey("maquinaIP", _maquinaIPDetect); } catch(e) {}
    logTs("maquinaIP detectado e salvo: " + _maquinaIPDetect +
          (_maquinaIPCfg && _maquinaIPCfg !== _maquinaIPDetect ? " (substituiu: " + _maquinaIPCfg + ")" : ""));
} else if (_maquinaIPCfg) {
    logTs("maquinaIP não detectado — usando config como fallback: " + _maquinaIPCfg);
} else {
    logTs("AVISO: maquinaIP não detectado e não configurado — acesso externo desabilitado");
}

// ---------------------------------------------------------------------------
// Estado global
// ---------------------------------------------------------------------------
var cache       = Object.create(null);

// Fila de notificações de correção de horário — consumida pelo browser via /api/status.
// O servidor empurra mensagens aqui; o poll do browser esvazia e exibe como toast.
// Uso de splice(0) garante consume-once: cada mensagem aparece uma única vez.
var _correcoesPendentes = [];

// Evict de entradas antigas do cache — mantém no máximo MAX_CACHE_ENTRIES períodos.
// Entradas de hoje e entradas ainda gerando nunca são removidas.
var MAX_CACHE_ENTRIES = 30;
var _evictarCacheAntigo = function() {
    try {
        var dh = hoje();
        var chaves = Object.keys(cache).filter(function(k) {
            return k !== dh && !(cache[k] && cache[k].gerando);
        });
        if (chaves.length <= MAX_CACHE_ENTRIES) return;
        // Remove as mais antigas (ordem lexicográfica funciona para chaves ISO e "ISO|ISO")
        chaves.sort();
        var remover = chaves.slice(0, chaves.length - MAX_CACHE_ENTRIES);
        remover.forEach(function(k) { delete cache[k]; });
    } catch(e) {}
};

// qt/total = totais combinados (compat. com SSE e arScript)
// g / nfc / nf = por tipo — usados pelo poll para detectar > e < por tipo
var statusAtual = {
    qt:-1, total:-1, ts:0,
    g:   {qt:-1, tot:-1},  // gerencial  (modelo=99)
    nfc: {qt:-1, tot:-1},  // NFC-e      (modelo=65)
    nf:  {qt:-1, tot:-1}   // NF-e       (modelo=55)
};
// Timestamp da última mudança detectada (fast-poll ou pollStatus).
// Incluído em /api/status como "changeTs" para o browser comparar com
// _loadTs (quando a página foi carregada). Se changeTs > _loadTs → há
// dados mais novos → reload. Resolve o caso em que _q===d.qt porque o
// HTML já estava atualizado quando o browser carregou a página.
var _statusChangeTs = 0;
var dbStatus    = {ok:false,ip:FDB_HOST,erro:null,scanCompleto:false,scanning:false};

// ---------------------------------------------------------------------------
// Hora-fixada cache — persiste correções de horário gerencial entre reinicializações.
// Chave: "YYYY-MM-DD|numero"  Valor: hora corrigida (string).
// ---------------------------------------------------------------------------
var _horaFixadaCache = (function() {
    try {
        var raw = fs.readFileSync(HORA_FIXADA_CACHE, "utf8").replace(/^\uFEFF/, "");
        var obj = JSON.parse(raw);
        if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
    } catch(e) {}
    return {};
})();

var _salvarHoraFixadaCache = (function() {
    var _timer = null;
    return function() {
        clearTimeout(_timer);
        _timer = setTimeout(function() {
            try {
                fs.writeFileSync(HORA_FIXADA_CACHE, JSON.stringify(_horaFixadaCache, null, 2), "utf8");
            } catch(e) {
                logTs("WARN _salvarHoraFixadaCache: " + e.message);
            }
        }, 500);
    };
})();

// ---------------------------------------------------------------------------
// Flag de aguardo de seleção manual do FDB
// Ativado quando todas as tentativas automáticas falham.
// ---------------------------------------------------------------------------
var _aguardandoFdbManual = false;

// ---------------------------------------------------------------------------
// SSE — clientes conectados
// ---------------------------------------------------------------------------
var sseClients   = [];
var sseIdCounter = 0;

var broadcastSSE = function(data) {
    var msg  = "data: "+JSON.stringify(data)+"\n\n";
    var vivos = [];
    sseClients.forEach(function(c){
        try {
            c.res.write(msg);
            try { if (c.res.socket) { c.res.socket.uncork && c.res.socket.uncork(); } } catch(_f) {}
            vivos.push(c);
        } catch(e) {}
    });
    sseClients = vivos;
    /*if (vivos.length > 0) logTs("SSE enviado para "+vivos.length+" cliente(s).");*/
    return vivos.length;
};

// ---------------------------------------------------------------------------
// Aguarda FDB ficar acessível
// ---------------------------------------------------------------------------
var aguardarFDB = function(onPronto) {
    var MAX_RETRY = 120;
    var RETRY_MS  = 15000;
    var n = 0;

    var tentarHostAtual = function() {
        n++;
        logTs("Verificando banco [" + n + "/" + MAX_RETRY + "] em " + FDB_HOST + "...");
        testarFdb(FDB_HOST, FDB_PATH, function(ok, erro) {
            if (ok) {
                logTs("Banco OK em " + FDB_HOST + " (tentativa " + n + ").");
                dbStatus = {ok:true, ip:FDB_HOST, erro:null, scanCompleto:true, scanning:false};
                updateConfigKey("fbHost", FDB_HOST);
                onPronto(true);
                return;
            }
            if (n < MAX_RETRY) {
                logTs("Banco indisponível (" + (erro||"timeout") + "). Próxima tentativa em "+(RETRY_MS/1000)+"s...");
                setTimeout(tentarHostAtual, RETRY_MS);
            } else {
                logTs("Máximo de tentativas atingido. Iniciando scan de rede...");
                descobrirIPFirebird(function(scanOk) { onPronto(scanOk); });
            }
        });
    };

    var _tryLocal = function(onLocalDone) {
        var _local = detectFdbLocal();
        if (!_local || FDB_HOST === "127.0.0.1") {
            onLocalDone(false);
            return;
        }
        logTs("Arquivo FDB encontrado localmente (" + _local + ") — testando 127.0.0.1 antes da rede...");
        testarFdb("127.0.0.1", _local, function(okLocal) {
            if (okLocal) {
                logTs("Banco local OK em 127.0.0.1! Trocando de " + FDB_HOST + " para local.");
                FDB_PATH = _local;
                FDB_HOST = "127.0.0.1";
                FDB      = "127.0.0.1:" + _local;
                dbStatus = {ok:true, ip:"127.0.0.1", erro:null, scanCompleto:true, scanning:false};
                updateConfigKey("fbHost", "127.0.0.1");
                onLocalDone(true);
            } else {
                logTs("Arquivo local existe mas Firebird local não respondeu — tentando host de rede " + FDB_HOST + "...");
                onLocalDone(false);
            }
        });
    };

    _tryLocal(function(localOk) {
        if (localOk) { onPronto(true); return; }

        testarFdb(FDB_HOST, FDB_PATH, function(okImediato, erroImediato) {
            if (okImediato) {
                dbStatus = {ok:true, ip:FDB_HOST, erro:null, scanCompleto:true, scanning:false};
                updateConfigKey("fbHost", FDB_HOST);
                onPronto(true);
            } else {
                logTs("Banco não respondeu em " + FDB_HOST + " (" + (erroImediato||"timeout") + "). Tentando scan de rede...");
                descobrirIPFirebird(function(scanOk) {
                    if (scanOk) {
                        onPronto(true);
                    } else {
                        logTs("Nenhum servidor Firebird encontrado. Aguardando... (retry a cada " + (RETRY_MS/1000) + "s)");
                        setTimeout(tentarHostAtual, RETRY_MS);
                    }
                });
            }
        });
    });
};
var detectSubnet=function(){
    var ifaces=os.networkInterfaces();
    for(var n in ifaces){
        var list=ifaces[n];
        for(var i=0;i<list.length;i++){
            var a=list[i];
            var isV4=(a.family==="IPv4"||a.family===4);
            if(isV4&&!a.internal){
                var p=a.address.split(".");
                if(p[0]!=="127")return p[0]+"."+p[1]+"."+p[2];
            }
        }
    }
    return null;
};

var scanFirebird=function(subnet,callback){
    logTs("Escaneando "+subnet+".1-254 na porta 3050...");
    var found=[],total=254,done=0,active=0,MAX=40,queue=[];
    for(var i=1;i<=254;i++)queue.push(subnet+"."+i);
    var checkFim=function(){if(done===total)callback(found);else launch();};
    var launch=function(){
        while(active<MAX&&queue.length>0){
            active++;
            (function(ip){
                var sock=new net.Socket(),resolved=false;
                var finish=function(ok){
                    if(resolved)return;resolved=true;
                    sock.destroy();
                    if(ok)found.push(ip);
                    active--;done++;checkFim();
                };
                sock.setTimeout(450);
                sock.on("connect",function(){finish(true);});
                sock.on("error",  function(){finish(false);});
                sock.on("timeout",function(){finish(false);});
                try{sock.connect(3050,ip);}catch(e){finish(false);}
            })(queue.shift());
        }
    };
    launch();
};

var testarFdb=function(host,dbPath,cb){
    if(!Firebird){cb(false,"node-firebird nao disponivel");return;}
    var opts={host:host,port:3050,database:dbPath,user:USER,password:PASS,
              role:null,charset:"UTF8",pageSize:4096};
    // _done previne double-callback: se timeout disparar E attach responder depois,
    // apenas o primeiro vencedor chama cb; o segundo é descartado (e db.detach() é feito).
    var _done=false;
    var t=setTimeout(function(){
        if(_done)return; _done=true;
        cb(false,"Timeout 5s");
    },5000);
    Firebird.attach(opts,function(err,db){
        if(_done){
            // Timeout já disparou: descarta mas fecha conexão para não vazar
            if(!err&&db){try{db.detach();}catch(_){}}
            return;
        }
        _done=true;
        clearTimeout(t);
        if(err){cb(false,String(err.message||err));return;}
        db.detach();cb(true,null);
    });
};

var encontrarIPFirebird=function(ips,cb){
    if(ips.length===0){cb(null);return;}
    var ip=ips.shift();
    testarFdb(ip,FDB_PATH,function(ok){if(ok)cb(ip);else encontrarIPFirebird(ips,cb);});
};

var descobrirIPFirebird=function(onPronto){
    dbStatus.scanning=true;dbStatus.scanCompleto=false;
    testarFdb(FDB_HOST,FDB_PATH,function(ok,erro){
        if(ok){
            logTs("Banco Firebird OK em "+FDB_HOST);
            dbStatus={ok:true,ip:FDB_HOST,erro:null,scanCompleto:true,scanning:false};
            onPronto(true);return;
        }
        logTs("Banco nao respondeu em "+FDB_HOST+" ("+erro+"). Scan de rede...");
        var subnet=detectSubnet();
        if(!subnet){
            dbStatus={ok:false,ip:null,erro:"Nao foi possivel detectar a rede local.",scanCompleto:true,scanning:false};
            onPronto(false);return;
        }
        scanFirebird(subnet,function(found){
            logTs("Hosts com porta 3050: "+(found.length?found.join(", "):"nenhum"));
            if(found.length===0){
                dbStatus={ok:false,ip:null,erro:"Nenhum servidor Firebird em "+subnet+".x:3050.",scanCompleto:true,scanning:false};
                onPronto(false);return;
            }
            encontrarIPFirebird(found.slice(),function(ipOk){
                if(ipOk){
                    logTs("Banco encontrado em "+ipOk+"! Salvando...");
                    FDB_HOST=ipOk; FDB=ipOk+":"+FDB_PATH;
                    dbStatus={ok:true,ip:ipOk,erro:null,scanCompleto:true,scanning:false};
                    updateConfigKey("fbHost", ipOk);
                    onPronto(true);
                } else {
                    var ip1=found[0];
                    FDB_HOST=ip1; FDB=ip1+":"+FDB_PATH;
                    dbStatus={ok:false,ip:ip1,erro:"Porta 3050 em "+ip1+" mas FDB nao respondeu.",scanCompleto:true,scanning:false};
                    onPronto(false);
                }
            });
        });
    });
};

// ---------------------------------------------------------------------------
// Extrai qt/total
// ---------------------------------------------------------------------------
var extrairStatusDoHtml = function(html) {
    var qt = 0, tot = 0;

    var mDados = html.match(/<script[^>]+id=["']dados["'][^>]*>([\s\S]*?)<\/script>/i);
    if (mDados) {
        try {
            var dados = JSON.parse(mDados[1]);
            if (dados && dados.totais) {
                qt  = Number(dados.totais.qtd   || 0);
                tot = Number(dados.totais.total  || 0);
            }
            if (!qt && dados && Array.isArray(dados.vendas)) {
                qt = dados.vendas.length;
                for (var i = 0; i < dados.vendas.length; i++) {
                    var v = dados.vendas[i];
                    tot += Number(v.total_nfce || v.total_pag || v.total || 0);
                }
            }
            return { qt: qt, tot: tot };
        } catch(e) {}
    }

    var mVendas = html.match(/"vendas"\s*:\s*(\[[\s\S]{0,400000}?\])\s*[,}]/);
    if (mVendas) {
        try {
            var arr = JSON.parse(mVendas[1]);
            qt = arr.length;
            for (var j = 0; j < arr.length; j++) {
                var x = arr[j];
                tot += Number(x.total_nfce || x.total_pag || x.gerencial || x.total || 0);
            }
        } catch(e) {
            var n = html.match(/"numero"\s*:/g);
            if (n) qt = n.length;
        }
    }
    return { qt: qt, tot: tot };
};

// ---------------------------------------------------------------------------
// Rastreamento de PIDs dos processos filhos
// Usado pelo /api/restart para matar todos antes de sair.
// ---------------------------------------------------------------------------
var _spawnedPids = [];

// ---------------------------------------------------------------------------
// Timeout máximo para o processo filho gerar o relatório.
// Padrão 10 s, configurável entre 5 s e 120 s via spawnTimeoutMs no config.json.
// Valores fora do range são silenciosamente clampeados (não rejeitados).
// NOTA: o gerar-relatorio-html.js tem query timeout interno de 80 s/query e
// global de 90 s. Defina spawnTimeoutMs maior que o tempo real esperado das queries.
var _SPAWN_TIMEOUT_MS = SPAWN_TIMEOUT_CFG;
var _gerarTentativas  = Object.create(null); // chave → nº tentativas consecutivas
// _gerarIdCounter: ID monotônico por chave — incrementado em cada gerarEmBackground.
// Em proc.on("close"), ID divergente = geração supersedida (kill-and-restart) → descarta.
var _gerarIdCounter   = Object.create(null); // chave → ID da geração atual
// _gerandoKill: função kill da geração em andamento. _fpPoll usa para matar geração
// velha imediatamente ao detectar mudança, sem esperar os ~300ms restantes.
var _gerandoKill      = Object.create(null); // chave → function() mata o proc atual

// ---------------------------------------------------------------------------
// Gerador em background — com timeout e retry automático
// ---------------------------------------------------------------------------
var gerarEmBackground=function(inicio,fim,chave,_pollTriggered){
    var ent=cache[chave];
    if(ent&&ent.gerando)return;

    // Snapshot do HTML anterior — usado em proc.on("close") para detectar
    // mudanças (subida OU queda) sem depender de statusAtual, que pode ser
    // atualizado pelo pollStatus DURANTE a geração (race condition):
    //   ex: agendarRegen gera qt=10 → poll detecta cancelamento → statusAtual.qt=9
    //       → proc.on("close") compara 9 vs statusAtual(9) → false → sem SSE → BUG.
    // Com snapshot de ent.qt (qt do HTML anterior), a comparação é sempre correta.
    var _qtSnapshot  = (ent && typeof ent.qt  === "number" && ent.qt  >= 0) ? ent.qt  : -1;
    var _totSnapshot = (ent && typeof ent.tot === "number" && ent.tot >= 0) ? ent.tot : -1;

    // Timestamp de início — marca quando esta geração começou.
    // Em proc.on("close"), se statusAtual.ts > _genStartTs significa que
    // _fpPoll ou pollStatus escreveu dados MAIS FRESCOS durante os ~300ms de geração.
    // Nesse caso: não sobrescreve statusAtual com o HTML potencialmente antigo.
    var _genStartTs = Date.now();

    // ID desta geração — se _gerarIdCounter[chave] divergir em proc.on("close"),
    // significa que _fpPoll iniciou uma geração mais nova (kill-and-restart): descarta.
    _gerarIdCounter[chave] = (_gerarIdCounter[chave] || 0) + 1;
    var _meuId = _gerarIdCounter[chave];

    // Evita crescimento ilimitado do cache de períodos
    _evictarCacheAntigo();

    // Controle de tentativas — incrementa ANTES de escrever no cache
    _gerarTentativas[chave] = (_gerarTentativas[chave] || 0) + 1;
    var _tentativa = _gerarTentativas[chave];
    var MAX_TENTATIVAS = 5;

    cache[chave]={html:null,gerando:true,erro:null,qt:0,tot:0,tentativa:_tentativa};

    var label=(inicio===fim)?isoParaBR(inicio):(isoParaBR(inicio)+" a "+isoParaBR(fim));
    /*if (_tentativa === 1) {
        logTs("Gerando "+label+"...");
    } else {
        logTs("Gerando "+label+"... (tentativa "+_tentativa+"/"+MAX_TENTATIVAS+") — timeout: "+(_SPAWN_TIMEOUT_MS/1000)+"s");
    }*/

    var _tmpSafe = String(chave).replace(/[^a-zA-Z0-9_\-]/g,"_").slice(0,80);
    var _tmpFile = path.join(TMP_DIR, "relatorio_srv_" + _tmpSafe + ".html");

    var nArgs=[SCRIPT,"--fdb",FDB,"--data-inicio",inicio,"--data-fim",fim,
               "--saida",_tmpFile,"--user",USER,"--pass",PASS];
    var proc=spawn(process.execPath,nArgs,{stdio:["ignore","pipe","pipe"]});
    if (proc.pid) {
        _spawnedPids.push(proc.pid);
        /*logTs("Spawn PID "+proc.pid+" | timeout: "+(_SPAWN_TIMEOUT_MS/1000)+"s | "+label);*/
    } else {
        logTs("WARN: spawn sem PID para "+label+" — processo pode ter falhado ao iniciar.");
    }

    // Mata o processo filho de forma assíncrona — NÃO bloqueia o event loop.
    // execSync("taskkill") bloqueava até 3000ms, impedindo qualquer poll do browser
    // durante o kill e fazendo o estado matando:true ser invisível ao usuário.
    // Agora usa spawn (async) no Windows e SIGKILL (não-bloqueante) no Unix.
    // onKilled() é chamado quando o kill concluiu (ou após fallback de 5 s).
    var _matarProcessoFilho = function(onKilled) {
        if (!proc.pid) { if (onKilled) setTimeout(onKilled, 0); return; }
        if (process.platform === "win32") {
            var _tkFeito = false;
            var _tkFallback = setTimeout(function() {
                if (_tkFeito) return;
                _tkFeito = true;
                logTs("WARN: taskkill PID "+proc.pid+" não respondeu em 5 s — prosseguindo.");
                if (onKilled) onKilled();
            }, 5000);
            try {
                var tkProc = require("child_process").spawn(
                    "taskkill", ["/F", "/T", "/PID", String(proc.pid)],
                    {stdio: "ignore"}
                );
                tkProc.on("close", function() {
                    if (_tkFeito) return;
                    _tkFeito = true;
                    clearTimeout(_tkFallback);
                    if (onKilled) onKilled();
                });
                tkProc.on("error", function(e) {
                    if (_tkFeito) return;
                    _tkFeito = true;
                    clearTimeout(_tkFallback);
                    logTs("WARN taskkill erro: " + e.message);
                    if (onKilled) onKilled();
                });
            } catch(e) {
                clearTimeout(_tkFallback);
                logTs("WARN _matarProcessoFilho spawn falhou: " + e.message);
                if (onKilled) onKilled();
            }
        } else {
            try { proc.kill("SIGKILL"); } catch(_) {}
            if (onKilled) setTimeout(onKilled, 0);
        }
    };

    // Expõe a função kill desta geração para o _fpPoll usar no kill-and-restart.
    // Quando _fpPoll detectar mudança com gerando=true, chama _gerandoKill[chave]()
    // para matar esta geração imediatamente e iniciar nova com dados frescos.
    _gerandoKill[chave] = _matarProcessoFilho;

    // Flag para evitar que o close handler execute após timeout
    var _procEncerrado = false;

    // Hard-timeout do processo filho — mata e relança se travar no banco.
    // CORREÇÃO 1: matando:true é setado ANTES do kill, para que o browser
    //             veja o estado no próximo poll (800 ms) sem depender do kill ter concluído.
    // CORREÇÃO 2: kill é assíncrono (spawn, não execSync) — event loop livre durante o kill.
    // CORREÇÃO 3: retry só é agendado APÓS o kill concluir (callback de _matarProcessoFilho).
    var _spawnTimer = setTimeout(function() {
        if (_procEncerrado) return;
        _procEncerrado = true;
        logTs("Timeout "+(_SPAWN_TIMEOUT_MS/1000)+"s gerando "+label+" — matando processo e refazendo.");

        // Seta matando:true IMEDIATAMENTE — browser vê no próximo poll sem esperar o kill
        if (_tentativa < MAX_TENTATIVAS) {
            cache[chave] = {html:null, gerando:false, erro:null, qt:0, tot:0, matando:true, tentativa:_tentativa};
        }

        _matarProcessoFilho(function() {
            // Kill concluiu (ou fallback de 5 s) — agora limpa e agenda retry
            try { if (fs.existsSync(_tmpFile)) fs.unlinkSync(_tmpFile); } catch(_) {}
            if (proc.pid) _spawnedPids = _spawnedPids.filter(function(p){ return p !== proc.pid; });
            if (_tentativa < MAX_TENTATIVAS) {
                // matando:true já foi setado antes do kill — browser teve tempo de ver.
                // Aguarda 3200ms (4× poll de 800ms) antes de relançar.
                setTimeout(function() { gerarEmBackground(inicio, fim, chave, _pollTriggered); }, 3200);
            } else {
                logTs("ERRO: "+MAX_TENTATIVAS+" tentativas falharam para "+label+". Abortando.");
                cache[chave] = {html:null, gerando:false, erro:"Geração falhou após "+MAX_TENTATIVAS+" tentativas (timeout de "+(_SPAWN_TIMEOUT_MS/1000)+"s cada)."};
                _gerarTentativas[chave] = 0;
            }
        });
    }, _SPAWN_TIMEOUT_MS);

    // Roteia stdout/stderr do filho pelo console.log do servidor
    var _stdoutBuf = "";
    proc.stdout.on("data", function(d) {
        _stdoutBuf += d.toString();
        var lines = _stdoutBuf.split("\n");
        _stdoutBuf = lines.pop(); // guarda linha incompleta
        lines.forEach(function(l) {
            var t = l.trim();
            if (!t) return;
            // ">> arquivo gravado:" sempre logado — indica duração total acumulada da consulta.
            // CORREÇÃO: antes, isSempreMostrar caia no `else { /*logTs*/ }` (comentado),
            // fazendo com que essas linhas NUNCA fossem logadas apesar do comentário dizer o contrário.
            /*var isSempreMostrar = t.indexOf(">> arquivo gravado:") === 0;
            if (isSempreMostrar) {
                logTs(t); // sempre loga — sem condição de primeira-vez
                return;
            }*/
            // Linhas de conexão e progresso somente na 1ª geração do dia
            var isPrimeiraVez =
                t.charAt(0) === ">" ||
                t.indexOf("OK:") === 0 ||
                t.indexOf("Conectando em:") === 0 ||
                t.indexOf("Conectado!") === 0;
            if (isPrimeiraVez) {
                if (!_queryLogsHoje) logTs(t);
            }
        });
    });
    // CORREÇÃO: stderr do filho passava direto para process.stderr sem ser gravado no
    // relatorio.log — erros do gerar-relatorio-html.js (ex: query timeout interno,
    // unhandledRejection) ficavam invisíveis no log. Agora passam por logToFile().
    proc.stderr.on("data", function(d) {
        var msg = d.toString().trim();
        if (msg) logTs("[filho stderr] " + msg);
        process.stderr.write(d);
    });


    proc.on("error",function(e){
        if (_procEncerrado) return;
        _procEncerrado = true;
        clearTimeout(_spawnTimer);
        logTs("ERRO spawn: "+e.message);
        cache[chave]={html:null,gerando:false,erro:"Falha ao iniciar node: "+e.message};
        _gerarTentativas[chave] = 0;
    });
    proc.on("close",function(code){
        if (_procEncerrado) return; // timeout já tratou este processo
        _procEncerrado = true;
        clearTimeout(_spawnTimer);
        // Flush de qualquer conteúdo restante no buffer (linha sem \n final)
        if (_stdoutBuf.trim()) { logTs(_stdoutBuf.trim()); }
        _stdoutBuf = "";
        if (proc.pid) _spawnedPids = _spawnedPids.filter(function(p){ return p !== proc.pid; });

        // Verifica se esta geração ainda é a ativa.
        // _fpPoll pode ter iniciado uma geração mais nova (kill-and-restart) enquanto
        // este processo rodava — nesse caso o resultado aqui é obsoleto: descarta.
        if (_gerarIdCounter[chave] !== _meuId) {
            logTs("Geração " + chave + " #" + _meuId + " superada por #" + _gerarIdCounter[chave] + " — descartando.");
            delete _gerandoKill[chave];
            try { if (fs.existsSync(_tmpFile)) fs.unlinkSync(_tmpFile); } catch(_) {}
            return;
        }
        delete _gerandoKill[chave]; // limpa referência — geração concluída

        _gerarTentativas[chave] = 0; // sucesso ou erro definitivo — zera contador
        try {
        if(code!==0){
            var msg="Script terminou com codigo "+code+". Verifique se o Firebird esta rodando.";
            logTs("ERRO: "+msg);cache[chave]={html:null,gerando:false,erro:msg};return;
        }
        if(!fs.existsSync(_tmpFile)){
            cache[chave]={html:null,gerando:false,erro:"Arquivo de saida nao criado."};return;
        }
        var html;
        try{html=fs.readFileSync(_tmpFile,"utf8");}
        catch(e){cache[chave]={html:null,gerando:false,erro:"Erro lendo HTML: "+e.message};return;}
        try{fs.unlinkSync(_tmpFile);}catch(_){}

        var st   = extrairStatusDoHtml(html);
        var qt   = st.qt, tot = st.tot;
        var ehHje= (inicio===fim && inicio===hoje());
        // Polling do browser sincronizado com POLL_INTERVAL — garante que se o SSE
        // falhar, o browser detecta a mudança no mesmo ritmo do servidor.
        var pollMs = POLL_INTERVAL;

        // Marca que já logamos as linhas de progresso hoje — próximas gerações ficam silenciosas
        if (!_queryLogsHoje) _queryLogsHoje = true;

        var _statusChanged = false;
        if (ehHje && _qtSnapshot >= 0) {
            // Compara novo HTML contra snapshot do HTML anterior (não statusAtual):
            // statusAtual pode já ter sido atualizado pelo pollStatus durante a geração,
            // tornando a comparação qt===statusAtual.qt sempre verdadeira e perdendo o evento.
            if (qt !== _qtSnapshot || Math.abs(tot - _totSnapshot) > 0.005) {
                logTs("Dados alterados: " + _descreverMudanca(_qtSnapshot, qt, _totSnapshot, tot));
                _statusChanged = true;
            }
        }

        var SC = "</" + "script>";
        var arScript =
            "<script>(function(){" +
            // ── Handlers globais (sempre — relatório hoje e histórico) ─────────
            "window.onerror=function(msg,src,line,col,err){" +
            "try{fetch('/api/log-error',{method:'POST',headers:{'Content-Type':'application/json'}," +
            "body:JSON.stringify({msg:String(msg),src:String(src||''),line:line,col:col," +
            "stack:err&&err.stack?String(err.stack):''})});}catch(_){}" +
            "};" +
            "window.onunhandledrejection=function(ev){" +
            "try{var r=ev&&ev.reason;fetch('/api/log-error',{method:'POST'," +
            "headers:{'Content-Type':'application/json'}," +
            "body:JSON.stringify({msg:'UnhandledRejection: '+String(r&&r.message||r)," +
            "stack:r&&r.stack?String(r.stack):''})});}catch(_){}" +
            "};" +
            "try{var _th=localStorage.getItem('fdb_theme')||" +
            "(document.cookie.match(/fdb_theme=([^;]+)/)||[])[1]||'ultra-dark';" +
            "document.documentElement.setAttribute('data-theme',_th);" +
            "}catch(e){};" +
            // ── Auto-reload (apenas relatório de hoje) ────────────────────────
            (ehHje ? (
            // Badge visual confirma que auto-reload está ativo
            "try{var _badge=document.createElement('div');" +
            "_badge.id='__srv_badge';" +
            "_badge.title='Auto-atualizacao ativa — detecta vendas em ~200ms';" +
            "_badge.style.cssText='position:fixed;bottom:8px;left:8px;z-index:2147483646;" +
            "background:rgba(0,200,80,.18);border:1px solid rgba(0,200,80,.35);border-radius:6px;" +
            "padding:3px 8px;font-size:10px;color:rgba(0,220,80,.9);font-family:monospace;" +
            "pointer-events:none;transition:opacity .5s;opacity:1';" +
            "_badge.textContent='\\u21bb auto';" +
            "document.body.appendChild(_badge);" +
            "setTimeout(function(){_badge.style.opacity='0.18';},3000);" +
            "}catch(_){}" +
            // Estado interno — _loadTs marca quando esta página foi carregada
            "var _q="+qt+",_t="+(Math.round(tot*100)/100)+",_loadTs=Date.now();" +
            "console.log('[srv] auto-reload ativo | qt='+_q+' tot='+_t+' loadTs='+_loadTs);" +
            // SSE (primário)
            "var _es=null,_connTry=0;" +
            "var _conn=function(){" +
            "try{" +
            "_es=new EventSource('/api/events');" +
            "_es.onmessage=function(ev){" +
            "try{var d=JSON.parse(ev.data);" +
            "if(d.type==='reload'||d.type==='navigate')window.location.replace(window.location.href);" +
            "if(d.type==='navigate-hash'&&d.hash){" +
            "if(typeof __abrirModalConfig==='function'&&d.hash==='config'){__abrirModalConfig();}" +
            "else if(typeof __abrirModalPeriodo==='function'&&d.hash==='periodo'){__abrirModalPeriodo();}" +
            "}" +
            "}catch(e){};};" +
            "_es.onopen=function(){_connTry=0;console.log('[srv] SSE conectado');};" +
            "_es.onerror=function(){if(_es){_es.close();_es=null;}" +
            "_connTry++;var delay=Math.min(2000*_connTry,30000);" +
            "console.log('[srv] SSE erro #'+_connTry+' — reconectando em '+delay+'ms');" +
            "setTimeout(_conn,delay);};" +
            "}catch(e){console.log('[srv] SSE falhou: '+e.message);setTimeout(_conn,5000);}" +
            "};" +
            "_conn();" +
            // Poll HTTP (fallback — detecta mesmo sem SSE)
            "var _pollErros=0;" +
            "var _poll=function(){" +
            "fetch('/api/status',{cache:'no-store'})" +
            ".then(function(r){return r.ok?r.json():Promise.reject(r.status);})" +
            ".then(function(d){" +
            "_pollErros=0;" +
            "if(d.correcoes&&d.correcoes.length){" +
            "var _deveReload=false;" +
            "d.correcoes.forEach(function(c){" +
            "try{" +
            "var _tw=document.getElementById('__srv_tw')||" +
            "(function(){var e=document.createElement('div');e.id='__srv_tw';" +
            "e.style.cssText='position:fixed;bottom:20px;right:20px;z-index:2147483647;" +
            "display:flex;flex-direction:column-reverse;gap:8px;pointer-events:none;max-width:320px';" +
            "document.body.appendChild(e);return e;})();" +
            "var _t=document.createElement('div');" +
            "_t.style.cssText='background:#0f172a;border:1px solid '+(c.cor||'rgba(14,165,233,.4)')" +
            "+';border-radius:10px;padding:10px 14px;font-size:12px;line-height:1.5;" +
            "color:#e2e8f0;font-family:Inter,Arial,sans-serif;" +
            "box-shadow:0 4px 24px rgba(0,0,0,.65);opacity:1;transition:opacity .5s ease;" +
            "pointer-events:none;word-break:break-word';" +
            "_t.textContent=c.msg;" +
            "_tw.appendChild(_t);" +
            "setTimeout(function(){_t.style.opacity='0';" +
            "setTimeout(function(){try{_t.parentNode&&_t.parentNode.removeChild(_t);}catch(_){}},550);}," +
            TOAST_DURATION + ");" +
            "}catch(_){}" +
            "if(c.reload)_deveReload=true;" +
            "});" +
            "if(_deveReload){setTimeout(function(){window.location.replace(window.location.href);},800);}}" +
            "if(d.qt>=0&&(" +
            // Mecanismo 1 (primário): changeTs > _loadTs — detecta mudanças ocorridas
            // APÓS esta página ter sido carregada, mesmo que _q===d.qt (HTML já atualizado).
            "(d.changeTs&&d.changeTs>_loadTs)||" +
            // Mecanismo 2 (backup): comparação direta — captura divergências de qt/tot
            "d.qt!==_q||Math.abs(d.total-_t)>0.01)){" +
            "console.log('[srv] reload: changeTs='+d.changeTs+' loadTs='+_loadTs+' qt='+d.qt+'/'+_q);" +
            "_q=d.qt;_t=d.total;_loadTs=Date.now();" + // atualiza para evitar loops
            "window.location.replace(window.location.href);}}" +
            ")" +
            ".catch(function(err){_pollErros++;" +
            "if(_pollErros<=3)console.log('[srv] poll erro #'+_pollErros+': '+err);" +
            "});};" +
            "setInterval(_poll,"+pollMs+");"
            ) : "") +
            // ── Sincronização de fuso horário (sempre) ────────────────────────
            "var _syncHo=function(){try{fetch('/api/hora-usuario',{method:'POST'," +
            "headers:{'Content-Type':'application/json'}," +
            "body:JSON.stringify({ts:Date.now()," +
            "tzOffsetMs:new Date().getTimezoneOffset()*60000})," +
            "cache:'no-store'}).catch(function(){});}catch(_){}};" +
            "_syncHo();setInterval(_syncHo,30000);" +
            "})();" + SC;

        var serverModeSnip =
            "<script>" +
            "window.__SERVER_MODE__=true;" +
            "window.__STATUS_INICIAL__={qt:"+qt+",total:"+(Math.round(tot*100)/100)+"};" +
            "<\/script>";

        try {
            // ── serverModeSnip → injeta antes de </head> ──────────────────────
            var headClose = html.lastIndexOf("</head>");
            if (headClose >= 0) {
                html = html.slice(0, headClose) + serverModeSnip + html.slice(headClose);
            } else {
                var bOpen = html.indexOf("<body");
                if (bOpen >= 0) { html = html.slice(0, bOpen) + serverModeSnip + html.slice(bOpen); }
                else             { html = serverModeSnip + html; }
                logTs("AVISO: </head> nao encontrado — SERVER_MODE injetado como fallback.");
            }

            // ── arScript → injeta ANTES de </body> ───────────────────────────
            // USA lastIndexOf("</body>") em vez de replace("</body></html>", ...)
            // para ser robusto a:  "</body>\n</html>",  "</body>  </html>",  etc.
            // String.replace() com string longa falha se houver '$' no arScript
            // (padrões de substituição como $&, $', $1) — corrompendo o script.
            if (arScript) {
                var bodyClose = html.lastIndexOf("</body>");
                if (bodyClose >= 0) {
                    html = html.slice(0, bodyClose) + arScript + html.slice(bodyClose);
                } else {
                    html = html + arScript;
                    logTs("ERRO: </body> nao encontrado no HTML — arScript injetado no fim. Auto-reload pode nao funcionar.");
                }
            }
        } catch(injErr) {
            logTs("ERRO na injecao HTML: " + (injErr && injErr.stack || injErr));
        }

        var nClientesAoGerar = sseClients.length;
        /*logTs("Pronto: "+label+" ("+Math.round(html.length/1024)+" KB, "+qt+" vendas, R$"+tot.toFixed(2)+") | _statusChanged="+_statusChanged+" | sseClients="+nClientesAoGerar);*/

        // Detecta se _fpPoll ou pollStatus gravaram statusAtual DURANTE esta geração
        // COM dados diferentes dos que nosso HTML produziu.
        // Apenas timestamp (ts > _genStartTs) NÃO é suficiente: pollStatus atualiza
        // statusAtual.ts mesmo sem detectar mudança, causando falsos positivos que
        // disparariam re-gerações desnecessárias a cada ciclo de poll.
        var _statusAtualizadoDurante = ehHje &&
            statusAtual.ts > _genStartTs &&
            (statusAtual.qt !== qt || Math.abs(statusAtual.total - tot) > 0.005);

        cache[chave]={html:html,gerando:false,erro:null,qt:qt,tot:tot,geradoEm:Date.now()};

        if (ehHje) {
            if (!_statusAtualizadoDurante) {
                // Nossa geração é a fonte mais fresca — atualiza statusAtual normalmente
                statusAtual = Object.assign({}, statusAtual, {qt:qt, total:tot, ts:Date.now()});
            }
            // Se _statusAtualizadoDurante=true: _fpPoll/pollStatus gravou dados mais recentes
            // durante a geração. Preserva esses dados — NÃO sobrescreve com o HTML antigo.
            // (o revert era o bug: página ficava presa com datos velhos indefinidamente)
        }

        // SSE dispatch: dispara quando:
        //   1. _pollTriggered=true — fast-poll/pollStatus detectou mudança e iniciou esta geração.
        //      SSE emitido AQUI (após HTML pronto) — browser recarrega direto para HTML final,
        //      sem passar por paginaLoading.
        //   2. _statusChanged — mudança detectada vs snapshot do HTML anterior (agendarRegen path).
        //   Nota: correções de horário usam reload:true nos toasts.
        if ((_statusChanged || (ehHje && !!_pollTriggered)) && sseClients.length > 0) {
            _statusChangeTs = Date.now(); // HTML pronto — poll HTTP também recarrega direto para página final
            broadcastSSE({type:"reload"});
        } else if (_statusChanged || (ehHje && !!_pollTriggered)) {
            // Sem clientes SSE — atualiza changeTs para que o poll HTTP detecte e recarregue
            _statusChangeTs = Date.now();
        }

        // Re-trigger: _fpPoll/pollStatus detectou mudança DURANTE esta geração
        // mas o filho leu o BD antes da venda (HTML está antigo).
        // Agenda nova geração imediata para capturar os dados frescos.
        // Só re-aciona se não houve _statusChanged nem _pollTriggered — nesses casos
        // o HTML já tem os dados corretos e o SSE já disparou (não precisa repetir).
        if (_statusAtualizadoDurante && !_statusChanged && !_pollTriggered && ehHje) {
            logTs("Dados atualizados durante geração — re-acionando para capturar dados frescos...");
            setImmediate(function() {
                if (!cache[chave] || !cache[chave].gerando) {
                    delete cache[chave];
                    gerarEmBackground(chave, chave, chave, true);
                }
            });
        }
        } catch(fatalErr) {
            logTs("ERRO FATAL em proc.close ("+chave+"): "+(fatalErr&&fatalErr.stack||fatalErr));
            try { cache[chave]={html:null,gerando:false,erro:"Erro interno: "+(fatalErr&&fatalErr.message||String(fatalErr))}; } catch(_) {}
        }
    });
};

// ---------------------------------------------------------------------------
// FAST-POLL: detecção de vendas em < 300 ms via conexão Firebird persistente.
//
// Arquitetura dois níveis:
//   1. Fast-poll (200ms fixo, este bloco): query mínima (COUNT+SUM) em conexão
//      persistente. Detecta qualquer variação em qt ou total → aciona
//      gerarEmBackground imediato via _pollTriggered=true → SSE após HTML pronto.
//      Sem overhead de attach/detach por ciclo — conexão reutilizada entre 200ms.
//      Se a conexão morrer (banco reiniciado, rede, crash): _fpDb=null e reconecta
//      no próximo ciclo (silencioso, sem spam de log).
//
//   2. pollStatus (POLL_INTERVAL, fallback / validador): query completa com IIF
//      por tipo (Gerencial/NFC-e/NF-e). Roda correções de horário, valida breakdown
//      por modelo e serve como net de segurança se o fast-poll falhar.
//      Ao detectar mudança já acionada pelo fast-poll, gerarEmBackground retorna
//      early (ent.gerando=true) sem custo extra.
//
// Resultado: detecção em 200-400ms; POLL_INTERVAL vira fallback de segurança.
// ---------------------------------------------------------------------------
var _FP_INTERVAL_MS  = 50;    // fixo — detecção a cada 50ms (conexão persistente: sem overhead)
var _fpDb            = null;  // conexão Firebird persistente (reutilizada entre ciclos)
var _fpConectando    = false; // evita tentativas de attach paralelas
var _fpBusy          = false; // evita ciclos sobrepostos
var _fpUltimoQt      = -1;    // última contagem vista (-1 = sem baseline ainda)
var _fpUltimoTot     = -1;    // último total visto
var _fpDhAtual       = null;  // data do último ciclo — detecta virada de dia e reseta baseline
var _fpIntervalId    = null;

// SQL mínima: COUNT+SUM sem IIF/tipo breakdown.
// Mais rápida que a query completa do pollStatus — ideal para detecção contínua.
// Inclui nfce (cancelado filtrado) e pagament (formas ignoradas: 00/13).
var _FP_SQL =
    "SELECT COALESCE(SUM(qt),0) AS FP_QT, COALESCE(SUM(tot),0) AS FP_TOT" +
    " FROM (" +
    "  SELECT 1 AS qt, total AS tot" +
    "  FROM nfce" +
    "  WHERE data >= ? AND data < ? + 1" +
    "  AND COALESCE(cancelado,'N') NOT IN ('S','T')" +
    "  AND total > 0" +
    "  UNION ALL" +
    "  SELECT 1 AS qt, valor AS tot" +
    "  FROM pagament" +
    "  WHERE data >= ? AND data < ? + 1" +
    "  AND valor > 0" +
    "  AND SUBSTRING(forma FROM 1 FOR 2) NOT IN ('00','13')" +
    " ) t";

// Conecta (ou reconecta) a conexão persistente do fast-poll.
// _done flag previne double-callback (timeout + attach concorrentes).
var _fpConectar = function(cb) {
    if (_fpConectando) { cb(false); return; }
    _fpConectando = true;
    var opts = {host:FDB_HOST, port:3050, database:FDB_PATH, user:USER, password:PASS,
                role:null, charset:"UTF8", pageSize:4096, lowercase_keys:false};
    var _done = false;
    var _t = setTimeout(function() {
        if (_done) return; _done = true;
        _fpConectando = false;
        _fpDb = null;
        cb(false);
    }, 3000);
    try {
        Firebird.attach(opts, function(err, db) {
            if (_done) { if (!err && db) { try { db.detach(); } catch(_) {} } return; }
            _done = true;
            clearTimeout(_t);
            _fpConectando = false;
            if (err || !db) { _fpDb = null; cb(false); return; }
            _fpDb = db;
            cb(true);
        });
    } catch(syncErr) {
        // Firebird.attach nunca deveria lançar sincronamente, mas por segurança:
        if (!_done) { _done = true; clearTimeout(_t); _fpConectando = false; _fpDb = null; cb(false); }
    }
};

// Executa um ciclo do fast-poll.
// Reutiliza _fpDb se disponível; reconecta silenciosamente se necessário.
var _fpPoll = function() {
    if (!Firebird || !dbStatus.ok || _fpBusy || _fpConectando) return;
    _fpBusy = true;
    var dh = hoje();

    // Virada de dia: reseta baseline para não comparar hoje com ontem
    if (_fpDhAtual && _fpDhAtual !== dh) {
        _fpUltimoQt  = -1;
        _fpUltimoTot = -1;
        logTs("FastPoll: virada de dia (" + _fpDhAtual + " → " + dh + ") — baseline resetado.");
    }
    _fpDhAtual = dh;

    var _executar = function() {
        // Watchdog: se query não responder em 2s → conexão morta
        var _wdFired = false;
        var _wdFp = setTimeout(function() {
            _wdFired = true;
            try { if (_fpDb) _matarConexao(_fpDb); } catch(_) {}
            _fpDb   = null;
            _fpBusy = false;
        }, 2000);

        _fpDb.query(_FP_SQL, [dh, dh, dh, dh], function(err, rows) {
            clearTimeout(_wdFp);
            // Se watchdog já disparou, descarta callback para evitar duplo processamento
            if (_wdFired) return;

            if (err || !rows || !rows.length) {
                try { if (_fpDb) _matarConexao(_fpDb); } catch(_) {}
                _fpDb   = null;
                _fpBusy = false;
                return;
            }
            var r   = rows[0];
            var n   = function(k) { return Number(r[k] || r[k.toLowerCase()] || 0); };
            var qt  = n("FP_QT");
            var tot = n("FP_TOT");

            if (_fpUltimoQt >= 0 &&
                (qt !== _fpUltimoQt || Math.abs(tot - _fpUltimoTot) > 0.005)) {

                logTs("FastPoll: " + _descreverMudanca(_fpUltimoQt, qt, _fpUltimoTot, tot) + " → regerando.");
                // NÃO atualiza statusAtual nem dispara SSE aqui.
                // Ambos ocorrem em gerarEmBackground proc.on("close") quando HTML está pronto,
                // garantindo que o browser recarregue direto para a página final sem paginaLoading.

                var _ent = cache[dh];
                if (_ent && _ent.gerando) {
                    var _killFn = _gerandoKill[dh];
                    _gerarIdCounter[dh] = (_gerarIdCounter[dh] || 0) + 1;
                    delete _gerandoKill[dh];
                    delete cache[dh];
                    gerarEmBackground(dh, dh, dh, true);
                    if (_killFn) { try { _killFn(); } catch(_) {} }
                } else {
                    delete cache[dh];
                    gerarEmBackground(dh, dh, dh, true);
                }
            }

            _fpUltimoQt  = qt;
            _fpUltimoTot = tot;
            _fpBusy = false;
        });
    };

    if (_fpDb) {
        _executar();
    } else {
        _fpConectar(function(ok) {
            if (ok) _executar();
            else     _fpBusy = false;
        });
    }
};

// Inicia (ou reinicia limpo) o fast-poll.
// Chamada sempre que o banco é configurado ou reconectado.
var _iniciarFastPoll = function() {
    if (_fpIntervalId) clearInterval(_fpIntervalId);
    _fpUltimoQt = _fpUltimoTot = -1;
    _fpDhAtual  = null;
    _fpBusy     = false;
    if (_fpDb) { try { _matarConexao(_fpDb); } catch(_) {} _fpDb = null; }
    _fpIntervalId = setInterval(_fpPoll, _FP_INTERVAL_MS);
    logTs("Fast-poll iniciado (" + _FP_INTERVAL_MS + " ms) — detecção de vendas em tempo real.");
};

// ---------------------------------------------------------------------------
// Polling direto via Firebird — executa a cada POLL_INTERVAL (config.json).
//  • Query única com IIF detecta mudanças por tipo: Gerencial(99), NFC-e(65), NF-e(55)
//    e emite ">" (subiu) ou "<" (caiu) por tipo no log antes de regenerar.
//  • Timeout de 5 s por consulta (_QUERY_TIMEOUT_MS): se ultrapassar, cancela
//    o socket TCP e refaz após 500 ms.
//  • Após detecção chama _corrigirHorariosVelhos e _corrigirHorariosGerencial,
//    que usam agoraAjustado() — hora sincronizada com o browser do usuário.
// ---------------------------------------------------------------------------
var _pollBusy = false;
var _pollIntervalId = null; // guarda o ID do setInterval ativo — evita acúmulo de loops
var _QUERY_TIMEOUT_MS = 5000;   // 5 segundos — cancela e refaz se exceder
var _HORA_VELHA_MS    = 1 * 60 * 1000; // 1 minuto — corrige horário de venda stale
var _HORA_GERENCIAL_VELHA_MS = 1 * 60 * 1000; // 1 minuto — corrige gerencial futuro ou stale

// Throttle das funções de correção de horário.
// Elas abrem conexão Firebird própria — chamá-las a cada poll (200ms) gera
// 10 conexões extras/segundo ao banco, atrasando o próprio poll de detecção.
// Solução: busy-flag por função — retorna imediatamente se já estiver em andamento.
// Elimina throttle fixo de 5s: detecção dispara a cada poll (≤200ms), bloqueando
// apenas enquanto a query Firebird anterior não terminou (~10-100ms em banco local).
var _corriVelhosEmAndamento    = false; // true = _corrigirHorariosVelhos rodando
var _corriGerencialEmAndamento = false; // true = _corrigirHorariosGerencial rodando

// ---------------------------------------------------------------------------
// Sincronização de fuso horário com o browser do usuário.
// O browser envia getTimezoneOffset()*60000 via POST /api/hora-usuario a cada 30 s.
//
// _clientTzOffsetMs = browser.getTimezoneOffset() * 60000
//   ex: UTC-4 → 240 min × 60000 = 14 400 000 ms
//   (positivo = fuso atrás de UTC; negativo = fuso à frente)
//
// agoraAjustado() retorna um pseudo-objeto cujos métodos getHours/getMinutes/
// getSeconds usam getUTCHours/etc. num Date deslocado pelo tzOffset, produzindo
// exatamente o que `new Date().getHours()` retornaria no BROWSER do usuário.
//
// Isso corrige o bug onde o servidor (potencialmente em UTC) calculava
// horaAtual e horaLimite com getHours() do seu próprio fuso, enquanto o banco
// gravava os horários no fuso local do usuário.
// ---------------------------------------------------------------------------
var _clientTzOffsetMs    = 0;   // atualizado via /api/hora-usuario
var _ultimaSincHoraUsuario = 0;

var agoraAjustado = function() {
    // Date deslocado: getUTCHours() == hora local do usuário
    // Ex: UTC 18:00 - 14400000 ms (UTC-4) → UTC 14:00 → getUTCHours() = 14 ✓
    var d = new Date(Date.now() - _clientTzOffsetMs);
    return {
        getHours:   function() { return d.getUTCHours(); },
        getMinutes: function() { return d.getUTCMinutes(); },
        getSeconds: function() { return d.getUTCSeconds(); },
        getTime:    function() { return d.getTime(); }
    };
};

// Destrói a conexão Firebird na força — corta o socket TCP imediatamente,
// sem esperar o banco responder (db.detach() aguarda; socket.destroy() não).
var _matarConexao = function(db) {
    // node-firebird expõe o socket em propriedades que variam por versão.
    // Tenta as variações conhecidas em ordem para garantir destroy real.
    try {
        var conn = db && db._connection;
        var sock = conn && (conn._socket || conn._Socket || conn.socket || conn._sock);
        if (sock && typeof sock.destroy === "function") {
            sock.destroy();
        } else if (conn && typeof conn.destroy === "function") {
            conn.destroy(); // fallback: destrói o objeto de conexão inteiro
        }
    } catch(_) {}
    try { if (db && typeof db.detach === "function") db.detach(); } catch(_) {}
};

// Mata todos os processos filhos pendentes (gerarEmBackground).
// Chamado quando poll ou attach ultrapassam o timeout — garante que
// subprocessos aguardando o mesmo banco também sejam encerrados.
var _matarTodosFilhos = function() {
    var pids = _spawnedPids.slice();
    if (!pids.length) return;
    logTs("Matando " + pids.length + " processo(s) filho(s) por timeout de poll.");
    pids.forEach(function(pid) {
        if (process.platform === "win32") {
            // spawn (não-bloqueante) evita travar o event loop até 3s/pid
            try { require("child_process").spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {stdio:"ignore", detached:true}); } catch(_) {}
        } else {
            try { process.kill(pid, "SIGKILL"); } catch(_) {}
        }
    });
    _spawnedPids = [];
};

// Executa uma query com hard-timeout de _QUERY_TIMEOUT_MS ms.
// Se estourar: destrói o socket TCP (cancela de verdade), mata processos filhos
// pendentes e chama cb(null, null). O caller detecta (rows===null && e===null) e agenda retry.
var _executarConsultaPoll = function(db, sql, params, cb) {
    var encerrado = false;

    var timer = setTimeout(function() {
        if (encerrado) return;
        encerrado = true;
        logTs("Poll: query passou de " + (_QUERY_TIMEOUT_MS/1000) + "s — cortando socket, matando filhos e refazendo.");
        _matarConexao(db);
        _matarTodosFilhos();
        cb(null, null);
    }, _QUERY_TIMEOUT_MS);

    db.query(sql, params, function(e, rows) {
        if (encerrado) return; // timeout já disparou — ignora resposta tardia
        encerrado = true;
        clearTimeout(timer);
        cb(e, rows);
    });
};

// Sets de IDs já corrigidos hoje — garantem que cada venda/pagamento
// seja ajustado UMA ÚNICA VEZ. Resetados à meia-noite em _agendarResetLogProt.
var _nfceCorrigidasHoje    = new Set(); // chave: String(numero)
var _pagCorrigidosHoje     = new Set(); // chave: String(numero) ou "seq:N"

// Corrige vendas cujo horário registrado está mais de 1 min no passado,
// atualizando o campo de hora para o instante atual do relógio local do servidor
// (new Date().getHours() — mesmo fuso do Firebird, sem dependência de _clientTzOffsetMs).
// Cada venda/pagamento é corrigido UMA ÚNICA VEZ por dia (controlado pelos Sets).
// Executa de forma assíncrona sem bloquear o poll principal.
// NOTA: abre sua própria conexão Firebird — não usa o db do poll para evitar
// race condition com _liberar(db) que pode destruir a conexão antes das
// queries de correção completarem.
var _corrigirHorariosVelhos = function(_dbIgnorado, dh) {
    // Busy-flag: evita chamadas paralelas (poll a cada 200ms, query ~10-100ms).
    if (_corriVelhosEmAndamento) return;
    _corriVelhosEmAndamento = true;

    // USA O RELÓGIO LOCAL DO SERVIDOR DIRETAMENTE — servidor e Firebird estão
    // na mesma máquina e compartilham o mesmo clock.
    // Bug anterior: usava agoraAjustado() que depende de _clientTzOffsetMs (inicia em 0).
    // Com _clientTzOffsetMs=0 numa máquina UTC-3, horaLimite ficava 3h adiantada →
    // todas as vendas do dia eram "detectadas" erradas e gravadas com hora UTC incorreta.
    // Depois que _nfceCorrigidasHoje absorvia esses IDs, vendas novas com hora velha
    // ficavam travadas no Set e nunca eram corrigidas novamente.
    var _nowMs    = Date.now();
    var _agoraD   = new Date(_nowMs);
    var _threshD  = new Date(_nowMs - _HORA_VELHA_MS);
    var p         = function(n) { return String(n).padStart(2, "0"); };
    // getHours()/getMinutes()/getSeconds() = hora LOCAL do servidor (mesmo fuso do Firebird)
    var horaAtual = p(_agoraD.getHours()) + ":" + p(_agoraD.getMinutes()) + ":" + p(_agoraD.getSeconds());
    var horaLimite= p(_threshD.getHours()) + ":" + p(_threshD.getMinutes()) + ":" + p(_threshD.getSeconds());

    // Guard meia-noite: nos primeiros _HORA_VELHA_MS ms do dia, threshold cruza a
    // meia-noite LOCAL e horaLimite fica "23:5x:xx" (ontem). A comparação SQL de
    // strings retornaria "00:0x:xx" < "23:5x:xx" = true — corrigiria todas as
    // vendas do dia novo indevidamente. Aguarda o próximo ciclo de poll.
    // Bug anterior: usava floor(getTime()/86400000) = dia UTC, não dia LOCAL —
    // o guard disparava na hora errada em máquinas com fuso diferente de UTC.
    var _agoraDiaStr  = _agoraD.getFullYear() + "-" + p(_agoraD.getMonth()+1) + "-" + p(_agoraD.getDate());
    var _threshDiaStr = _threshD.getFullYear() + "-" + p(_threshD.getMonth()+1) + "-" + p(_threshD.getDate());
    if (_threshDiaStr < _agoraDiaStr) {
        // guard meia-noite — silencioso para não inundar o log
        _corriVelhosEmAndamento = false;
        return;
    }

    // NÃO loga no início — essa função é chamada a cada poll (200ms).
    // Logar aqui geraria ~5 msgs/s, esgotando MAX_LOG_LINES em minutos.
    // Logs apenas quando efetivamente corrige algo ou ocorre erro.

    // _pend: contador de ramos async pendentes (nfce + pagament = 2).
    // Começa em 1 (nfce); incrementado para 2 quando pagament é iniciado.
    // Chega a 0 quando ambos terminam (ou erram) → limpa _corriVelhosEmAndamento.
    var _pend = 1;
    var _liberar = function() {
        if (--_pend <= 0) _corriVelhosEmAndamento = false;
    };

    var opts = {host:FDB_HOST, port:3050, database:FDB_PATH, user:USER, password:PASS,
                role:null, charset:"UTF8", pageSize:4096, lowercase_keys:false};

    // Timeout global para a conexão nfce — impede que conexão pendurada vaze
    // para sempre se o Firebird travar após o poll principal já ter liberado.
    var _cvDb = null, _cvEncerrado = false;
    var _cvTimer = setTimeout(function() {
        if (_cvEncerrado) return;
        _cvEncerrado = true;
        logTs("_corrigirHorariosVelhos(nfce): timeout de " + (_QUERY_TIMEOUT_MS/1000) + "s — encerrando conexão.");
        if (_cvDb) _matarConexao(_cvDb);
        _liberar(); // timeout = fim do ramo nfce
    }, _QUERY_TIMEOUT_MS);

    Firebird.attach(opts, function(errConn, db) {
        if (_cvEncerrado) { if (db) _matarConexao(db); return; } // timeout já chamou _liberar
        _cvDb = db;
        if (errConn || !db) { clearTimeout(_cvTimer); _liberar(); return; } // banco indisponível — tenta no próximo ciclo
        var _fechar = function() {
            if (_cvEncerrado) return;
            _cvEncerrado = true;
            clearTimeout(_cvTimer);
            try { db.detach(); } catch(_) {}
            _liberar(); // fim normal do ramo nfce
        };

    // ---- nfce: SELECT IDs ainda não corrigidos ----
    // Tenta campo DHORA; se falhar, retenta com campo HORA.
    // IMPORTANTE: exclui modelo=99 (gerenciais) — eles são tratados exclusivamente
    // por _corrigirHorariosGerencial, que usa _horaFixadaCache (persistente).
    // Sem esse filtro, o mesmo gerencial seria corrigido em paralelo por ambas as
    // funções no mesmo poll, e após restart o _nfceCorrigidasHoje (volátil) seria
    // zerado enquanto o _horaFixadaCache permanece — causando re-correção infinita.
    var _corrigirNfceComCampo = function(campo) {
        var sqlSel =
            "SELECT numero FROM nfce " +
            "WHERE data >= ? AND data < ? + 1 " +
            "AND COALESCE(modelo,65) <> 99 " +
            "AND " + campo + " IS NOT NULL " +
            "AND " + campo + " < ? " +
            "AND COALESCE(cancelado,'N') NOT IN ('S','T') " +
            "AND total > 0";
        db.query(sqlSel, [dh, dh, horaLimite], function(errS, rows) {
            if (errS) { logTs("Correção nfce."+campo+": erro na query — "+errS.message); _fechar(); return; }
            if (!rows || !rows.length) { _fechar(); return; } // nenhum para corrigir — silencioso

            // Filtra apenas os que ainda não foram corrigidos nesta sessão do dia
            var novos = rows
                .map(function(r) { return String(r.NUMERO || r.numero || ""); })
                .filter(function(id) { return id && !_nfceCorrigidasHoje.has(id); });

            if (!novos.length) { _fechar(); return; } // todos já corrigidos — silencioso

            // Registra no Set ANTES do UPDATE para evitar dupla correção
            // mesmo que o UPDATE demore ou seja chamado em paralelo
            novos.forEach(function(id) { _nfceCorrigidasHoje.add(id); });

            // Monta placeholders: UPDATE ... WHERE numero IN (?,?,?)
            // Guard extra: AND COALESCE(modelo,65) <> 99 garante que mesmo que
            // a SELECT acima retorne algum gerencial por race condition, o UPDATE
            // nunca os toque — proteção em profundidade.
            var placeholders = novos.map(function() { return "?"; }).join(",");
            var sqlUpd =
                "UPDATE nfce SET " + campo + " = ? " +
                "WHERE numero IN (" + placeholders + ") " +
                "AND COALESCE(modelo,65) <> 99";
            db.query(sqlUpd, [horaAtual].concat(novos), function(errU) {
                if (errU) {
                    // Reverte o Set — UPDATE falhou, poderá tentar novamente depois
                    novos.forEach(function(id) { _nfceCorrigidasHoje.delete(id); });
                    logTs("Poll: ERRO ao corrigir nfce." + campo + ": " + errU.message);
                } else {
                    logTs("Poll: " + novos.length + " venda(s) nfce corrigida(s) para " + horaAtual +
                          " (campo " + campo + ", numero(s): " + novos.join(",") + ").");
                    _correcoesPendentes.push({
                        msg: "🕐 " + novos.length + " venda(s) NFC-e com hora antiga corrigida(s) para " + horaAtual,
                        cor: "rgba(251,191,36,.45)",
                        reload: true  // browser recarrega ~800ms após exibir o toast
                    });
                    // Regenera para que o HTML com hora corrigida esteja pronto quando o browser recarregar.
                    var _dhNfce = dh;
                    try {
                        if (!cache[_dhNfce] || !cache[_dhNfce].gerando) {
                            delete cache[_dhNfce];
                            gerarEmBackground(_dhNfce, _dhNfce, _dhNfce);
                        }
                    } catch(_rgErr) { logTs("WARN _corrigirNfce regen: " + _rgErr.message); }
                }
                _fechar();
            });
        });
    };

    // Primeiro tenta DHORA; em caso de erro na coluna o Firebird retorna erro
    // diferente de "sem linhas", então tentamos HORA como fallback silencioso.
    // Probe também exclui modelo=99 para não confundir detecção de coluna com
    // presença de linhas gerenciais (que têm seu próprio probe em _corrigirHorariosGerencial).
    db.query("SELECT FIRST 1 dhora FROM nfce WHERE data >= ? AND data < ? + 1 AND COALESCE(modelo,65) <> 99", [dh, dh], function(errProbe) {
        if (!errProbe) {
            _corrigirNfceComCampo("dhora");
        } else {
            _corrigirNfceComCampo("hora");
        }
    });

    // ---- pagament: SELECT IDs ainda não corrigidos ----
    // NOTA: usa uma segunda conexão própria para não conflitar com a query nfce acima.
    // Incrementa _pend ANTES de abrir a conexão — garante que _liberar() do ramo nfce
    // não zere o contador antes de pagament ser registrado.
    _pend++; // agora _pend = 2 (nfce ainda em andamento + pagament iniciando)
    var opts2 = {host:FDB_HOST, port:3050, database:FDB_PATH, user:USER, password:PASS,
                 role:null, charset:"UTF8", pageSize:4096, lowercase_keys:false};
    // Timeout global para a conexão pagament — mesma proteção da conexão nfce acima.
    var _cv2Db = null, _cv2Encerrado = false;
    var _cv2Timer = setTimeout(function() {
        if (_cv2Encerrado) return;
        _cv2Encerrado = true;
        logTs("_corrigirHorariosVelhos(pagament): timeout de " + (_QUERY_TIMEOUT_MS/1000) + "s — encerrando conexão.");
        if (_cv2Db) _matarConexao(_cv2Db);
        _liberar(); // timeout = fim do ramo pagament
    }, _QUERY_TIMEOUT_MS);
    Firebird.attach(opts2, function(errConn2, db2) {
        if (_cv2Encerrado) { if (db2) _matarConexao(db2); return; } // timeout já chamou _liberar
        _cv2Db = db2;
        if (errConn2 || !db2) { clearTimeout(_cv2Timer); _liberar(); return; }
        var _fechar2 = function() {
            if (_cv2Encerrado) return;
            _cv2Encerrado = true;
            clearTimeout(_cv2Timer);
            try { db2.detach(); } catch(_) {}
            _liberar(); // fim normal do ramo pagament
        };
        var sqlPagSel =
            "SELECT numero FROM pagament " +
            "WHERE data >= ? AND data < ? + 1 " +
            "AND hora IS NOT NULL " +
            "AND hora < ? " +
            "AND valor > 0";
        db2.query(sqlPagSel, [dh, dh, horaLimite], function(errPS, rowsP) {
            if (errPS) { logTs("Correção pagament.hora: erro na query — "+errPS.message); _fechar2(); return; }
            if (!rowsP || !rowsP.length) { _fechar2(); return; } // silencioso — chamado a cada 200ms

            var novosP = rowsP
                .map(function(r) { return String(r.NUMERO || r.numero || ""); })
                .filter(function(id) { return id && !_pagCorrigidosHoje.has(id); });

            if (!novosP.length) { _fechar2(); return; } // silencioso

            novosP.forEach(function(id) { _pagCorrigidosHoje.add(id); });

            var phP = novosP.map(function() { return "?"; }).join(",");
            var sqlPagUpd =
                "UPDATE pagament SET hora = ? WHERE numero IN (" + phP + ")";
            db2.query(sqlPagUpd, [horaAtual].concat(novosP), function(errPU) {
                if (errPU) {
                    novosP.forEach(function(id) { _pagCorrigidosHoje.delete(id); });
                    logTs("Poll: ERRO ao corrigir pagament.hora: " + errPU.message);
                } else {
                    logTs("Poll: " + novosP.length + " pagamento(s) corrigido(s) para " + horaAtual +
                          " (numero(s): " + novosP.join(",") + ").");
                    _correcoesPendentes.push({
                        msg: "🕐 " + novosP.length + " pagamento(s) com hora antiga corrigido(s) para " + horaAtual,
                        cor: "rgba(251,191,36,.45)",
                        reload: true  // browser recarrega ~800ms após exibir o toast
                    });
                    // Regenera para que o HTML com hora corrigida esteja pronto quando o browser recarregar.
                    var _dhPag = dh;
                    try {
                        if (!cache[_dhPag] || !cache[_dhPag].gerando) {
                            delete cache[_dhPag];
                            gerarEmBackground(_dhPag, _dhPag, _dhPag);
                        }
                    } catch(_rgPErr) { logTs("WARN _corrigirPag regen: " + _rgPErr.message); }
                }
                _fechar2();
            });
        });
    });

    }); // fecha Firebird.attach principal
};

// ---------------------------------------------------------------------------
// Corrige horários de vendas GERENCIAIS (modelo=99 OU modelo IS NULL) com hora futura ou mais
// de 1 minuto atrás.  NFC-e (65) e NF-e (55) nunca são tocados aqui.
// BUG FIX: SmallSoft pode gravar vendas gerenciais com modelo=NULL (em vez de 99).
// Usando (modelo = 99 OR modelo IS NULL) capturamos ambos os casos.
// Persiste no hora-fixada-cache.json para não repetir entre reinicializações.
// NOTA: abre sua própria conexão Firebird — não usa o db do poll para evitar
// race condition com _liberar(db).
// ---------------------------------------------------------------------------
var _corrigirHorariosGerencial = function(_dbIgnorado, dh) {
    // Busy-flag: evita chamadas paralelas (poll a cada 200ms, query ~10-100ms).
    if (_corriGerencialEmAndamento) return;
    _corriGerencialEmAndamento = true;

    // USA O RELÓGIO LOCAL DO SERVIDOR DIRETAMENTE — mesma razão de _corrigirHorariosVelhos.
    // Bug anterior: usava agoraAjustado() com _clientTzOffsetMs=0 → hora UTC errada.
    var _nowMs    = Date.now();
    var _agoraD   = new Date(_nowMs);
    var _threshD  = new Date(_nowMs - _HORA_GERENCIAL_VELHA_MS);
    var p         = function(n) { return String(n).padStart(2, "0"); };
    var horaAtual = p(_agoraD.getHours()) + ":" + p(_agoraD.getMinutes()) + ":" + p(_agoraD.getSeconds());
    var horaLimite= p(_threshD.getHours()) + ":" + p(_threshD.getMinutes()) + ":" + p(_threshD.getSeconds());

    // Guard meia-noite: mesma lógica de _corrigirHorariosVelhos.
    // Bug anterior: usava floor(getTime()/86400000) = dia UTC, não dia LOCAL.
    var _agoraDiaStr  = _agoraD.getFullYear() + "-" + p(_agoraD.getMonth()+1) + "-" + p(_agoraD.getDate());
    var _threshDiaStr = _threshD.getFullYear() + "-" + p(_threshD.getMonth()+1) + "-" + p(_threshD.getDate());
    if (_threshDiaStr < _agoraDiaStr) {
        // guard meia-noite — silencioso para não inundar o log
        _corriGerencialEmAndamento = false;
        return;
    }

    // NÃO loga no início — chamado a cada poll (200ms).
    // Logs apenas quando efetivamente corrige ou ocorre erro.

    var opts = {host:FDB_HOST, port:3050, database:FDB_PATH, user:USER, password:PASS,
                role:null, charset:"UTF8", pageSize:4096, lowercase_keys:false};

    // Timeout global para a conexão gerencial — mesma proteção de _corrigirHorariosVelhos:
    // impede que conexão pendurada vaze para sempre se o Firebird travar após o poll.
    var _cgDb = null, _cgEncerrado = false;
    var _cgTimer = setTimeout(function() {
        if (_cgEncerrado) return;
        _cgEncerrado = true;
        logTs("_corrigirHorariosGerencial: timeout de " + (_QUERY_TIMEOUT_MS/1000) + "s — encerrando conexão.");
        if (_cgDb) _matarConexao(_cgDb);
        _corriGerencialEmAndamento = false; // timeout = fim da função
    }, _QUERY_TIMEOUT_MS);

    Firebird.attach(opts, function(errConn, db) {
        if (_cgEncerrado) { if (db) _matarConexao(db); return; } // timeout já limpou flag
        _cgDb = db;
        if (errConn || !db) { clearTimeout(_cgTimer); _corriGerencialEmAndamento = false; return; }
        var _fechar = function() {
            if (_cgEncerrado) return;
            _cgEncerrado = true;
            clearTimeout(_cgTimer);
            try { db.detach(); } catch(_) {}
            _corriGerencialEmAndamento = false; // fim normal
        };

    var _corrigirComCampo = function(campo) {
        // Busca gerenciais de hoje com hora fora do intervalo aceitável:
        //   hora futura → campo > horaAtual
        //   hora velha  → campo < horaLimite (> 1 min atrás)
        // BUG FIX: (modelo = 99 OR modelo IS NULL) captura gerenciais com campo NULL.
        // O SmallSoft às vezes grava modelo=NULL para vendas "NAO E DOCUMENTO FISCAL".
        var sqlSel =
            "SELECT numero FROM nfce " +
            "WHERE data >= ? AND data < ? + 1 " +
            "AND (modelo = 99 OR modelo IS NULL) " +
            "AND " + campo + " IS NOT NULL " +
            "AND COALESCE(cancelado,'N') NOT IN ('S','T') " +
            "AND total > 0 " +
            "AND (" + campo + " > ? OR " + campo + " < ?)";

        db.query(sqlSel, [dh, dh, horaAtual, horaLimite], function(errS, rows) {
            if (errS) { logTs("Correção gerencial."+campo+": erro na query — "+errS.message); _fechar(); return; }
            if (!rows || !rows.length) { _fechar(); return; } // nenhum para corrigir — silencioso

            // Filtra apenas os que ainda não foram corrigidos (cache persistente)
            var novos = rows
                .map(function(r) { return String(r.NUMERO || r.numero || ""); })
                .filter(function(id) {
                    if (!id) return false;
                    return !_horaFixadaCache[dh + "|" + id];
                });

            if (!novos.length) { _fechar(); return; } // todos já fixados — silencioso

            // Marca no cache ANTES do UPDATE — evita dupla correção em paralelo
            novos.forEach(function(id) {
                _horaFixadaCache[dh + "|" + id] = horaAtual;
            });
            _salvarHoraFixadaCache();

            var placeholders = novos.map(function() { return "?"; }).join(",");
            // BUG FIX: UPDATE também usa (modelo = 99 OR modelo IS NULL)
            // para garantir que a mesma venda encontrada pelo SELECT seja atualizada.
            var sqlUpd =
                "UPDATE nfce SET " + campo + " = ? " +
                "WHERE numero IN (" + placeholders + ") " +
                "AND (modelo = 99 OR modelo IS NULL)";

            db.query(sqlUpd, [horaAtual].concat(novos), function(errU) {
                if (errU) {
                    // Reverte entradas do cache — poderá tentar novamente depois
                    novos.forEach(function(id) { delete _horaFixadaCache[dh + "|" + id]; });
                    _salvarHoraFixadaCache();
                    logTs("Poll: ERRO ao corrigir gerencial." + campo + ": " + errU.message);
                } else {
                    logTs("Poll: " + novos.length + " gerencial(is) corrigido(s) para " + horaAtual +
                          " (campo " + campo + ", numero(s): " + novos.join(",") + ").");
                    _correcoesPendentes.push({
                        msg: "🕐 " + novos.length + " gerencial(is) com hora corrigido(s) para " + horaAtual,
                        cor: "rgba(167,139,250,.45)",
                        reload: true  // browser recarrega ~800ms após exibir o toast
                    });
                    // Regenera para que o HTML com hora corrigida esteja pronto quando o browser recarregar.
                    var _dhGer = dh;
                    try {
                        if (!cache[_dhGer] || !cache[_dhGer].gerando) {
                            delete cache[_dhGer];
                            gerarEmBackground(_dhGer, _dhGer, _dhGer);
                        }
                    } catch(_rgGErr) { logTs("WARN _corrigirGer regen: " + _rgGErr.message); }
                }
                _fechar();
            });
        });
    };

    // Detecta campo correto (DHORA ou HORA) com probe silencioso
    // BUG FIX: probe também usa (modelo=99 OR modelo IS NULL)
    db.query(
        "SELECT FIRST 1 dhora FROM nfce WHERE data >= ? AND data < ? + 1 AND (modelo = 99 OR modelo IS NULL)",
        [dh, dh],
        function(errProbe) {
            if (!errProbe) {
                _corrigirComCampo("dhora");
            } else {
                _corrigirComCampo("hora");
            }
        }
    );

    }); // fecha Firebird.attach
};

var pollStatus = function() {
    if (!Firebird || _pollBusy || !dbStatus.ok) return;
    _pollBusy = true;
    var dh   = hoje();
    var opts = {host:FDB_HOST, port:3050, database:FDB_PATH, user:USER, password:PASS,
                role:null, charset:"UTF8", pageSize:4096, lowercase_keys:false};

    // Libera recursos e _pollBusy após qualquer desfecho
    var _liberar = function(db) {
        clearTimeout(_watchdog);
        if (db) _matarConexao(db);
        _pollBusy = false;
    };

    // Watchdog de segurança — impede _pollBusy travado para sempre
    var _watchdog = setTimeout(function() {
        logTs("Poll: watchdog geral de 12 s disparado — liberando _pollBusy.");
        if (_dbRef) { try { _matarConexao(_dbRef); } catch(_) {} }
        _matarTodosFilhos();
        _pollBusy = false;
    }, 12000);

    // --- Timeout no próprio attach (banco pode demorar a aceitar conexão) ---
    var _dbRef       = null;
    var _attachFeito = false;
    var _attachTimer = setTimeout(function() {
        if (_attachFeito) return;
        _attachFeito = true;
        logTs("Poll: attach passou de " + (_QUERY_TIMEOUT_MS/1000) + "s — abortando e refazendo.");
        if (_dbRef) _matarConexao(_dbRef);
        _matarTodosFilhos();
        clearTimeout(_watchdog);
        _pollBusy = false;
        setTimeout(pollStatus, 500);
    }, _QUERY_TIMEOUT_MS);

    Firebird.attach(opts, function(err, db) {
        if (_attachFeito) { if (db) _matarConexao(db); return; } // timeout já disparou
        _attachFeito = true;
        clearTimeout(_attachTimer);
        _dbRef = db;

        if (err) { clearTimeout(_watchdog); _pollBusy = false; return; }

        // SQL única com IIF por tipo: gerencial(99), NFC-e(65), NF-e(55) e pagamentos.
        // Detecta > e < para cada tipo a cada POLL_INTERVAL (config.json).
        // NF-e (modelo=55) estava ausente na versão anterior — agora incluído.
        var sql =
            "SELECT" +
            " COALESCE(SUM(IIF(tipo=99,1,0)),0) AS QT_G," +
            " COALESCE(SUM(IIF(tipo=99,tot,0)),0) AS TOT_G," +
            " COALESCE(SUM(IIF(tipo=65,1,0)),0) AS QT_NFC," +
            " COALESCE(SUM(IIF(tipo=65,tot,0)),0) AS TOT_NFC," +
            " COALESCE(SUM(IIF(tipo=55,1,0)),0) AS QT_NF," +
            " COALESCE(SUM(IIF(tipo=55,tot,0)),0) AS TOT_NF," +
            " COALESCE(SUM(IIF(tipo=0,1,0)),0) AS QT_PAG," +
            " COALESCE(SUM(IIF(tipo=0,tot,0)),0) AS TOT_PAG" +
            " FROM (" +
            " SELECT COALESCE(modelo,65) AS tipo, total AS tot" +
            " FROM nfce" +
            " WHERE data >= ? AND data < ? + 1" +
            " AND COALESCE(cancelado,'N') NOT IN ('S','T')" +
            " AND total > 0" +
            " UNION ALL" +
            " SELECT 0 AS tipo, valor AS tot" +
            " FROM pagament" +
            " WHERE data >= ? AND data < ? + 1" +
            " AND valor > 0" +
            " AND SUBSTRING(forma FROM 1 FOR 2) NOT IN ('00','13')" +
            " ) t";

        _executarConsultaPoll(db, sql, [dh, dh, dh, dh], function(e, rows) {
            // rows===null && e===null → timeout do socket — _matarConexao já foi chamado
            if (rows === null && e === null) {
                clearTimeout(_watchdog);
                _pollBusy = false;
                setTimeout(pollStatus, 500); // refaz após 500 ms
                return;
            }

            if (e || !rows || !rows.length) { _liberar(db); return; }

            var r = rows[0];
            // Suporte a casing variável retornado pelo node-firebird
            var n = function(k) { return Number(r[k] || r[k.toLowerCase()] || 0); };

            var qtG   = n("QT_G"),   totG   = n("TOT_G");
            var qtNFC = n("QT_NFC"), totNFC = n("TOT_NFC");
            var qtNF  = n("QT_NF"),  totNF  = n("TOT_NF");
            var qtPAG = n("QT_PAG"), totPAG = n("TOT_PAG");

            // Totais combinados — mantidos para SSE, arScript e cache
            var qt  = qtG + qtNFC + qtNF + qtPAG;
            var tot = totG + totNFC + totNF + totPAG;

            // Busy-flag interno de cada função impede paralelismo — detecção a cada poll (≤200ms).
            // Não precisa de throttle: o flag libera assim que a query Firebird termina (~10-100ms local).
            _corrigirHorariosVelhos(db, dh);
            _corrigirHorariosGerencial(db, dh);

            // -------------------------------------------------------------------
            // Detecção de mudança por tipo: gerencial, NFC-e, NF-e
            // Emite ">" quando subiu e "<" quando caiu.
            // Detectado a cada POLL_INTERVAL (config.json).
            // -------------------------------------------------------------------
            var novoTipo = {
                g:   {qt: qtG,   tot: totG},
                nfc: {qt: qtNFC, tot: totNFC},
                nf:  {qt: qtNF,  tot: totNF}
            };
            var resultado = _descreverMudancaTipo(statusAtual, novoTipo);

            // Fallback: se os campos por tipo ainda não têm baseline (primeira execução
            // do poll), usa a comparação global para não perder mudanças na inicialização.
            if (!resultado.mudou && statusAtual.qt >= 0 &&
                (qt !== statusAtual.qt || Math.abs(tot - statusAtual.total) > 0.005)) {
                resultado = {
                    mudou: true,
                    descricao: _descreverMudanca(statusAtual.qt, qt, statusAtual.total||0, tot)
                };
            }

            if (resultado.mudou) {
                logTs("Dados alterados: " + resultado.descricao + " → regerando.");
                // SSE NÃO é disparado aqui. É disparado em gerarEmBackground (proc.on("close"))
                // quando o HTML está pronto, via _pollTriggered=true.
                // Disparar SSE antes do HTML existir forçava o browser para paginaLoading,
                // adicionando 800ms de poll + 600ms de animação a cada detecção de venda.
                delete cache[dh];
                gerarEmBackground(dh, dh, dh, true); // _pollTriggered=true → SSE após HTML pronto
            }

            statusAtual = Object.assign({}, statusAtual, {
                qt: qt, total: tot, ts: Date.now(),
                g:   {qt: qtG,   tot: totG},
                nfc: {qt: qtNFC, tot: totNFC},
                nf:  {qt: qtNF,  tot: totNF}
            });
            _liberar(db);
        });
    });
};

// ---------------------------------------------------------------------------
// Regeneração periódica do relatório de hoje — loop intencional que garante
// que o HTML esteja sempre atualizado em disco.
// A DETECÇÃO de mudanças de dados é feita exclusivamente pelo pollStatus;
// agendarRegen apenas regenera se nenhuma geração estiver em andamento.
// ---------------------------------------------------------------------------

// Cooldown mínimo entre regenerações após sucesso.
// CORREÇÃO DE BUG: sem esse cooldown, o agendarRegen deletava o cache e
// relançava a geração (gerando:true) antes que o browser conseguisse redirecionar
// e exibir o HTML (o redirect leva ~600ms após o paginaLoading detectar pronto:true).
// Resultado: loop infinito em paginaLoading mesmo com o HTML já gerado.
// O cooldown precisa ser maior que: SPAWN_TIMEOUT_CFG + 600ms de animação + margem.
// Bug do loop em paginaLoading foi eliminado (SSE só dispara após HTML pronto).
// Cooldown pode ser reduzido para ~3 s — apenas > tempo de geração (~1-2 s).
var _REGEN_COOLDOWN_MS = 500;  // ent.gerando já bloqueia concorrência — cooldown só evita thrash

// Intervalo de verificação da regeneração periódica — INDEPENDENTE do POLL_INTERVAL.
// Antes usava POLL_INTERVAL (200ms): checava 5× por segundo se devia regererar,
// sobrecarregando o event loop sem benefício (a geração real é limitada pelo cooldown).
// Agora usa intervalo fixo de 30s — suficiente, pois mudanças reais chegam via pollStatus.
// Fallback quando fast-poll/pollStatus falham — checa a cada 3 s em vez de 30 s.
var _REGEN_CHECK_MS = 200;  // checa a cada 200ms — fallback detecta em ≤2s

var agendarRegen = function() {
    setTimeout(function() {
        var dh = hoje();
        var ent = cache[dh];
        // Bloqueia regeneração se:
        //   ent.gerando   → geração em andamento
        //   ent.matando   → processo sendo encerrado por timeout
        //   ent.geradoEm presente e dentro do cooldown → HTML recém-gerado,
        //       browser ainda não teve chance de redirecionar e exibir o conteúdo.
        var _podeRegen = !ent
            || (!ent.gerando && !ent.matando
                && (!ent.geradoEm || (Date.now() - ent.geradoEm) >= _REGEN_COOLDOWN_MS));
        if (_podeRegen) {
            delete cache[dh];
            gerarEmBackground(dh, dh, dh);
        }
        agendarRegen();
    }, _REGEN_CHECK_MS);
};

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------
var htmlFavicon="<link rel=\"icon\" type=\"image/png\" href=\"/favicon.png\">";

var paginaLoading=function(titulo,sub,chavePoll,urlDest){
    var p="/pronto?k="+encodeURIComponent(chavePoll);
    var dJs=JSON.stringify(urlDest);
    var SC2="</"+"script>";
    // SVGs injetados como variáveis JS — browser usa sem depender do servidor
    var jsVars=
        "var _TMS="+_SPAWN_TIMEOUT_MS+";" + // timeout configurado no servidor
        "var _SVGT="+JSON.stringify(SVG_TIMER)+";" +
        "var _SVGR="+JSON.stringify(SVG_RETRY)+";" +
        "var _SVGW="+JSON.stringify(SVG_WARN)+";";

    return "<!doctype html><html lang=\"pt-br\"><head><meta charset=\"utf-8\">"+htmlFavicon+
        "<title>Gerando...</title>"+
        // Aplica tema antes do primeiro render — evita flash
        "<script>(function(){try{var t=localStorage.getItem('fdb_theme')||(document.cookie.match(/fdb_theme=([^;]+)/)||[])[1]||'ultra-dark';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();"+SC2+
        "<style>" +
        "*{box-sizing:border-box}" +
        "body{margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:Inter,Arial,sans-serif;color:#ededed}" +
        ".box{text-align:center;padding:40px 28px;max-width:440px;width:100%}" +
        // Spinner — velocidade e cor mudam conforme estado
        ".spin{width:48px;height:48px;border:3px solid rgba(255,255,255,.1);border-top-color:#0ea5e9;" +
        "border-radius:50%;animation:sp .8s linear infinite;margin:0 auto 24px;transition:border-top-color .25s,animation-duration .25s}" +
        ".spin.kill{border-top-color:#f87171;animation-duration:.35s}" +
        ".spin.retry{border-top-color:#fb923c;animation-duration:.55s}" +
        ".spin.semresp{border-top-color:#71717a;animation-duration:1.2s}" +
        ".spin.pronto{border-top-color:#4ade80;animation-duration:.5s}" +
        "@keyframes sp{to{transform:rotate(360deg)}}" +
        // Título muda de cor conforme estado
        "h2{margin:0 0 6px;font-size:20px;font-weight:700;transition:color .25s}" +
        "h2.kill{color:#f87171}" +
        "h2.retry{color:#fb923c}" +
        "h2.semresp{color:#71717a}" +
        "h2.pronto{color:#4ade80}" +
        ".sub{color:#a1a1aa;font-size:14px}" +
        ".tempo{color:#71717a;font-size:13px;margin-top:12px;font-variant-numeric:tabular-nums}" +
        // Caixa de status — aparece abaixo do contador, animada
        "#sb{display:none;margin-top:18px;padding:13px 16px;border-radius:10px;" +
        "font-size:13px;font-weight:600;line-height:1.5;text-align:left;animation:fdin .2s ease}" +
        "@keyframes fdin{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}" +
        "#sb.kill{background:rgba(248,113,113,.1);color:#f87171;border:1px solid rgba(248,113,113,.35)}" +
        "#sb.retry{background:rgba(251,146,60,.1);color:#fb923c;border:1px solid rgba(251,146,60,.35)}" +
        "#sb.semresp{background:rgba(113,113,122,.1);color:#a1a1aa;border:1px solid rgba(113,113,122,.25)}" +
        "#sb.pronto{background:rgba(74,222,128,.08);color:#4ade80;border:1px solid rgba(74,222,128,.3)}" +
        ".sr{display:flex;align-items:flex-start;gap:10px}" +   // sb-row
        ".si{flex-shrink:0;margin-top:1px}" +                   // sb-icon
        ".st strong{display:block}" +                            // sb-title
        ".st span{display:block;font-size:11px;font-weight:400;opacity:.8;margin-top:3px}" + // sb-detail
        "</style></head><body>" +
        "<div class=\"box\">" +
        "<div class=\"spin\" id=\"_sp\"></div>" +
        "<h2 id=\"_ht\">"+escH(titulo)+"</h2>" +
        "<div class=\"sub\">"+escH(sub)+"</div>" +
        "<div class=\"tempo\" id=\"_t\">Aguarde...</div>" +
        "<div id=\"sb\"></div>" +
        "</div>" +
        "<script>" +
        jsVars +
        "var _t0=Date.now(),_dest="+dJs+";" +
        "var _el=document.getElementById('_t');" +
        "var _sp=document.getElementById('_sp');" +
        "var _ht=document.getElementById('_ht');" +
        "var _sb=document.getElementById('sb');" +
        "var _MAX=5,_prev=null;" +
        // _setState: aplica estado visual em todos os elementos de uma vez.
        // _prev guarda o último cls — evita redraw idêntico no estado normal,
        // mas sempre re-renderiza quando html é fornecido (kill, retry, semresp).
        "function _setState(cls,html){" +
        "var same=cls===_prev;" +
        "if(same&&!html){return;}" + // normal→normal: sem nada a mudar
        "_prev=cls;" +
        "if(_sp)_sp.className='spin'+(cls?' '+cls:'');" +
        "if(_ht)_ht.className=cls||'';" +
        "if(_sb){" +
        "if(html){_sb.className=cls;_sb.innerHTML=html;_sb.style.display='block';}" +
        "else{_sb.style.display='none';_sb.innerHTML='';_sb.className='';}" +
        "}}" +
        // _sbHtml: monta o HTML interno da caixa de status
        "function _sbHtml(ico,title,detail){" +
        "return '<div class=\"sr\"><span class=\"si\">'+ico+'</span><span class=\"st\"><strong>'+title+'</strong><span>'+detail+'</span></span></div>';}" +
        // poll principal — 80ms quando ativo (era 150ms), 500ms em erro de rede
        "var _poll=function(){fetch('"+p+"',{cache:'no-store'})" +
        ".then(function(r){return r.ok?r.json():r.json().catch(function(){return{pronto:false,erro:null,tentativa:1,matando:false};});})" +
        ".then(function(d){" +
        "try{" +
        "if(!d||typeof d!=='object'){setTimeout(_poll,300);return;}" +
        "var seg=Math.floor((Date.now()-_t0)/1000);" +
        // Erro definitivo → substitui a página inteira
        "if(d.erro){document.body.innerHTML='<div style=\"padding:40px;font-family:monospace\">" +
        "<h2 style=\"color:#f87171\">Erro</h2>" +
        "<pre style=\"color:#f87171;white-space:pre-wrap\">'+d.erro+'<\\/pre>" +
        "<p><a href=\"/\" style=\"color:#0ea5e9\">Tentar novamente<\\/a><\\/p><\\/div>';return;}" +
        // Pronto → mostra estado verde por 100ms antes de redirecionar (era 600ms)
        "if(d.pronto){" +
        "var _svgOk='<svg xmlns=\"http:\\/\\/www.w3.org\\/2000\\/svg\" width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" style=\"display:inline;vertical-align:-2px;margin-right:4px\"><path d=\"M20 6 9 17l-5-5\"\\/><\\/svg>';" +
        "if(_sp)_sp.className='spin pronto';" +
        "if(_ht)_ht.className='pronto';" +
        "if(_sb){_sb.className='pronto';_sb.innerHTML=_sbHtml(_svgOk,'Relatório pronto!','Redirecionando...');_sb.style.display='block';}" +
        "setTimeout(function(){window.location.replace(_dest);},100);return;}" +
        // Atualiza contador de segundos
        "if(_el)_el.textContent='Consultando banco... '+seg+'s';" +
        // Estado KILL — processo filho encerrado por timeout, aguardando relançamento
        "if(d.matando){" +
        "_setState('kill',_sbHtml(_SVGT," +
        "'Processo encerrado — timeout de '+(_TMS/1000)+'s'," +
        "'Aguardando relançamento da consulta em 3s...'));" +
        // Estado RETRY — nova tentativa em andamento após kill anterior
        "}else if(d.tentativa>1){" +
        "_setState('retry',_sbHtml(_SVGR," +
        "'Tentativa '+d.tentativa+' de '+_MAX," +
        "'Tentativa anterior excedeu '+(_TMS/1000)+'s — refazendo consulta ao banco...'));" +
        // Estado NORMAL — geração em progresso sem intercorrências
        "}else{_setState('',null);}" +
        "setTimeout(_poll,80);" +
        "}catch(e){console.error('[poll]',e);setTimeout(_poll,300);}" +
        "})" +
        // Erro de rede puro (sem resposta) — estado semresp
        ".catch(function(){" +
        "_setState('semresp',_sbHtml(_SVGW," +
        "'Sem resposta do servidor'," +
        "'Aguardando reconexão...'));" +
        "setTimeout(_poll,500);});" +
        // SSE na paginaLoading — redireciona no exato instante que proc.on("close") emite reload,
        // sem depender do ciclo de poll (eliminando até 80ms + 100ms de espera no caminho feliz).
        "};var _pEs=null,_pConn=function(){" +
        "try{_pEs=new EventSource('/api/events');" +
        "_pEs.onmessage=function(ev){try{var d=JSON.parse(ev.data);" +
        "if(d.type==='reload'){window.location.replace(_dest);}" +
        "}catch(_){};};" +
        "_pEs.onopen=function(){" +
        // Ao conectar SSE, verifica /pronto imediatamente — HTML pode já estar pronto
        // se a geração terminou antes da conexão SSE ser estabelecida.
        "fetch('"+p+"',{cache:'no-store'}).then(function(r){return r.ok?r.json():null;})" +
        ".then(function(d){if(d&&d.pronto)window.location.replace(_dest);}).catch(function(){});" +
        "};" +
        "_pEs.onerror=function(){if(_pEs){_pEs.close();_pEs=null;}setTimeout(_pConn,3000);};" +
        "}catch(e){setTimeout(_pConn,5000);}};_pConn();" +
        "setTimeout(_poll,80);" +
        SC2+"</body></html>";
};

var paginaErro=function(titulo,msg,href){
    return "<!doctype html><html lang=\"pt-br\"><head><meta charset=\"utf-8\">"+htmlFavicon+
        "<title>Erro</title><style>body{background:#000;color:#ededed;font-family:monospace;padding:40px;max-width:700px;margin:0 auto}a{color:#0ea5e9}</style></head><body>"+
        "<h2 style=\"color:#f87171\">"+escH(titulo)+"</h2>"+
        "<pre style=\"color:#f87171;white-space:pre-wrap\">"+escH(msg)+"</pre>"+
        "<p><a href=\""+escH(href)+"\">Tentar novamente</a></p>"+
        "<p><a href=\"/selecionar-fdb\">Selecionar banco manualmente (SMALL.FDB)</a></p>"+
        "</body></html>";
};

var paginaFormPeriodo=function(dHoje){
    return "<!doctype html><html lang=\"pt-br\"><head><meta charset=\"utf-8\">"+htmlFavicon+
        "<title>Gerar por periodo</title>"+
        "<style>*{box-sizing:border-box}body{margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:Inter,Arial,sans-serif;color:#ededed}.box{background:#0a0a0a;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:36px 40px;width:90%;max-width:380px}h2{margin:0 0 24px;font-size:20px;font-weight:700}label{display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#a1a1aa;margin-bottom:6px}input[type=date]{display:block;width:100%;background:#000;color:#ededed;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:10px 14px;font-size:14px;margin-bottom:20px;color-scheme:dark;outline:none}input[type=date]:focus{border-color:#0ea5e9}button{width:100%;padding:14px;background:#0ea5e9;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer}button:hover{background:#0284c7}button:disabled{opacity:.5;cursor:not-allowed}.back{display:block;text-align:center;margin-top:14px;color:#a1a1aa;font-size:13px;text-decoration:none}.back:hover{color:#ededed}#err{display:none;color:#f87171;font-size:13px;margin-bottom:12px;padding:10px;background:rgba(248,113,113,.1);border-radius:6px}"+
        "</style></head><body><div class=\"box\"><h2>Gerar por periodo</h2>"+
        "<div id=\"err\"></div><label>Data inicial</label>"+
        "<input type=\"date\" id=\"ini\" value=\""+dHoje+"\">"+
        "<label>Data final</label><input type=\"date\" id=\"fim\" value=\""+dHoje+"\">"+
        "<button id=\"bg\" onclick=\"gerar()\">Gerar Relatorio</button>"+
        "<a href=\"/\" class=\"back\">Voltar para hoje</a></div>"+
        "<script>function gerar(){var i=document.getElementById('ini').value,"+
        "f=document.getElementById('fim').value,"+
        "e=document.getElementById('err'),b=document.getElementById('bg');"+
        "if(!i||!f){e.textContent='Informe as duas datas.';e.style.display='block';return;}"+
        "if(i>f){e.textContent='Data inicial deve ser anterior ou igual a final.';e.style.display='block';return;}"+
        "e.style.display='none';b.disabled=true;b.textContent='Gerando...';"+
        "window.location.href='/periodo?i='+encodeURIComponent(i)+'&f='+encodeURIComponent(f);}"+
        "['ini','fim'].forEach(function(id){document.getElementById(id).addEventListener('keydown',function(e){if(e.key==='Enter')gerar();});});"+
        "</script></body></html>";
};

// ---------------------------------------------------------------------------
// paginaEscolherFdb — exibida quando FDB não é encontrado automaticamente.
// Permite ao usuario informar o caminho do SMALL.FDB via:
//   1) Dialogo nativo Windows (OpenFileDialog via PowerShell — botao Procurar)
//   2) Campo de texto (colar o caminho manualmente)
// ---------------------------------------------------------------------------
var paginaEscolherFdb = function(erroAnterior) {
    var SC4 = "</" + "script>";
    var msgErro = erroAnterior
        ? "<div id=\"err\" style=\"display:block;color:#f87171;font-size:13px;margin-bottom:16px;padding:10px 14px;background:rgba(248,113,113,.1);border-radius:8px\">"+escH(erroAnterior)+"</div>"
        : "<div id=\"err\" style=\"display:none\"></div>";

    return "<!doctype html><html lang=\"pt-br\"><head><meta charset=\"utf-8\">" + htmlFavicon +
        "<title>Selecionar Banco de Dados</title>" +
        "<script>(function(){try{var t=localStorage.getItem('fdb_theme')||(document.cookie.match(/fdb_theme=([^;]+)/)||[])[1]||'ultra-dark';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();" + SC4 +
        "<style>" +
        "*{box-sizing:border-box}" +
        "body{margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:Inter,Arial,sans-serif;color:#ededed;padding:16px}" +
        ".box{background:#0a0a0a;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:36px 40px;width:100%;max-width:520px}" +
        ".ico{font-size:40px;margin-bottom:16px;display:block;text-align:center}" +
        "h2{margin:0 0 6px;font-size:20px;font-weight:700;text-align:center}" +
        ".sub{color:#71717a;font-size:13px;margin-bottom:24px;text-align:center;line-height:1.5}" +
        "label{display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#a1a1aa;margin-bottom:7px}" +
        ".row-inp{display:flex;gap:8px;margin-bottom:8px}" +
        "input[type=text]{flex:1;background:#000;color:#ededed;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:10px 14px;font-size:13px;font-family:monospace;outline:none;min-width:0}" +
        "input[type=text]:focus{border-color:#0ea5e9}" +
        ".btn{padding:10px 18px;background:#0ea5e9;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}" +
        ".btn:hover{background:#0284c7}.btn:disabled{opacity:.5;cursor:not-allowed}" +
        ".btn-sec{background:rgba(255,255,255,.08);color:#ededed}" +
        ".btn-sec:hover{background:rgba(255,255,255,.14)}" +
        ".btn-full{width:100%;padding:14px;font-size:15px;margin-top:4px}" +
        ".hint{font-size:12px;color:#52525b;margin-bottom:20px;line-height:1.5}" +
        ".sep{border:none;border-top:1px solid rgba(255,255,255,.07);margin:20px 0}" +
        ".cands{margin:0;padding:0;list-style:none}" +
        ".cands li{font-size:12px;font-family:monospace;color:#52525b;padding:3px 0;cursor:pointer;transition:color .15s}" +
        ".cands li:hover{color:#0ea5e9}" +
        "#spin{display:none;width:16px;height:16px;border:2px solid rgba(255,255,255,.15);border-top-color:#0ea5e9;border-radius:50%;animation:s .7s linear infinite;margin:0 auto}" +
        "@keyframes s{to{transform:rotate(360deg)}}" +
        "</style></head><body>" +
        "<div class=\"box\">" +
        "<span class=\"ico\">" + SVG_DATABASE + "</span>" +
        "<h2>Banco de dados não encontrado</h2>" +
        "<p class=\"sub\">O arquivo <strong>SMALL.FDB</strong> não foi localizado automaticamente.<br>Informe o caminho correto para continuar.</p>" +
        msgErro +
        "<label>Caminho do arquivo SMALL.FDB</label>" +
        "<div class=\"row-inp\">" +
        "<input type=\"text\" id=\"fdbPath\" placeholder=\"Ex: C:\\Program Files (x86)\\SmallSoft\\Small Commerce\\SMALL.FDB\">" +
        "<button class=\"btn btn-sec\" id=\"btnPicker\" title=\"Abrir seletor de arquivos do Windows\">" + SVG_FOLDER + "Procurar</button>" +
        "</div>" +
        "<p class=\"hint\">Cole o caminho completo ou use o botão <strong>Procurar</strong> para abrir o explorador de arquivos do Windows.</p>" +
        "<button class=\"btn btn-full\" id=\"btnSalvar\" onclick=\"salvar()\">Conectar ao Banco</button>" +
        "<div id=\"spin\" style=\"margin-top:16px\"></div>" +
        "<hr class=\"sep\">" +
        "<p style=\"font-size:12px;color:#52525b;margin:0 0 8px\">Locais comuns:</p>" +
        "<ul class=\"cands\" id=\"cands\"></ul>" +
        "</div>" +
        "<script>" +
        "(function(){" +
        // Candidatos comuns — clique para preencher o campo
        "var cands=[" +
        "'C:\\\\Program Files (x86)\\\\SmallSoft\\\\Small Commerce\\\\SMALL.FDB'," +
        "'C:\\\\Program Files\\\\SmallSoft\\\\Small Commerce\\\\SMALL.FDB'," +
        "'C:\\\\ProgramData\\\\SmallSoft\\\\Small Commerce\\\\SMALL.FDB'," +
        "'C:\\\\SmallSoft\\\\Small Commerce\\\\SMALL.FDB'," +
        "'C:\\\\Dados\\\\SMALL.FDB'," +
        "'C:\\\\SmallCommerce\\\\SMALL.FDB'" +
        "];" +
        "var ul=document.getElementById('cands');" +
        "cands.forEach(function(c){" +
        "var li=document.createElement('li');" +
        "li.textContent=c;" +
        "li.title='Clique para usar este caminho';" +
        "li.addEventListener('click',function(){document.getElementById('fdbPath').value=c;});" +
        "ul.appendChild(li);" +
        "});" +
        // Botão Procurar — chama /api/abrir-picker-fdb que spawna OpenFileDialog nativo
        "document.getElementById('btnPicker').addEventListener('click',function(){" +
        "var btn=this;" +
        "btn.disabled=true;btn.textContent='Aguarde...';" +
        "document.getElementById('spin').style.display='block';" +
        "fetch('/api/abrir-picker-fdb',{cache:'no-store'})" +
        ".then(function(r){return r.json();})" +
        ".then(function(d){" +
        "btn.disabled=false;btn.innerHTML=" + JSON.stringify(SVG_FOLDER + "Procurar") + ";" +
        "document.getElementById('spin').style.display='none';" +
        "if(d.ok&&d.caminho){document.getElementById('fdbPath').value=d.caminho;}" +
        "else if(d.cancelado){/* usuario cancelou — sem acao */}" +
        "else{mostrarErro(d.erro||'Não foi possível abrir o seletor de arquivos.');}}" +
        ")" +
        ".catch(function(e){" +
        "btn.disabled=false;btn.innerHTML=" + JSON.stringify(SVG_FOLDER + "Procurar") + ";" +
        "document.getElementById('spin').style.display='none';" +
        "mostrarErro('Erro ao abrir seletor: '+e.message);" +
        "});" +
        "});" +
        // Tecla Enter no campo dispara salvar
        "document.getElementById('fdbPath').addEventListener('keydown',function(e){" +
        "if(e.key==='Enter')salvar();" +
        "});" +
        "})();" +
        "function salvar(){" +
        "var p=document.getElementById('fdbPath').value.trim();" +
        "var btn=document.getElementById('btnSalvar');" +
        "if(!p){mostrarErro('Informe o caminho do arquivo SMALL.FDB.');return;}" +
        "if(!/\\.fdb$/i.test(p)){mostrarErro('O arquivo deve ter extensão .fdb');return;}" +
        "btn.disabled=true;btn.textContent='Conectando...';" +
        "document.getElementById('spin').style.display='block';" +
        "document.getElementById('err').style.display='none';" +
        "fetch('/api/salvar-fdb',{method:'POST'," +
        "headers:{'Content-Type':'application/json'}," +
        "body:JSON.stringify({caminho:p})})" +
        ".then(function(r){return r.json();})" +
        ".then(function(d){" +
        "if(d.ok){window.location.replace('/');}" +
        "else{" +
        "btn.disabled=false;btn.textContent='Conectar ao Banco';" +
        "document.getElementById('spin').style.display='none';" +
        "mostrarErro(d.erro||'Não foi possível conectar ao banco.');}" +
        "})" +
        ".catch(function(e){" +
        "btn.disabled=false;btn.textContent='Conectar ao Banco';" +
        "document.getElementById('spin').style.display='none';" +
        "mostrarErro('Erro de rede: '+e.message);" +
        "});" +
        "}" +
        "function mostrarErro(t){" +
        "var e=document.getElementById('err');" +
        "e.textContent=t;e.style.display='block';" +
        "window.scrollTo({top:0,behavior:'smooth'});" +
        "}" +
        SC4 +
        "</body></html>";
};

// ---------------------------------------------------------------------------
// Abre diálogo nativo Windows para selecionar arquivo .fdb.
// Usa PowerShell + System.Windows.Forms:
//   • Form pai criado com Text=APP_NAME e Icon=FAVICON (branding da loja).
//   • OpenFileDialog exibido via ShowDialog($form) para herdar o branding.
// Retorna { ok, caminho } | { ok:false, erro } | { cancelado:true }.
// ---------------------------------------------------------------------------
var abrirPickerFdbWindows = function(cb) {
    // Escapa aspas simples para PowerShell (single-quoted strings: ' → '')
    var psNome  = APP_NAME.replace(/'/g, "''");
    var psIcone = FAVICON.replace(/'/g, "''"); // backslashes são literais em PS single-quoted

    // Script PowerShell: cria Form pai (com nome e ícone da loja) antes de chamar
    // ShowDialog($f), garantindo que o diálogo nativo exiba o branding correto.
    var ps = [
        "Add-Type -AssemblyName System.Windows.Forms;",
        "Add-Type -AssemblyName System.Drawing;",
        "$f = New-Object System.Windows.Forms.Form;",
        "$f.Text = '" + psNome + "';",
        "$f.ShowInTaskbar = $true;",
        "$f.WindowState = [System.Windows.Forms.FormWindowState]::Minimized;",
        "try { if (Test-Path '" + psIcone + "') { $f.Icon = New-Object System.Drawing.Icon('" + psIcone + "') } } catch {};",
        "$f.Show();",
        "$d = New-Object System.Windows.Forms.OpenFileDialog;",
        "$d.Title = '" + psNome + " \u2014 Selecionar banco de dados (.fdb)';",
        "$d.Filter = 'Banco Firebird (*.fdb)|*.fdb|Todos os arquivos (*.*)|*.*';",
        "$d.InitialDirectory = 'C:\\';",
        "if ($d.ShowDialog($f) -eq 'OK') { Write-Output $d.FileName } else { Write-Output '__CANCELADO__' };",
        "$f.Close()"
    ].join(" ");

    var resultado = "";
    var proc = spawn("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command", ps
    ], { stdio: ["ignore", "pipe", "pipe"] });

    proc.stdout.on("data", function(d) { resultado += d.toString(); });

    proc.on("error", function(e) {
        cb({ ok: false, erro: "PowerShell não disponível: " + e.message });
    });

    proc.on("close", function(code) {
        var caminho = resultado.trim().replace(/\r?\n[\s\S]*$/, "").trim();
        if (!caminho || caminho === "__CANCELADO__") {
            cb({ ok: false, cancelado: true });
        } else {
            cb({ ok: true, caminho: caminho });
        }
    });
};

// ---------------------------------------------------------------------------
// Aplica novo caminho FDB em memória e reinicia conexão com o banco.
// Salva fdbPath e fbHost no config.json para persistir entre reinicializações.
// ---------------------------------------------------------------------------
var aplicarNovoFdb = function(caminhoBruto, cb) {
    // Aceita formatos: "C:\...\SMALL.FDB" ou "192.168.1.10:C:\...\SMALL.FDB"
    var parsed = parseFdb(caminhoBruto);
    var novoHost = parsed.host;
    var novoPath = parsed.dbPath;

    // Validação: arquivo deve existir localmente se host for 127.0.0.1
    if (novoHost === "127.0.0.1") {
        try {
            if (!fs.existsSync(novoPath)) {
                cb({ ok: false, erro: "Arquivo não encontrado: " + novoPath });
                return;
            }
        } catch(e) {
            cb({ ok: false, erro: "Erro ao verificar arquivo: " + e.message });
            return;
        }
    }

    logTs("[FDB Manual] Testando conexão em " + novoHost + ":" + novoPath + "...");

    testarFdb(novoHost, novoPath, function(ok, erro) {
        if (!ok) {
            // Avisa mas permite salvar mesmo assim (banco pode estar offline temporariamente)
            logTs("[FDB Manual] Conexão de teste falhou (" + (erro||"timeout") + ") — salvando mesmo assim.");
        }

        // Atualiza vars globais
        FDB_PATH = novoPath;
        FDB_HOST = novoHost;
        FDB      = novoHost + ":" + novoPath;

        // Persiste no config.json
        updateConfigKey("fdbPath", novoPath);
        updateConfigKey("fbHost",  novoHost);

        // Atualiza dbStatus
        if (ok) {
            dbStatus = { ok: true, ip: novoHost, erro: null, scanCompleto: true, scanning: false };
        } else {
            dbStatus = { ok: false, ip: novoHost, erro: erro || "Sem conexão no momento", scanCompleto: true, scanning: false };
        }

        // Desativa modo de seleção manual — servidor volta ao comportamento normal
        _aguardandoFdbManual = false;

        // Limpa cache e força regeneração imediata
        cache = Object.create(null);
        var dh = hoje();
        gerarEmBackground(dh, dh, dh);

        logTs("[FDB Manual] Banco configurado: " + FDB + " | Aguardando geração...");

        // Inicia polling se Firebird disponível e conexão OK
        if (Firebird && ok) {
            setTimeout(function() {
                pollStatus();
                // pollStatus: fallback de segurança + funções de correção de horário.
                // Fast-poll (50ms, conexão persistente) trata toda a detecção de mudanças.
                // pollStatus usa attach/detach por ciclo — rodar em excesso sobrecarrega
                // o Firebird desnecessariamente. Mínimo 2s independente de POLL_INTERVAL.
                if (_pollIntervalId) clearInterval(_pollIntervalId);
                _pollIntervalId = setInterval(pollStatus, Math.max(POLL_INTERVAL * 5, 2000));
                _iniciarFastPoll(); // detecção em tempo real via conexão persistente
            }, 3000);
        }

        cb({ ok: true });
    });
};

// ---------------------------------------------------------------------------
// Servidor HTTP
// ---------------------------------------------------------------------------
var server=http.createServer(function(req,res){
    
    if(/^\/(favicon\.(ico|png)|apple-touch-icon\.png)/.test(req.url)){
        if(fs.existsSync(FAVICON)){
            try{res.writeHead(200,{"Content-Type":"image/png","Cache-Control":"public,max-age=86400"});res.end(fs.readFileSync(FAVICON));}
            catch(e){res.writeHead(204);res.end();}
        }else{res.writeHead(204);res.end();}
        return;
    }

    var parsed;
    try{parsed=new URL(req.url,"http://localhost");}
    catch(_){res.writeHead(400);res.end("URL invalida.");return;}
    var rota=parsed.pathname||"/";

    var sendJson = function(obj, code) {
        res.writeHead(code||200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
        res.end(JSON.stringify(obj||{}));
    };

    // /pronto
    if(rota==="/pronto"){
        var k=parsed.searchParams.get("k")||"",ek=cache[k];
        var rk=!ek||ek.gerando
            ?{pronto:false,erro:null,tentativa:ek?(ek.tentativa||1):1,matando:false}
            :ek.matando
            ?{pronto:false,erro:null,tentativa:ek.tentativa||1,matando:true}
            :ek.erro
            ?{pronto:false,erro:ek.erro,tentativa:1,matando:false}
            :{pronto:true,erro:null,tentativa:1,matando:false};
        res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-cache,no-store"});
        res.end(JSON.stringify(rk));return;
    }

    // /api/status
    if(rota==="/api/status"){
        // correcoes: consume-once — entregadas ao browser e limpas em seguida
        var _corr = _correcoesPendentes.splice(0);
        var _statusPayload = Object.assign({}, statusAtual,
            {changeTs: _statusChangeTs},
            _corr.length ? {correcoes: _corr} : {});
        res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-cache,no-store"});
        res.end(JSON.stringify(_statusPayload));return;
    }

    // /api/restart
    if(rota==="/api/restart"){
        logTs("Reinicialização solicitada via API ("
            + (req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "local")
            + "). Encerrando em 1s...");
        res.writeHead(200,{"Content-Type":"application/json; charset=utf-8"});
        res.end(JSON.stringify({ok:true,msg:"Servidor encerrando. O tray reiniciará em ~10s."}));
        setTimeout(function(){
            // Mata todos os processos filhos (gerar-relatorio-html.js) pendentes
            for (var _ri = 0; _ri < _spawnedPids.length; _ri++) {
                try {
                    if (process.platform === "win32") {
                        require("child_process").spawn("taskkill",["/F","/PID",String(_spawnedPids[_ri])],{stdio:"ignore"});
                    } else {
                        process.kill(_spawnedPids[_ri]);
                    }
                } catch(_) {}
            }
            _spawnedPids = [];
            setTimeout(function(){ process.exit(0); }, 400);
        }, 1000);
        return;
    }

    // /api/db-status
    if(rota==="/api/db-status"){
        res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-cache,no-store"});
        res.end(JSON.stringify(dbStatus));return;
    }

    // /api/proibidos GET
    if(rota==="/api/proibidos" && req.method === "GET"){
        var cp = loadConfig();
        res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-cache,no-store"});
        res.end(JSON.stringify({proibidos: cp.proibidos || []}));
        return;
    }

    // ---------------------------------------------------------------------------
    // /api/itens-detalhe?data=YYYY-MM-DD&chave=PEDIDO
    // Retorna os itens detalhados de uma venda diretamente do Firebird.
    // Usado pelo modal de detalhes via lazy loading — itensDetalhe não é mais
    // embutido no JSON inline do HTML, reduzindo drasticamente o tamanho da página.
    // Formato de resposta: [ { desc, qtd, total, cancelado } ]
    // ---------------------------------------------------------------------------
    if (rota === "/api/itens-detalhe" && req.method === "GET") {
        if (!Firebird || !dbStatus.ok) {
            res.writeHead(503, {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-cache,no-store"});
            res.end(JSON.stringify({ok:false,erro:"Banco indisponivel.",itens:[]}));
            return;
        }
        var _idData  = (parsed.searchParams.get("data")  || "").trim();
        var _idChave = (parsed.searchParams.get("chave") || "").trim();

        // Validações básicas para evitar injeção SQL via parâmetros
        if (!/^\d{4}-\d{2}-\d{2}$/.test(_idData) || !_idChave || _idChave.length > 60) {
            res.writeHead(400, {"Content-Type":"application/json; charset=utf-8"});
            res.end(JSON.stringify({ok:false,erro:"Parametros invalidos.",itens:[]}));
            return;
        }

        var _idOpts = {host:FDB_HOST,port:3050,database:FDB_PATH,user:USER,password:PASS,
                       role:null,charset:"UTF8",pageSize:4096};
        var _idEncerrado = false;
        var _idTimer = setTimeout(function(){
            if (_idEncerrado) return;
            _idEncerrado = true;
            res.writeHead(504,{"Content-Type":"application/json; charset=utf-8"});
            res.end(JSON.stringify({ok:false,erro:"Timeout ao consultar itens.",itens:[]}));
        }, 8000);

        Firebird.attach(_idOpts, function(errConn, idDb){
            if (_idEncerrado) { if (idDb) try{idDb.detach();}catch(_){} return; }
            if (errConn || !idDb) {
                clearTimeout(_idTimer); _idEncerrado = true;
                res.writeHead(503,{"Content-Type":"application/json; charset=utf-8"});
                res.end(JSON.stringify({ok:false,erro:"Falha ao conectar ao banco.",itens:[]}));
                return;
            }

            var _idFechar = function(){ if(_idEncerrado)return; _idEncerrado=true; clearTimeout(_idTimer); try{idDb.detach();}catch(_){} };

            // Detecta colunas disponíveis no ALTERACA para este ambiente
            idDb.query("SELECT FIRST 1 TOTAL FROM ALTERACA WHERE 1=2", [], function(errTotal){
                var _temTotal = !errTotal;
                idDb.query("SELECT FIRST 1 PRECO FROM ALTERACA WHERE 1=2", [], function(errPreco){
                    var _temPreco = !errPreco;
                    var _colTotal = _temTotal
                        ? "cast(TOTAL as double precision)"
                        : (_temPreco ? "cast(PRECO as double precision) * cast(coalesce(QUANTIDADE,1) as double precision)" : "cast(null as double precision)");

                    // Normaliza o pedido: tenta com zeros e sem zeros para cobrir ambos os formatos
                    var _pedidos = [_idChave];
                    var _stripped = _idChave.replace(/^0+/, "") || _idChave;
                    if (_stripped !== _idChave) _pedidos.push(_stripped);
                    var _ph = _pedidos.map(function(){ return "?"; }).join(",");

                    var _sqlAlt =
                        "SELECT cast(DESCRICAO as varchar(120)) as DESC_A," +
                        "       cast(coalesce(QUANTIDADE,1) as double precision) as QTD_A," +
                        "       " + _colTotal + " as TOT_A " +
                        "FROM ALTERACA " +
                        "WHERE DATA >= cast(? as date) AND DATA < cast(? as date) + 1 " +
                        "  AND cast(PEDIDO as varchar(60)) IN (" + _ph + ") " +
                        "ORDER BY ITEM";

                    idDb.query(_sqlAlt, [_idData, _idData].concat(_pedidos), function(errQ, rows){
                        if (errQ || !rows) {
                            _idFechar();
                            res.writeHead(500,{"Content-Type":"application/json; charset=utf-8"});
                            res.end(JSON.stringify({ok:false,erro:"Erro na consulta: "+(errQ&&errQ.message||"desconhecido"),itens:[]}));
                            return;
                        }

                        var _decoder = new (require("util").TextDecoder)("windows-1252");
                        var _fmtQ = function(v){ var n=Number(v||0); if(!Number.isFinite(n))return"0"; var r=Math.round(n); if(Math.abs(n-r)<1e-9)return String(r); return String(n).replace(".",","); };

                        var itens = [];
                        for (var ri = 0; ri < rows.length; ri++) {
                            var row = rows[ri];
                            // Decodifica campos Buffer que possam vir como Windows-1252
                            for (var k in row) {
                                if (Buffer.isBuffer(row[k])) row[k] = _decoder.decode(row[k]);
                            }
                            var desc   = String(row.DESC_A || row.desc_a || "").trim();
                            if (!desc) continue;
                            var isCancelado = /cancelad/i.test(desc) || desc === "<CANCELADO>";
                            if (isCancelado) continue;
                            var qtd    = _fmtQ(row.QTD_A || row.qtd_a || 1);
                            var totVal = (row.TOT_A !== null && row.TOT_A !== undefined) ? Number(row.TOT_A || row.tot_a || null) : null;
                            itens.push({
                                desc: desc,
                                qtd: qtd,
                                total: (totVal !== null && Number.isFinite(totVal)) ? totVal : null,
                                cancelado: false
                            });
                        }

                        _idFechar();
                        res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-cache,no-store"});
                        res.end(JSON.stringify({ok:true, itens:itens}));
                    });
                });
            });
        });
        return;
    }

    // /api/proibidos POST
    if(rota==="/api/proibidos" && req.method === "POST"){
        lerBodySeguro(req, function(err, body) {
            if (err) { res.writeHead(413, {"Content-Type":"application/json; charset=utf-8"}); res.end(JSON.stringify({ok:false,erro:err.message})); return; }
            try {
                var payload = JSON.parse(body);
                updateConfigKey("proibidos", payload);
                appCfg.proibidos = payload;
                cache = Object.create(null);
                var dh = hoje();
                gerarEmBackground(dh, dh, dh);
                res.writeHead(200,{"Content-Type":"application/json; charset=utf-8"});
                res.end(JSON.stringify({ok:true}));
            } catch(e) {
                res.writeHead(400); res.end();
            }
        });
        return;
    }

    // /api/config GET
    if(rota==="/api/config" && req.method==="GET"){
        var cc = loadConfig();
        sendJson({
            appName:        cc.appName        || "",
            pollInterval:   cc.pollInterval   || 200,
            maxLogLines:    cc.maxLogLines     || 1000,
            favicon:        cc.favicon         || "",
            toastDuration:  cc.toastDuration   || 4000,
            spawnTimeoutMs: _SPAWN_TIMEOUT_MS, // valor ativo (já clampeado 5000–120000)
            proibidos:      Array.isArray(cc.proibidos) ? cc.proibidos : []
        });
        return;
    }

    // /api/config POST
    if(rota==="/api/config" && req.method==="POST"){
        lerBodySeguro(req, function(errBody, cfgBody) {
            if (errBody) { res.writeHead(413,{"Content-Type":"application/json; charset=utf-8"}); res.end(JSON.stringify({ok:false,erro:errBody.message})); return; }
            try{
                var p=JSON.parse(cfgBody);
                var rawCfg="";
                try{ rawCfg=fs.readFileSync(CONFIG,"utf8").replace(/^\uFEFF/,"").trim(); }catch(e){}
                var obj={};
                if(rawCfg){ try{ obj=JSON.parse(rawCfg); }catch(e){ res.writeHead(500); res.end(JSON.stringify({ok:false,erro:"config.json corrompido"})); return; } }
                if(typeof obj!=="object"||Array.isArray(obj)) obj={};

                if(p.appName       !== undefined){ var n=String(p.appName||"").trim();    if(n) obj.appName=n; }
                if(p.pollInterval  !== undefined){ var pi=parseInt(p.pollInterval,10);    if(pi>=200) obj.pollInterval=pi; }
                if(p.maxLogLines   !== undefined){ var ml=parseInt(p.maxLogLines,10);     if(ml>=100) obj.maxLogLines=ml; }
                if(p.favicon       !== undefined){ obj.favicon=String(p.favicon||"").trim(); }
                if(p.toastDuration !== undefined){ var td=parseInt(p.toastDuration,10);   if(td>=500&&td<=60000) obj.toastDuration=td; }
                if(p.proibidos     !== undefined && Array.isArray(p.proibidos)){ obj.proibidos=p.proibidos; }

                fs.writeFileSync(CONFIG,JSON.stringify(obj,null,2),"utf8");

                var novosCfg=loadConfig();
                APP_NAME=(novosCfg.appName&&novosCfg.appName.trim())?novosCfg.appName.trim():"Relatorios";
                if(novosCfg.pollInterval&&parseInt(novosCfg.pollInterval,10)>0) POLL_INTERVAL=parseInt(novosCfg.pollInterval,10);
                if(novosCfg.maxLogLines&&parseInt(novosCfg.maxLogLines,10)>=100){ MAX_LOG_LINES=parseInt(novosCfg.maxLogLines,10); if(_logBuffer.length>MAX_LOG_LINES)_logBuffer=_logBuffer.slice(-MAX_LOG_LINES); }
                if(novosCfg.favicon&&novosCfg.favicon.trim()) FAVICON=novosCfg.favicon.trim();
                if(novosCfg.toastDuration&&parseInt(novosCfg.toastDuration,10)>=500) TOAST_DURATION=parseInt(novosCfg.toastDuration,10);

                cache=Object.create(null);
                var dh=hoje(); gerarEmBackground(dh,dh,dh);

                logTs("Configurações salvas via modal.");
                res.writeHead(200,{"Content-Type":"application/json; charset=utf-8"});
                res.end(JSON.stringify({ok:true}));
            }catch(e){
                logTs("ERRO /api/config POST: "+e.message);
                res.writeHead(400,{"Content-Type":"application/json; charset=utf-8"});
                res.end(JSON.stringify({ok:false,erro:e.message}));
            }
        });
        return;
    }

    // /config — página HTML
    if(rota==="/config"){
        var SC3="</"+"script>";
        var cfgHtml=(function(){
            var cc=loadConfig();
            var _pn=escH(APP_NAME);
            var _pi=parseInt(cc.pollInterval||POLL_INTERVAL,10);
            var _ml=parseInt(cc.maxLogLines||MAX_LOG_LINES,10);
            var _td=parseInt(cc.toastDuration||TOAST_DURATION,10);
            var _fv=escH(cc.favicon||"");
            var _pr=JSON.stringify(Array.isArray(cc.proibidos)?cc.proibidos:[]);
            return "<!doctype html><html lang=\"pt-br\"><head><meta charset=\"utf-8\">"+htmlFavicon+"<title>Configuracoes</title>"+
            "<script>(function(){try{var t=localStorage.getItem('fdb_theme')||(document.cookie.match(/fdb_theme=([^;]+)/)||[])[1]||'ultra-dark';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();"+SC3+
            "<style>"+
            "*{box-sizing:border-box}"+
            "body{margin:0;background:#000;display:flex;align-items:flex-start;justify-content:center;min-height:100vh;font-family:Inter,Arial,sans-serif;color:#ededed;padding:40px 16px}"+
            ".box{background:#0a0a0a;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:36px 40px;width:100%;max-width:520px}"+
            "h2{margin:0 0 6px;font-size:20px;font-weight:700}"+
            ".sub{color:#71717a;font-size:13px;margin-bottom:15px}"+
            ".field{margin-bottom:15px}"+
            "label{display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#a1a1aa;margin-bottom:7px}"+
            ".hint{font-size:12px;color:#52525b;margin-top:5px}"+
            "input[type=text],input[type=number]{display:block;width:100%;background:#000;color:#ededed;border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:10px 14px;font-size:14px;outline:none}"+
            "input:focus{border-color:#0ea5e9}"+
            "textarea{display:block;width:100%;background:#000;color:#ededed;border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:10px 14px;font-size:13px;font-family:monospace;outline:none;resize:vertical;min-height:90px}"+
            "textarea:focus{border-color:#0ea5e9}"+
            ".row{display:flex;gap:12px}.row .field{flex:1}"+
            ".btn{width:100%;padding:14px;background:#0ea5e9;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;margin-top:8px}"+
            ".btn:hover{background:#0284c7}.btn:disabled{opacity:.5;cursor:not-allowed}"+
            ".btn-sec{background:rgba(255,255,255,.07);color:#ededed}.btn-sec:hover{background:rgba(255,255,255,.13)}"+
            "#msg{display:none;padding:12px 16px;border-radius:8px;font-size:14px;margin-bottom:16px}"+
            ".ok{background:rgba(34,197,94,.12);color:#4ade80;border:1px solid rgba(34,197,94,.25)}"+
            ".er{background:rgba(248,113,113,.12);color:#f87171;border:1px solid rgba(248,113,113,.25)}"+
            ".sep{border:none;border-top:1px solid rgba(255,255,255,.07);margin:12px 0}"+
            "</style></head><body><div class=\"box\">"+
            "<h2>Configuracoes</h2><p class=\"sub\">Apenas campos editaveis pelo painel. Outras opcoes: edite config.json diretamente.</p>"+
            "<div id=\"msg\"></div>"+
            "<div class=\"field\"><label>Nome do sistema (appName)</label><input type=\"text\" id=\"appName\" value=\""+_pn+"\"><p class=\"hint\">Exibido no titulo da pagina e no icone da bandeja.</p></div>"+
            "<div class=\"row\">"+
            "<div class=\"field\"><label>Intervalo de polling (ms)</label><input type=\"number\" id=\"pollInterval\" value=\""+_pi+"\" min=\"200\" step=\"100\"><p class=\"hint\">Minimo: 200 ms</p></div>"+
            "<div class=\"field\"><label>Maximo de linhas de log</label><input type=\"number\" id=\"maxLogLines\" value=\""+_ml+"\" min=\"100\" step=\"100\"><p class=\"hint\">Minimo: 100 linhas</p></div>"+
            "</div>"+
            "<div class=\"field\"><label>Duracao do toast (ms)</label><input type=\"number\" id=\"toastDuration\" value=\""+_td+"\" min=\"500\" max=\"60000\" step=\"500\"><p class=\"hint\">Tempo que a notificacao de mudanca fica visivel. Minimo: 500 ms, maximo: 60 000 ms.</p></div>"+
            "<div class=\"field\">"+
              "<label>Ícone (favicon)</label>"+
              "<div style=\"display:flex;gap:2px;align-items:center;flex-wrap:wrap\">"+
                "<input type=\"text\" id=\"favicon\" placeholder=\"Caminho do arquivo ou vazio para usar favicon na mesma pasta\" value=\""+_fv+"\" style=\"flex:1;min-width:0\">"+
                "<button class=\"btn btn-sec\" type=\"button\" id=\"favPick\" style=\"white-space:nowrap;height:38px;padding:0 14px\" title=\"Selecionar arquivo do computador\">" + SVG_FOLDER + "Procurar</button>"+
                "<input type=\"file\" id=\"favFile\" accept=\".png,.ico,.jpg,.jpeg\" style=\"display:none\">"+
              "</div>"+
              "<p class=\"hint\" id=\"favHint\">"+(_fv?"Atual: "+_fv:"Usando favicon.png padrao na mesma pasta dos arquivos")+"</p>"+
            "</div>"+
            "<hr class=\"sep\">"+
            "<div class=\"field\"><label>Proibidos (um por linha)</label>"+
            "<textarea id=\"proibidos\" placeholder=\"Nome1\nNome2\nProduto A\"></textarea>"+
            "<p class=\"hint\">Vendas com esses termos serao ocultadas do relatorio.</p></div>"+
            "<button class=\"btn\" id=\"salvarBtn\" onclick=\"salvar()\">Salvar configuracoes</button>"+
            "<button class=\"btn btn-sec\" style=\"margin-top:10px\" onclick=\"window.location.href='/'\">Voltar para o relatorio</button>"+
            "</div>"+
            "<script>"+
            "(function(){"+
            "var pr="+_pr+";"+
            "document.getElementById('proibidos').value=Array.isArray(pr)?pr.join('\\n'):'';"+
            "var _fi=document.getElementById('favFile');"+
            "document.getElementById('favPick').addEventListener('click',function(){_fi.click();});"+
            "_fi.addEventListener('change',function(){"+
            "var f=_fi.files&&_fi.files[0];"+
            "if(!f)return;"+
            "var h=document.getElementById('favHint');"+
            "if(h)h.textContent='Arquivo selecionado: '+f.name+' ('+Math.round(f.size/1024)+' KB) — sera enviado ao salvar.';"+
            "document.getElementById('favicon').value='';"+
            "});"+
            "})();"+
            "function salvar(){"+
            "var btn=document.getElementById('salvarBtn'),msg=document.getElementById('msg');"+
            "btn.disabled=true;btn.textContent='Salvando...';msg.style.display='none';"+
            "var an=document.getElementById('appName').value.trim();"+
            "var pi=parseInt(document.getElementById('pollInterval').value,10)||200;"+
            "var ml=parseInt(document.getElementById('maxLogLines').value,10)||1000;"+
            "var td=parseInt(document.getElementById('toastDuration').value,10)||4000;"+
            "var fv=document.getElementById('favicon').value.trim();"+
            "var praw=document.getElementById('proibidos').value;"+
            "var pr=praw.split('\\n').map(function(s){return s.trim();}).filter(function(s){return s.length>0;});"+
            "var favFile=document.getElementById('favFile').files&&document.getElementById('favFile').files[0];"+
            "if(!an){showMsg('O nome do sistema nao pode estar vazio.','er');btn.disabled=false;btn.textContent='Salvar configuracoes';return;}"+
            "if(pi<200){showMsg('Intervalo minimo e 200 ms.','er');btn.disabled=false;btn.textContent='Salvar configuracoes';return;}"+
            "if(ml<100){showMsg('Maximo de linhas minimo e 100.','er');btn.disabled=false;btn.textContent='Salvar configuracoes';return;}"+
            "if(td<500||td>60000){showMsg('Duracao do toast deve estar entre 500 e 60 000 ms.','er');btn.disabled=false;btn.textContent='Salvar configuracoes';return;}"+
            "var doSave=function(){"+
            "fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},"+
            "body:JSON.stringify({appName:an,pollInterval:pi,maxLogLines:ml,toastDuration:td,favicon:fv,proibidos:pr})})"+
            ".then(function(r){return r.json();})"+
            ".then(function(d){"+
            "if(d.ok){showMsg('Configuracoes salvas com sucesso! O relatorio sera atualizado.','ok');}"+
            "else{showMsg('Erro: '+(d.erro||'Falha desconhecida'),'er');}"+
            "btn.disabled=false;btn.textContent='Salvar configuracoes';"+
            "})"+
            ".catch(function(e){showMsg('Erro de rede: '+e.message,'er');btn.disabled=false;btn.textContent='Salvar configuracoes';});"+
            "};"+
            "if(favFile){"+
            "var reader=new FileReader();"+
            "reader.onload=function(ev){"+
            "fetch('/api/upload-favicon',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:ev.target.result})"+
            ".then(function(r){return r.json();})"+
            ".then(function(d){"+
            "if(d.ok){fv='';var h=document.getElementById('favHint');if(h)h.textContent='Favicon atualizado com sucesso!';}"+
            "else{showMsg('Aviso favicon: '+(d.erro||'Falha no upload'),'er');}"+
            "doSave();"+
            "}).catch(function(){showMsg('Aviso: falha no upload do favicon — salvando demais configuracoes.','er');doSave();});"+
            "};"+
            "reader.readAsArrayBuffer(favFile);"+
            "}else{doSave();}"+
            "}"+
            "function showMsg(t,cls){var m=document.getElementById('msg');m.textContent=t;m.className=cls;m.style.display='block';window.scrollTo({top:0,behavior:'smooth'});}"+
            SC3+
            "</body></html>";
        })();
        res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
        res.end(cfgHtml);
        return;
    }

    // /api/log-error
    if(rota==="/api/log-error" && req.method==="POST"){
        lerBodySeguro(req, function(err, errBody) {
            if (!err) {
                try{
                    var e=JSON.parse(errBody);
                    logTs("[BROWSER-ERROR] "+String(e.msg||"")+(e.src?" | "+e.src:"")+(e.line?" L"+e.line:"")+(e.col?":"+e.col:"")+(e.stack?"\n"+e.stack:""));
                }catch(_){}
            }
            res.writeHead(204);res.end();
        });
        return;
    }

    // /api/hora-usuario POST — browser envia Date.now() para sincronizar relógio.
    if(rota==="/api/hora-usuario" && req.method==="POST"){
        lerBodySeguro(req, function(errHora, _horaBody) {
            if (errHora) { res.writeHead(413); res.end(); return; }
            try{
                var _hp=JSON.parse(_horaBody);
                // tzOffsetMs = browser.getTimezoneOffset() * 60000
                // Válido entre -720 min (UTC+12) e +840 min (UTC-14)
                var tzMs=Number(_hp.tzOffsetMs);
                if(!isNaN(tzMs) && tzMs >= -720*60000 && tzMs <= 840*60000){
                    var mudou = Math.abs(tzMs - _clientTzOffsetMs) > 60000; // >1 min de diferença
                    if(mudou){
                        var h = Math.abs(Math.round(tzMs/3600000));
                        var sinal = tzMs >= 0 ? "-" : "+";
                        logTs("Fuso do usuário sincronizado: UTC"+sinal+h+"h (tzOffsetMs="+tzMs+").");
                    }
                    _clientTzOffsetMs = tzMs;
                    _ultimaSincHoraUsuario = Date.now();
                }
                res.writeHead(204);res.end();
            }catch(e){
                res.writeHead(400);res.end();
            }
        });
        return;
    }

    // /api/sse-clients
    if(rota==="/api/sse-clients"){
        sendJson({clients: sseClients.length});return;
    }

    // -----------------------------------------------------------------------
    // /selecionar-fdb — página HTML de seleção manual do FDB
    // Acessível sempre (mesmo quando dbStatus.ok=true) para reconfiguração.
    // -----------------------------------------------------------------------
    if(rota==="/selecionar-fdb"){
        res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
        res.end(paginaEscolherFdb());
        return;
    }

    // -----------------------------------------------------------------------
    // /api/abrir-picker-fdb GET — abre OpenFileDialog nativo do Windows
    // Responde: { ok:true, caminho:"C:\..." } | { ok:false, cancelado:true } | { ok:false, erro:"..." }
    // -----------------------------------------------------------------------
    if(rota==="/api/abrir-picker-fdb" && req.method==="GET"){
        abrirPickerFdbWindows(function(resultado) {
            res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
            res.end(JSON.stringify(resultado));
        });
        return;
    }

    // -----------------------------------------------------------------------
    // /api/salvar-fdb POST — recebe { caminho } e aplica o novo FDB
    // Valida existência do arquivo, testa conexão, persiste e limpa cache.
    // Responde: { ok:true } | { ok:false, erro:"..." }
    // -----------------------------------------------------------------------
    if(rota==="/api/salvar-fdb" && req.method==="POST"){
        lerBodySeguro(req, function(errFdb, fdbBody) {
            if (errFdb) { sendJson({ok:false, erro:errFdb.message}); return; }
            try{
                var payload = JSON.parse(fdbBody);
                var caminho = String(payload.caminho||"").trim();
                if(!caminho){
                    sendJson({ok:false, erro:"Caminho não informado."}); return;
                }
                if(!/\.fdb$/i.test(caminho)){
                    sendJson({ok:false, erro:"O arquivo deve ter extensão .fdb"}); return;
                }
                logTs("[FDB Manual] Caminho recebido: "+caminho);
                aplicarNovoFdb(caminho, function(r){
                    sendJson(r);
                });
            }catch(e){
                logTs("ERRO /api/salvar-fdb: "+e.message);
                sendJson({ok:false, erro:e.message});
            }
        });
        return;
    }

    // /api/events — SSE stream
    if(rota==="/api/events"){
        var clientId = ++sseIdCounter;
        res.writeHead(200,{
            "Content-Type":"text/event-stream",
            "Cache-Control":"no-cache, no-transform",
            "Connection":"keep-alive",
            "X-Accel-Buffering":"no",
            "X-Content-Type-Options":"nosniff"
        });
        res.flushHeaders();
        res.write(": connected\n\n");
        res.write("retry: 5000\n");
        res.write("data: "+JSON.stringify({type:"connected",id:clientId})+"\n\n");
        try{if(res.socket){res.socket.setNoDelay(true);}}catch(_){}

        var clientObj = {res:res, id:clientId};
        sseClients.push(clientObj);
        /*logTs("SSE id="+clientId+" conectado. Total="+sseClients.length);*/

        var hb = setInterval(function(){
            try{res.write(": ping\n\n");}catch(e){clearInterval(hb);}
        }, 15000);

        req.on("close",function(){
            clearInterval(hb);
            sseClients = sseClients.filter(function(c){return c.id!==clientId;});
            /*logTs("SSE id="+clientId+" desconectado. Total="+sseClients.length);*/
        });
        return;
    }

    // /api/navigate/hoje
    if(rota==="/api/navigate/hoje"){
        var sent = broadcastSSE({type:"navigate", url:"/"});
        sendJson({ok:true, clients:sent});return;
    }

    // /api/navigate/config
    if(rota==="/api/navigate/config"){
        var sentCfg = broadcastSSE({type:"navigate-hash", hash:"config"});
        sendJson({ok:true, clients:sentCfg});return;
    }

    // /api/navigate/selecionar-fdb
    // Navega a aba aberta para a pagina de selecao manual do FDB.
    // Usado pelo item "Selecionar banco (FDB)..." do menu de bandeja.
    if(rota==="/api/navigate/selecionar-fdb"){
        var sentFdb = broadcastSSE({type:"navigate", url:"/selecionar-fdb"});
        sendJson({ok:true, clients:sentFdb});return;
    }

    // /api/navigate/periodo/YYYY-MM-DD/YYYY-MM-DD
    var mNav = rota.match(/^\/api\/navigate\/periodo\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/);
    if(mNav){
        var navUrl = "/periodo?i="+mNav[1]+"&f="+mNav[2];
        var sentNav = broadcastSSE({type:"navigate", url:navUrl});
        sendJson({ok:true, clients:sentNav});return;
    }

    // /api/upload-favicon POST
    if(rota==="/api/upload-favicon" && req.method==="POST"){
        var favChunks=[], favBytes=0, favAbortado=false;
        var FAV_MAX_BYTES = 2 * 1024 * 1024; // 2 MB — suficiente para qualquer favicon
        req.on("data",function(c){
            if(favAbortado)return;
            favBytes+=c.length;
            if(favBytes>FAV_MAX_BYTES){
                favAbortado=true;
                try{req.destroy();}catch(_){}
                if(!res.headersSent){
                    res.writeHead(413,{"Content-Type":"application/json; charset=utf-8"});
                    res.end(JSON.stringify({ok:false,erro:"Favicon muito grande (máx 2 MB)."}));
                }
                return;
            }
            favChunks.push(c);
        });
        req.on("error",function(e){
            if(favAbortado)return; favAbortado=true;
            logTs("ERRO /api/upload-favicon (req): "+e.message);
            if(!res.headersSent){
                res.writeHead(500,{"Content-Type":"application/json; charset=utf-8"});
                res.end(JSON.stringify({ok:false,erro:e.message}));
            }
        });
        req.on("end",function(){
            if(favAbortado)return;
            try{
                var buf=Buffer.concat(favChunks);
                var isPng =buf.length>4&&buf[0]===0x89&&buf[1]===0x50&&buf[2]===0x4E&&buf[3]===0x47;
                var isIco =buf.length>4&&buf[0]===0x00&&buf[1]===0x00&&buf[2]===0x01&&buf[3]===0x00;
                var isJpeg=buf.length>3&&buf[0]===0xFF&&buf[1]===0xD8&&buf[2]===0xFF;
                if(!isPng&&!isIco&&!isJpeg){
                    res.writeHead(400,{"Content-Type":"application/json; charset=utf-8"});
                    res.end(JSON.stringify({ok:false,erro:"Formato inválido. Use PNG, ICO ou JPEG."}));
                    return;
                }
                var favDest=path.join(__dirname,"favicon.png");
                fs.writeFileSync(favDest,buf);
                FAVICON=favDest;
                logTs("Favicon atualizado via modal ("+buf.length+" bytes).");
                res.writeHead(200,{"Content-Type":"application/json; charset=utf-8"});
                res.end(JSON.stringify({ok:true}));
            }catch(e){
                logTs("ERRO /api/upload-favicon: "+e.message);
                if(!res.headersSent){
                    res.writeHead(500,{"Content-Type":"application/json; charset=utf-8"});
                    res.end(JSON.stringify({ok:false,erro:e.message}));
                }
            }
        });
        return;
    }

    // /
    if(rota==="/"){
        // Se FDB não encontrado automaticamente, exibe picker manual
        if(_aguardandoFdbManual){
            res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
            res.end(paginaEscolherFdb());
            return;
        }
        var dh=hoje(),ent=cache[dh];
        if(!ent){gerarEmBackground(dh,dh,dh);ent=cache[dh];}
        if(ent.gerando||ent.matando){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(paginaLoading("Gerando relatorio de hoje...",isoParaBR(dh),dh,"/"));return;}
        if(ent.erro){var em=ent.erro;delete cache[dh];res.writeHead(500,{"Content-Type":"text/html; charset=utf-8"});res.end(paginaErro("Erro ao gerar relatorio de "+isoParaBR(dh),em,"/"));return;}
        res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(ent.html);return;
    }

    // /atualizar
    if(rota==="/atualizar"){
        logTs("Atualizando "+isoParaBR(hoje())+"...");
        var _dhAtual = hoje();
        delete cache[_dhAtual];
        _gerarTentativas[_dhAtual] = 0; // reseta contador para a nova geração começar limpa
        res.writeHead(302,{"Location":"/"});res.end();return;
    }

    // /periodo
    if(rota==="/periodo"){
        // Se FDB não encontrado automaticamente, exibe picker manual
        if(_aguardandoFdbManual){
            res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
            res.end(paginaEscolherFdb());
            return;
        }
        var inicio = parsed.searchParams.get("i") || parsed.searchParams.get("inicio") || "";
        var fim    = parsed.searchParams.get("f") || parsed.searchParams.get("fim")    || "";
        inicio = String(inicio).trim();
        fim = String(fim).trim();
        if (!inicio && !fim) {res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(paginaFormPeriodo(hoje()));return;}
        if (!inicio && fim) inicio = fim;
        if (inicio && !fim) fim = inicio;
        var fixISO=function(s){
            var m2=String(s||"").match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
            return m2?m2[3]+"-"+m2[2].padStart(2,"0")+"-"+m2[1].padStart(2,"0"):s;
        };
        inicio=fixISO(inicio);fim=fixISO(fim);
        var isoRe=/^\d{4}-\d{2}-\d{2}$/;
        if(!isoRe.test(inicio)||!isoRe.test(fim)||inicio>fim){
            logTs("Periodo invalido ("+inicio+"/"+fim+"). Redirecionando para formulario.");
            res.writeHead(302,{"Location":"/periodo"});res.end();return;
        }
        var chave=inicio+"|"+fim;
        var label=(inicio===fim)?isoParaBR(inicio):(isoParaBR(inicio)+" a "+isoParaBR(fim));
        var urlDest="/periodo?i="+encodeURIComponent(inicio)+"&f="+encodeURIComponent(fim);
        var ep=cache[chave];
        if(!ep){gerarEmBackground(inicio,fim,chave);ep=cache[chave];}
        if(ep.gerando||ep.matando){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(paginaLoading("Gerando relatorio...",label,chave,urlDest));return;}
        if(ep.erro){var em2=ep.erro;delete cache[chave];res.writeHead(500,{"Content-Type":"text/html; charset=utf-8"});res.end(paginaErro("Erro ao gerar relatorio de "+label,em2,"/"));return;}
        res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(ep.html);return;
    }

    res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8"});res.end("Rota nao encontrada.");
});

// ---------------------------------------------------------------------------
// Inicia
// ---------------------------------------------------------------------------
server.listen(PORT, BIND_ADDR, function(){
    var addr = _maquinaIP
        ? "http://" + _maquinaIP + ":" + PORT + "  (acesso externo habilitado)"
        : "http://localhost:" + PORT;
    // "=== Servidor iniciado ===" já foi logado como primeiro log protegido
    // (antes da detecção de FDB). Aqui apenas registra o endereço de acesso.
    logProtegido(APP_NAME+" | "+addr);

    aguardarFDB(function(dbOk){
        if(dbOk){
            // Ordem correta: disponível → configurado (FDB pode ter mudado após scan)
            logProtegido("Banco disponível em "+FDB_HOST+".");
            logProtegido("Banco configurado: "+FDB);
            _aguardandoFdbManual = false;
        } else {
            // FDB não encontrado após todas tentativas automáticas.
            // Ativa modo de seleção manual — qualquer acesso a / ou /periodo
            // exibirá a página paginaEscolherFdb() até o usuário configurar.
            logTs("AVISO: Banco não encontrado. Aguardando seleção manual em http://localhost:"+PORT+"/selecionar-fdb");
            _aguardandoFdbManual = true;
        }

        var dh=hoje();
        // Gera relatório mesmo sem banco — resultado mostrará mensagem de erro adequada
        gerarEmBackground(dh,dh,dh);

        if(Firebird&&dbOk){
            setTimeout(function(){
                pollStatus();
                if (_pollIntervalId) clearInterval(_pollIntervalId);
                // Fast-poll (50ms) trata detecção; pollStatus só para correções + fallback.
                _pollIntervalId = setInterval(pollStatus, Math.max(POLL_INTERVAL * 5, 2000));
                _iniciarFastPoll(); // detecção em tempo real via conexão persistente
            }, 5000);
            /*logTs("Polling Firebird ativo ("+POLL_INTERVAL/1000+"s).");*/
        }

        agendarRegen();
        logTs("Fast-poll: 200ms (detecção instantânea) | pollStatus fallback: " + (POLL_INTERVAL/1000) + "s | browser poll: " + POLL_INTERVAL + "ms | spawnTimeout: " + (_SPAWN_TIMEOUT_MS/1000) + "s. Servidor pronto.");
    });
});

server.on("error",function(err){
    if(err.code==="EADDRINUSE"){
        logTs("Servidor ja rodando na porta "+PORT+". Encerrando.");
        setTimeout(function(){process.exit(0);},300);
    } else {
        console.error("Erro: "+err.message);process.exit(1);
    }
});

process.on("SIGINT",function(){console.log("\nServidor encerrado.\n");process.exit(0);});