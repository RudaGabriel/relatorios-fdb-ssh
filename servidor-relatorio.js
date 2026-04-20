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
 * - pollInterval lido do config.json (padrao 1000 ms, sem minimo obrigatorio)
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
        const ts = "[" + d.toISOString().replace("T"," ").slice(0,19) + "]";
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
var POLL_INTERVAL = (appCfg.pollInterval && parseInt(appCfg.pollInterval,10)>0) ? parseInt(appCfg.pollInterval,10) : 1000;

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

var detectLocalIP=function(){
    var ifaces=os.networkInterfaces();
    for(var n in ifaces){
        var list=ifaces[n];
        for(var i=0;i<list.length;i++){
            var a=list[i];
            var isV4=(a.family==="IPv4"||a.family===4);
            if(isV4&&!a.internal&&a.address!=="127.0.0.1"){
                return a.address;
            }
        }
    }
    return null;
};

var cfg      = loadConfig();
var fdbArg   = pegar("--fdb");

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

var _maquinaIPCfg = (cfg.maquinaIP && String(cfg.maquinaIP).trim()) ? String(cfg.maquinaIP).trim() : null;
var _maquinaIP    = _maquinaIPCfg || detectLocalIP();
var BIND_ADDR     = _maquinaIP ? "0.0.0.0" : "127.0.0.1";

// Auto-salva o IP detectado no config.json para que o tray (e outros processos)
// possam ler o IP correto sem depender de deteccao propria.
// Só grava se nao estava configurado manualmente — nunca sobrescreve valor do usuario.
if (!_maquinaIPCfg && _maquinaIP) {
    try { updateConfigKey("maquinaIP", _maquinaIP); } catch(e) {}
    logTs("maquinaIP auto-detectado e salvo no config: " + _maquinaIP);
}

// ---------------------------------------------------------------------------
// Estado global
// ---------------------------------------------------------------------------
var cache       = Object.create(null);
var statusAtual = {qt:-1,total:-1,ts:0};
var dbStatus    = {ok:false,ip:FDB_HOST,erro:null,scanCompleto:false,scanning:false};

// ---------------------------------------------------------------------------
// [NOVO] Flag de aguardo de seleção manual do FDB
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
    if (vivos.length > 0) logTs("SSE enviado para "+vivos.length+" cliente(s).");
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
                logTs("Banco OK imediatamente em " + FDB_HOST + ".");
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
    var t=setTimeout(function(){cb(false,"Timeout 5s");},5000);
    Firebird.attach(opts,function(err,db){
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
// Gerador em background
// ---------------------------------------------------------------------------
var gerarEmBackground=function(inicio,fim,chave){
    var ent=cache[chave];
    if(ent&&ent.gerando)return;
    cache[chave]={html:null,gerando:true,erro:null,qt:0,tot:0};

    var label=(inicio===fim)?isoParaBR(inicio):(isoParaBR(inicio)+" a "+isoParaBR(fim));
    logTs("Gerando "+label+"...");

    var _tmpSafe = String(chave).replace(/[^a-zA-Z0-9_\-]/g,"_").slice(0,80);
    var _tmpFile = path.join(TMP_DIR, "relatorio_srv_" + _tmpSafe + ".html");

    var nArgs=[SCRIPT,"--fdb",FDB,"--data-inicio",inicio,"--data-fim",fim,
               "--saida",_tmpFile,"--user",USER,"--pass",PASS];
    var proc=spawn(process.execPath,nArgs,{stdio:["ignore","pipe","pipe"]});
    proc.stdout.on("data",function(d){process.stdout.write(d);});
    proc.stderr.on("data",function(d){process.stderr.write(d);});

    proc.on("error",function(e){
        logTs("ERRO spawn: "+e.message);
        cache[chave]={html:null,gerando:false,erro:"Falha ao iniciar node: "+e.message};
    });
    proc.on("close",function(code){
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
        var pollMs = POLL_INTERVAL;

        var _statusChanged = false;
        if (ehHje && statusAtual.qt >= 0) {
            if (qt !== statusAtual.qt || Math.abs(tot - statusAtual.total) > 0.5) {
                logTs("Dados alterados: "+statusAtual.qt+"->"+qt+" | R$"+
                      (statusAtual.total||0).toFixed(2)+"->R$"+tot.toFixed(2));
                _statusChanged = true;
            }
        }

        var SC = "</" + "script>";
        var arScript =
            "<script>(function(){" +
            "window.onerror=function(msg,src,line,col,err){" +
            "try{fetch('/api/log-error',{method:'POST',headers:{'Content-Type':'application/json'}," +
            "body:JSON.stringify({msg:String(msg),src:String(src||''),line:line,col:col,stack:err&&err.stack?String(err.stack):''})});}catch(_){}" +
            "};" +
            "window.onunhandledrejection=function(ev){" +
            "try{var r=ev&&ev.reason;fetch('/api/log-error',{method:'POST',headers:{'Content-Type':'application/json'}," +
            "body:JSON.stringify({msg:'UnhandledRejection: '+String(r&&r.message||r),stack:r&&r.stack?String(r.stack):''})});}catch(_){}" +
            "};" +
            "try{" +
            "var t=localStorage.getItem('fdb_theme')||(document.cookie.match(/fdb_theme=([^;]+)/)||[])[1]||'ultra-dark';" +
            "document.documentElement.setAttribute('data-theme',t);" +
            "}catch(e){};" +
            (ehHje ? (
            "var _q="+qt+",_t="+(Math.round(tot*100)/100)+";" +
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
            "_es.onopen=function(){_connTry=0;};" +
            "_es.onerror=function(){if(_es){_es.close();_es=null;}" +
            "_connTry++;var delay=Math.min(2000*_connTry,30000);" +
            "setTimeout(_conn,delay);};" +
            "}catch(e){setTimeout(_conn,5000);}" +
            "};" +
            "_conn();" +
            "var _poll=function(){" +
            "fetch('/api/status',{cache:'no-store'})" +
            ".then(function(r){return r.json();})" +
            ".then(function(d){" +
            "if(d.qt>=0&&(d.qt!==_q||Math.abs(d.total-_t)>0.5)){" +
            "_q=d.qt;_t=d.total;window.location.replace(window.location.href);}})"+
            ".catch(function(){});};" +
            "setInterval(_poll,"+pollMs+");"
            ) : "") +
            "})();"+SC;

        var serverModeSnip =
            "<script>" +
            "window.__SERVER_MODE__=true;" +
            "window.__STATUS_INICIAL__={qt:"+qt+",total:"+(Math.round(tot*100)/100)+"};" +
            "<\/script>";

        try {
            var injTarget = html.indexOf("</head>");
            if (injTarget >= 0) {
                html = html.slice(0, injTarget) + serverModeSnip + html.slice(injTarget);
            } else {
                var bTarget = html.indexOf("<body");
                if (bTarget >= 0) {
                    html = html.slice(0, bTarget) + serverModeSnip + html.slice(bTarget);
                } else {
                    html = serverModeSnip + html;
                }
                logTs("AVISO: </head> nao encontrado no HTML — SERVER_MODE injetado como fallback.");
            }
            html = html.replace("</body></html>", arScript + "</body></html>");
            if (html.indexOf(arScript) < 0) {
                logTs("AVISO: </body></html> nao encontrado — arScript nao foi injetado.");
            }
        } catch(injErr) {
            logTs("ERRO na injecao HTML: " + (injErr && injErr.stack || injErr));
        }

        var nClientesAoGerar = sseClients.length;
        logTs("Pronto: "+label+" ("+Math.round(html.length/1024)+" KB, "+qt+" vendas, R$"+tot.toFixed(2)+") | _statusChanged="+_statusChanged+" | sseClients="+nClientesAoGerar);
        cache[chave]={html:html,gerando:false,erro:null,qt:qt,tot:tot};
        if(ehHje) statusAtual={qt:qt,total:tot,ts:Date.now()};
        if(_statusChanged) {
            logTs("Notificando SSE... clientes ativos: "+sseClients.length);
            if (sseClients.length > 0) {
                var enviados = broadcastSSE({type:"reload"});
                logTs("Broadcast SSE concluido: "+enviados+" cliente(s) recarregando.");
            } else {
                logTs("AVISO: Nenhum cliente SSE — polling do browser compensara em "+POLL_INTERVAL/1000+"s.");
            }
        }
        } catch(fatalErr) {
            logTs("ERRO FATAL em proc.close ("+chave+"): "+(fatalErr&&fatalErr.stack||fatalErr));
            try { cache[chave]={html:null,gerando:false,erro:"Erro interno: "+(fatalErr&&fatalErr.message||String(fatalErr))}; } catch(_) {}
        }
    });
};

// ---------------------------------------------------------------------------
// Polling via Firebird direto
// ---------------------------------------------------------------------------
var _pollBusy=false;
var pollStatus=function(){
    if(!Firebird||_pollBusy||!dbStatus.ok)return;
    _pollBusy=true;
    var dh=hoje();
    var opts={host:FDB_HOST,port:3050,database:FDB_PATH,user:USER,password:PASS,
              role:null,charset:"UTF8",pageSize:4096,lowercase_keys:false};
    var _t=setTimeout(function(){_pollBusy=false;},12000);
    Firebird.attach(opts,function(err,db){
        if(err){clearTimeout(_t);_pollBusy=false;return;}
        var sql = 
"SELECT SUM(QT) AS QT, SUM(TOT) AS TOT FROM ("+
"SELECT COUNT(*) AS QT, COALESCE(SUM(n.total),0) AS TOT "+
"FROM nfce n "+
"WHERE n.data >= ? AND n.data < ? + 1 "+
"AND COALESCE(n.modelo,65) IN (99,65) "+
"AND COALESCE(n.cancelado,'N') NOT IN ('S','T') "+
"AND n.total > 0 "+
"UNION ALL "+
"SELECT COUNT(*) AS QT, COALESCE(SUM(p.valor),0) AS TOT "+
"FROM pagament p "+
"WHERE p.data >= ? AND p.data < ? + 1 "+
"AND p.valor > 0 "+
"AND SUBSTRING(p.forma FROM 1 FOR 2) NOT IN ('00','13')"+
") t";
        db.query(sql,[dh,dh,dh,dh],function(e,rows){
            clearTimeout(_t);db.detach();_pollBusy=false;
            if(e||!rows||!rows.length)return;
            var r=rows[0];
            var qt=Number(r.QT||r.qt||0),tot=Number(r.TOT||r.tot||0);
            if(statusAtual.qt>=0&&(qt!==statusAtual.qt||Math.abs(tot-statusAtual.total)>0.5)){
                logTs("Mudanca (Firebird): "+statusAtual.qt+"->"+qt+". Regerando...");
                delete cache[dh];
                gerarEmBackground(dh,dh,dh);
            }
            statusAtual={qt:qt,total:tot,ts:Date.now()};
        });
    });
};

// ---------------------------------------------------------------------------
// Regeneracao agendada
// ---------------------------------------------------------------------------
var agendarRegen = function() {
    setTimeout(function() {
        var dh = hoje();
        if (!cache[dh] || !cache[dh].gerando) {
            logTs("Regenerando relatorio de hoje (agendado "+POLL_INTERVAL/1000+"s)...");
            delete cache[dh];
            gerarEmBackground(dh, dh, dh);
        }
        agendarRegen();
    }, POLL_INTERVAL);
};

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------
var htmlFavicon="<link rel=\"icon\" type=\"image/png\" href=\"/favicon.png\">";

var paginaLoading=function(titulo,sub,chavePoll,urlDest){
    var p="/pronto?k="+encodeURIComponent(chavePoll);
    var dJs=JSON.stringify(urlDest);
    var SC2="</"+"script>";
    return "<!doctype html><html lang=\"pt-br\"><head><meta charset=\"utf-8\">"+htmlFavicon+
        "<title>Gerando...</title>"+
        "<script>(function(){try{var t=localStorage.getItem('fdb_theme')||(document.cookie.match(/fdb_theme=([^;]+)/)||[])[1]||'ultra-dark';document.documentElement.setAttribute('data-theme',t);}catch(e){}})();"+SC2+
        "<style>*{box-sizing:border-box}body{margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:Inter,Arial,sans-serif;color:#ededed}.box{text-align:center;padding:40px 28px;max-width:380px}.spin{width:48px;height:48px;border:3px solid rgba(255,255,255,.1);border-top-color:#0ea5e9;border-radius:50%;animation:s .8s linear infinite;margin:0 auto 20px}@keyframes s{to{transform:rotate(360deg)}}h2{margin:0 0 6px;font-size:20px;font-weight:700}.sub{color:#a1a1aa;font-size:14px}.tempo{color:#71717a;font-size:13px;margin-top:12px}"+
        "</style></head><body><div class=\"box\"><div class=\"spin\"></div>"+
        "<h2>"+escH(titulo)+"</h2><div class=\"sub\">"+escH(sub)+"</div>"+
        "<div class=\"tempo\" id=\"t\">Aguarde...</div></div>"+
        "<script>var _t0=Date.now(),_el=document.getElementById('t'),_dest="+dJs+";"+
        "var _poll=function(){fetch('"+p+"',{cache:'no-store'})"+
        ".then(function(r){return r.json();})"+
        ".then(function(d){var seg=Math.floor((Date.now()-_t0)/1000);"+
        "if(d.erro){document.body.innerHTML='<div style=\"padding:40px;font-family:monospace\">"+
        "<h2 style=\"color:#f87171\">Erro</h2><pre style=\"color:#f87171;white-space:pre-wrap\">'+d.erro+"+
        "'<\\/pre><p><a href=\"/\" style=\"color:#0ea5e9\">Tentar novamente<\\/a><\\/p><\\/div>';return;}"+
        "if(d.pronto){window.location.replace(_dest);return;}"+
        "if(_el)_el.textContent='Consultando banco... '+seg+'s';setTimeout(_poll,1500);})"+
        ".catch(function(){setTimeout(_poll,2000);});};setTimeout(_poll,800);"+
        "</script></body></html>";
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
// [NOVO] paginaEscolherFdb — exibida quando FDB não é encontrado automaticamente.
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
        "<span class=\"ico\">🗄️</span>" +
        "<h2>Banco de dados não encontrado</h2>" +
        "<p class=\"sub\">O arquivo <strong>SMALL.FDB</strong> não foi localizado automaticamente.<br>Informe o caminho correto para continuar.</p>" +
        msgErro +
        "<label>Caminho do arquivo SMALL.FDB</label>" +
        "<div class=\"row-inp\">" +
        "<input type=\"text\" id=\"fdbPath\" placeholder=\"Ex: C:\\Program Files (x86)\\SmallSoft\\Small Commerce\\SMALL.FDB\">" +
        "<button class=\"btn btn-sec\" id=\"btnPicker\" title=\"Abrir seletor de arquivos do Windows\">📂 Procurar</button>" +
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
        "btn.disabled=false;btn.textContent='📂 Procurar';" +
        "document.getElementById('spin').style.display='none';" +
        "if(d.ok&&d.caminho){document.getElementById('fdbPath').value=d.caminho;}" +
        "else if(d.cancelado){/* usuario cancelou — sem acao */}" +
        "else{mostrarErro(d.erro||'Não foi possível abrir o seletor de arquivos.');}}" +
        ")" +
        ".catch(function(e){" +
        "btn.disabled=false;btn.textContent='📂 Procurar';" +
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
// [NOVO] Abre dialogo nativo Windows para selecionar arquivo .fdb
// Usa PowerShell + System.Windows.Forms.OpenFileDialog
// Retorna { ok, caminho } ou { ok:false, erro } ou { cancelado:true }
// ---------------------------------------------------------------------------
var abrirPickerFdbWindows = function(cb) {
    // Script PowerShell inline — monta e executa o diálogo de arquivo
    var ps = [
        "Add-Type -AssemblyName System.Windows.Forms;",
        "$d = New-Object System.Windows.Forms.OpenFileDialog;",
        "$d.Title  = 'Selecionar banco Firebird (SMALL.FDB)';",
        "$d.Filter = 'Banco Firebird (*.fdb)|*.fdb|Todos os arquivos (*.*)|*.*';",
        "$d.InitialDirectory = 'C:\\';",
        "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.FileName } else { Write-Output '__CANCELADO__' }"
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
        var caminho = resultado.trim().replace(/\r?\n.*$/s, "").trim();
        if (!caminho || caminho === "__CANCELADO__") {
            cb({ ok: false, cancelado: true });
        } else {
            cb({ ok: true, caminho: caminho });
        }
    });
};

// ---------------------------------------------------------------------------
// [NOVO] Aplica novo caminho FDB em memória e reinicia conexão com o banco.
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
                setInterval(pollStatus, POLL_INTERVAL);
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
        var rk=!ek||ek.gerando?{pronto:false,erro:null}:ek.erro?{pronto:false,erro:ek.erro}:{pronto:true,erro:null};
        res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-cache,no-store"});
        res.end(JSON.stringify(rk));return;
    }

    // /api/status
    if(rota==="/api/status"){
        res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-cache,no-store"});
        res.end(JSON.stringify(statusAtual));return;
    }

    // /api/restart
    if(rota==="/api/restart"){
        logTs("Reinicialização solicitada via API ("
            + (req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "local")
            + "). Encerrando em 1s...");
        res.writeHead(200,{"Content-Type":"application/json; charset=utf-8"});
        res.end(JSON.stringify({ok:true,msg:"Servidor encerrando. O tray reiniciará em ~10s."}));
        setTimeout(function(){ process.exit(0); }, 1000);
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

    // /api/proibidos POST
    if(rota==="/api/proibidos" && req.method === "POST"){
        var body = "";
        req.on("data", function(chunk){ body+=chunk.toString(); });
        req.on("end", function(){
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
            appName:      cc.appName      || "",
            pollInterval: cc.pollInterval || 1000,
            maxLogLines:  cc.maxLogLines  || 1000,
            favicon:      cc.favicon      || "",
            proibidos:    Array.isArray(cc.proibidos) ? cc.proibidos : []
        });
        return;
    }

    // /api/config POST
    if(rota==="/api/config" && req.method==="POST"){
        var cfgBody="";
        req.on("data",function(c){cfgBody+=c.toString();});
        req.on("end",function(){
            try{
                var p=JSON.parse(cfgBody);
                var rawCfg="";
                try{ rawCfg=fs.readFileSync(CONFIG,"utf8").replace(/^\uFEFF/,"").trim(); }catch(e){}
                var obj={};
                if(rawCfg){ try{ obj=JSON.parse(rawCfg); }catch(e){ res.writeHead(500); res.end(JSON.stringify({ok:false,erro:"config.json corrompido"})); return; } }
                if(typeof obj!=="object"||Array.isArray(obj)) obj={};

                if(p.appName      !== undefined){ var n=String(p.appName||"").trim();   if(n) obj.appName=n; }
                if(p.pollInterval !== undefined){ var pi=parseInt(p.pollInterval,10);   if(pi>=200) obj.pollInterval=pi; }
                if(p.maxLogLines  !== undefined){ var ml=parseInt(p.maxLogLines,10);    if(ml>=100) obj.maxLogLines=ml; }
                if(p.favicon      !== undefined){ obj.favicon=String(p.favicon||"").trim(); }
                if(p.proibidos    !== undefined && Array.isArray(p.proibidos)){ obj.proibidos=p.proibidos; }

                fs.writeFileSync(CONFIG,JSON.stringify(obj,null,2),"utf8");

                var novosCfg=loadConfig();
                APP_NAME=(novosCfg.appName&&novosCfg.appName.trim())?novosCfg.appName.trim():"Relatorios";
                if(novosCfg.pollInterval&&parseInt(novosCfg.pollInterval,10)>0) POLL_INTERVAL=parseInt(novosCfg.pollInterval,10);
                if(novosCfg.maxLogLines&&parseInt(novosCfg.maxLogLines,10)>=100){ MAX_LOG_LINES=parseInt(novosCfg.maxLogLines,10); if(_logBuffer.length>MAX_LOG_LINES)_logBuffer=_logBuffer.slice(-MAX_LOG_LINES); }
                if(novosCfg.favicon&&novosCfg.favicon.trim()) FAVICON=novosCfg.favicon.trim();

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
            "<div class=\"field\">"+
              "<label>Ícone (favicon)</label>"+
              "<div style=\"display:flex;gap:2px;align-items:center;flex-wrap:wrap\">"+
                "<input type=\"text\" id=\"favicon\" placeholder=\"Caminho do arquivo ou vazio para usar favicon na mesma pasta\" value=\""+_fv+"\" style=\"flex:1;min-width:0\">"+
                "<button class=\"btn btn-sec\" type=\"button\" id=\"favPick\" style=\"white-space:nowrap;height:38px;padding:0 14px\" title=\"Selecionar arquivo do computador\">📂 Procurar</button>"+
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
            "var pi=parseInt(document.getElementById('pollInterval').value,10)||1000;"+
            "var ml=parseInt(document.getElementById('maxLogLines').value,10)||1000;"+
            "var fv=document.getElementById('favicon').value.trim();"+
            "var praw=document.getElementById('proibidos').value;"+
            "var pr=praw.split('\\n').map(function(s){return s.trim();}).filter(function(s){return s.length>0;});"+
            "var favFile=document.getElementById('favFile').files&&document.getElementById('favFile').files[0];"+
            "if(!an){showMsg('O nome do sistema nao pode estar vazio.','er');btn.disabled=false;btn.textContent='Salvar configuracoes';return;}"+
            "if(pi<200){showMsg('Intervalo minimo e 200 ms.','er');btn.disabled=false;btn.textContent='Salvar configuracoes';return;}"+
            "if(ml<100){showMsg('Maximo de linhas minimo e 100.','er');btn.disabled=false;btn.textContent='Salvar configuracoes';return;}"+
            "var doSave=function(){"+
            "fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},"+
            "body:JSON.stringify({appName:an,pollInterval:pi,maxLogLines:ml,favicon:fv,proibidos:pr})})"+
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
        var errBody="";
        req.on("data",function(c){errBody+=c.toString();});
        req.on("end",function(){
            try{
                var e=JSON.parse(errBody);
                logTs("[BROWSER-ERROR] "+String(e.msg||"")+(e.src?" | "+e.src:"")+(e.line?" L"+e.line:"")+(e.col?":"+e.col:"")+(e.stack?"\n"+e.stack:""));
            }catch(_){}
            res.writeHead(204);res.end();
        });
        return;
    }

    // /api/sse-clients
    if(rota==="/api/sse-clients"){
        sendJson({clients: sseClients.length});return;
    }

    // -----------------------------------------------------------------------
    // [NOVO] /selecionar-fdb — página HTML de seleção manual do FDB
    // Acessível sempre (mesmo quando dbStatus.ok=true) para reconfiguração.
    // -----------------------------------------------------------------------
    if(rota==="/selecionar-fdb"){
        res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
        res.end(paginaEscolherFdb());
        return;
    }

    // -----------------------------------------------------------------------
    // [NOVO] /api/abrir-picker-fdb GET — abre OpenFileDialog nativo do Windows
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
    // [NOVO] /api/salvar-fdb POST — recebe { caminho } e aplica o novo FDB
    // Valida existência do arquivo, testa conexão, persiste e limpa cache.
    // Responde: { ok:true } | { ok:false, erro:"..." }
    // -----------------------------------------------------------------------
    if(rota==="/api/salvar-fdb" && req.method==="POST"){
        var fdbBody="";
        req.on("data",function(c){fdbBody+=c.toString();});
        req.on("end",function(){
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
        logTs("SSE id="+clientId+" conectado. Total="+sseClients.length);

        var hb = setInterval(function(){
            try{res.write(": ping\n\n");}catch(e){clearInterval(hb);}
        }, 15000);

        req.on("close",function(){
            clearInterval(hb);
            sseClients = sseClients.filter(function(c){return c.id!==clientId;});
            logTs("SSE id="+clientId+" desconectado. Total="+sseClients.length);
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
        var favChunks=[];
        req.on("data",function(c){favChunks.push(c);});
        req.on("end",function(){
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
                res.writeHead(500,{"Content-Type":"application/json; charset=utf-8"});
                res.end(JSON.stringify({ok:false,erro:e.message}));
            }
        });
        return;
    }

    // /
    if(rota==="/"){
        // [NOVO] Se FDB não encontrado automaticamente, exibe picker manual
        if(_aguardandoFdbManual){
            res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
            res.end(paginaEscolherFdb());
            return;
        }
        var dh=hoje(),ent=cache[dh];
        if(!ent){gerarEmBackground(dh,dh,dh);ent=cache[dh];}
        if(ent.gerando){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(paginaLoading("Gerando relatorio de hoje...",isoParaBR(dh),dh,"/"));return;}
        if(ent.erro){var em=ent.erro;delete cache[dh];res.writeHead(500,{"Content-Type":"text/html; charset=utf-8"});res.end(paginaErro("Erro ao gerar relatorio de "+isoParaBR(dh),em,"/"));return;}
        res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(ent.html);return;
    }

    // /atualizar
    if(rota==="/atualizar"){
        logTs("Atualizando "+isoParaBR(hoje())+"...");
        delete cache[hoje()];
        res.writeHead(302,{"Location":"/"});res.end();return;
    }

    // /periodo
    if(rota==="/periodo"){
        // [NOVO] Se FDB não encontrado automaticamente, exibe picker manual
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
        if(ep.gerando){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(paginaLoading("Gerando relatorio...",label,chave,urlDest));return;}
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
    logTs(APP_NAME+" | "+addr);
    logTs("Banco configurado: "+FDB);

    var _dhHoje = hoje();
    var _marcaDia = "=== Servidor iniciado "+isoParaBR(_dhHoje)+" ===";
    var _jaDeclarou = _logBuffer.some(function(l){ return l.indexOf(_marcaDia) >= 0; });
    if (!_jaDeclarou) {
        logTs(_marcaDia);
        clearTimeout(_logFlushTimer); _flushLog();
    }

    aguardarFDB(function(dbOk){
        if(dbOk){
            logTs("Banco disponível em "+FDB_HOST+". Gerando relatório de hoje...");
            _aguardandoFdbManual = false;
        } else {
            // [NOVO] FDB não encontrado após todas tentativas automáticas.
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
                setInterval(pollStatus, POLL_INTERVAL);
            }, 5000);
            logTs("Polling Firebird ativo ("+POLL_INTERVAL/1000+"s).");
        }

        agendarRegen();
        logTs("Regeneração agendada ("+POLL_INTERVAL/1000+"s). Servidor pronto.");
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