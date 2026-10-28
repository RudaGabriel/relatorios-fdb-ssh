# iniciar-tray.ps1
# Servidor em background + icone na bandeja do sistema.
# Instancia unica via mutex global.
# Abrir Relatorio: se ja tem aba aberta (SSE), foca ela. Se nao, abre browser.
#
# @version 1.6.1
# @author Ruda Gabriel
# @changelog
#   (Historico completo das versoes: CHANGELOG.md no repositorio.)
#   1.6.1 - 2026-10-28 21:00 - Dispositivos conectados: mostra o apelido do aparelho (dado em
#     "Minhas preferencias") com o nome real entre parenteses.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
# NOTA (trade-off consciente): mantido SilentlyContinue - este e' um processo
# de bandeja em segundo plano sem console visivel; qualquer erro NAO tratado
# que virasse excecao terminante encerraria o icone inteiro sem aviso algum
# para o usuario (pior que o comportamento atual). A mitigacao real para a
# invisibilidade de erros e' o Write-TrayLog abaixo, chamado nos pontos
# criticos, em vez de trocar a politica global de erros.
$ErrorActionPreference = 'SilentlyContinue'

# ---------------------------------------------------------------------------
# Log - escreve no MESMO relatorio.log que servidor-relatorio.js usa (pedido
# do usuario: nao criar um arquivo tray.log separado). Formato identico ao
# que o Node grava ("[DD-MM-YYYY] [HH:MM:SS] mensagem"), com prefixo [TRAY]
# para diferenciar a origem das linhas quando misturadas no mesmo arquivo.
#
# CONCORRENCIA: servidor-relatorio.js (v2.6.2+) foi ajustado para nunca mais
# reescrever o arquivo inteiro em uso normal - so' ACRESCENTA linhas novas a
# cada flush, exatamente como Add-Content faz aqui. As duas operacoes de
# escrita (Node appendFileSync / PowerShell Add-Content) sao atomicas no
# nivel do SO para escritas deste tamanho, entao os dois processos podem
# gravar no mesmo arquivo com seguranca. Se estiver usando uma versao mais
# antiga de servidor-relatorio.js (que reescrevia o arquivo inteiro a cada
# flush), as linhas gravadas aqui serao apagadas no proximo flush do Node -
# atualize os dois arquivos juntos.
#
# Falhas ao gravar o log sao ignoradas de proposito (log e' best-effort,
# nunca deve impedir o tray de funcionar).
# ---------------------------------------------------------------------------
$DIR      = Split-Path -Parent $MyInvocation.MyCommand.Path
$LOG_PATH = Join-Path $DIR "relatorio.log"
function Write-TrayLog {
    param([string]$Msg, [string]$Nivel = "INFO")
    try {
        $prefixo = if ($Nivel -eq "INFO") { "" } else { "$($Nivel): " }
        # Data e hora do MESMO instante (duas chamadas a Get-Date podiam cair em
        # dias diferentes na virada da meia-noite).
        $agora = Get-Date
        $linha = "[{0:dd-MM-yyyy}] [{0:HH:mm:ss}] [TRAY] {1}{2}" -f $agora, $prefixo, $Msg
        Add-Content -Path $LOG_PATH -Value $linha -Encoding UTF8 -ErrorAction SilentlyContinue
    } catch {}
}

# ---------------------------------------------------------------------------
# Instancia unica via mutex
# ---------------------------------------------------------------------------
$mutexName = "Global\RelatoriosTray_7734"
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
$acquired = $false
# AbandonedMutexException = o tray anterior morreu sem liberar o mutex: ele
# FOI adquirido por esta instancia. Tratar como "outra instancia rodando"
# fazia o icone nunca mais subir ate reiniciar o Windows.
try { $acquired = $mutex.WaitOne(0) }
catch [System.Threading.AbandonedMutexException] { $acquired = $true }
catch { $acquired = $false }
if (-not $acquired) {
    Write-TrayLog "Outra instancia ja esta rodando (mutex ja em uso) - encerrando esta sem fazer nada."
    exit 0
}
Write-TrayLog "Mutex adquirido - nenhuma outra instancia ativa."


# ---------------------------------------------------------------------------
# Le config.json
# ---------------------------------------------------------------------------
$cfgPath = Join-Path $DIR "config.json"

$APP_NAME  = "Relatorios"
$PORT      = 7734
$MAQUINA_IP = $null
# Credenciais do Firebird - ver bloco de leitura do config.json abaixo.
$FB_USER = "SYSDBA"
$FB_PASS = "masterkey"

try {
    if (Test-Path $cfgPath) {
        $raw = [System.IO.File]::ReadAllText($cfgPath, [System.Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
        $cfg = $raw | ConvertFrom-Json
        if ($cfg.appName -and $cfg.appName -ne "") { $APP_NAME = $cfg.appName }
        if ($cfg.porta   -and $cfg.porta    -gt 0)  { $PORT     = [int]$cfg.porta }
        # SEGURANCA FIX: fbUser/fbPass agora podem vir do config.json em vez de
        # ficarem hardcoded no script. Mantido o fallback SYSDBA/masterkey
        # (credenciais de fabrica do Firebird) para nao quebrar instalacoes
        # existentes que nunca definiram esses campos.
        if ($cfg.fbUser -and $cfg.fbUser -ne "") { $FB_USER = [string]$cfg.fbUser }
        if ($cfg.fbPass -and $cfg.fbPass -ne "") { $FB_PASS = [string]$cfg.fbPass }
        # maquinaIP NAO e lido aqui - o servidor sempre o sobrescreve na inicializacao.
        # Sera relido logo apos o servidor subir (bloco abaixo).
    }
} catch {}

if ($FB_USER -eq "SYSDBA" -and $FB_PASS -eq "masterkey") {
    Write-TrayLog "Usando credenciais padrao de fabrica do Firebird (SYSDBA/masterkey). Defina fbUser/fbPass em config.json se o banco usa senha propria." "AVISO"
}
# TITULO FIX (ajuste solicitado): normalmente esta janela roda oculta (via
# launcher.vbs -WindowStyle Hidden), mas se alguem rodar o script direto
# (debug, ou se o launcher.vbs falhar) o titulo generico "Windows
# PowerShell" nao ajudava a identificar do que se tratava. Nunca derruba o
# tray se falhar - titulo e' so' cosmetico.
try { $host.UI.RawUI.WindowTitle = "$APP_NAME - Servidor (bandeja)" } catch {}
Write-TrayLog "Tray iniciando | App: $APP_NAME | Porta: $PORT"

# $ADDR      -> usado em Start-Process (abre no browser)
# $ADDR_LOCAL -> usado em Invoke-WebRequest (sempre IPv4 127.0.0.1, nunca falha por ::1)
$ADDR       = "http://localhost:$PORT"
$ADDR_LOCAL = "http://127.0.0.1:$PORT"

# ---------------------------------------------------------------------------
# Funcao: Abre relatorio - foca aba existente se possivel
# ---------------------------------------------------------------------------
function Open-Relatorio {
    param([string]$UrlPath = "/")
    $clients = 0
    try {
        $r = Invoke-WebRequest "$ADDR_LOCAL/api/sse-clients" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        $j = $r.Content | ConvertFrom-Json
        $clients = [int]$j.clients
    } catch { $clients = 0 }

    if ($clients -gt 0) {
        if ($UrlPath -eq "/") {
            try { Invoke-WebRequest "$ADDR_LOCAL/api/navigate/hoje" -UseBasicParsing -TimeoutSec 2 | Out-Null } catch {}
        } else {
            try { Start-Process ($ADDR + $UrlPath) } catch {}
        }
    } else {
        try { Start-Process ($ADDR + $UrlPath) } catch {}
    }
}

# ---------------------------------------------------------------------------
# Funcao: retorna contagem de clientes SSE (usa ADDR_LOCAL)
# ---------------------------------------------------------------------------
function Get-SseClients {
    try {
        $r = Invoke-WebRequest "$ADDR_LOCAL/api/sse-clients" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        $j = $r.Content | ConvertFrom-Json
        return [int]$j.clients
    } catch { return 0 }
}

# ---------------------------------------------------------------------------
# Funcao: verifica se o servidor HTTP esta respondendo.
# Retorna $true se OK, $false caso contrario.
# Usa TCP primeiro (rapido), depois confirma com HTTP.
# ---------------------------------------------------------------------------
function Test-ServidorAtivo {
    # 1) Teste TCP rapido (< 500 ms)
    try {
        $tc = New-Object Net.Sockets.TcpClient
        $ok = $tc.ConnectAsync("127.0.0.1", $PORT).Wait(500)
        $tc.Close()
        if (-not $ok) { return $false }
    } catch { return $false }

    # 2) Confirma via HTTP (garante que o Node ja subiu o listener)
    try {
        $r = Invoke-WebRequest "$ADDR_LOCAL/api/db-status" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        return ($r.StatusCode -eq 200)
    } catch { return $false }
}

# ---------------------------------------------------------------------------
# Inicia o servidor Node.js
# ---------------------------------------------------------------------------
$serverScript = Join-Path $DIR "servidor-relatorio.js"

# DIAGNOSTICO FIX: esse loop podia ficar ate' 30 minutos (120 x 15s) em
# silencio TOTAL se servidor-relatorio.js nao fosse encontrado (pensado
# para unidade de rede ainda mapeando no boot) - sem nenhum log, essa
# espera parecia um travamento sem explicacao nenhuma. Agora registra o
# inicio da espera e, se de fato demorar, um aviso a cada minuto.
if (-not (Test-Path $serverScript)) {
    Write-TrayLog "servidor-relatorio.js nao encontrado em '$serverScript' - aguardando ate 30min (rede pode estar mapeando no boot)." "AVISO"
}
$maxTentativas = 120
$tentativa     = 0
while (-not (Test-Path $serverScript) -and $tentativa -lt $maxTentativas) {
    $tentativa++
    if ($tentativa % 4 -eq 0) {
        Write-TrayLog "Ainda aguardando servidor-relatorio.js aparecer (${tentativa}/${maxTentativas} tentativas, ~$([math]::Round($tentativa*15/60,1))min)." "AVISO"
    }
    Start-Sleep -Seconds 15
}
if (-not (Test-Path $serverScript)) {
    Write-TrayLog "servidor-relatorio.js CONTINUA ausente apos 30min de espera - desistindo. Verifique se o arquivo existe em '$DIR'." "ERRO"
    [System.Windows.Forms.MessageBox]::Show(
        "Nao foi possivel encontrar servidor-relatorio.js em:`n$DIR`n`nReinstale ou verifique se a pasta do sistema esta completa.",
        "$APP_NAME - Erro",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    try { $mutex.ReleaseMutex() } catch {}
    exit 1
}

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName        = "node"
$psi.Arguments       = "`"$serverScript`" --no-browser"
# Credenciais por variavel de ambiente do processo filho (nao aparecem na
# linha de comando). Requer UseShellExecute = $false (definido abaixo).
$psi.EnvironmentVariables["RELATORIO_FB_USER"] = $FB_USER
$psi.EnvironmentVariables["RELATORIO_FB_PASS"] = $FB_PASS
$psi.WindowStyle     = [System.Diagnostics.ProcessWindowStyle]::Hidden
$psi.CreateNoWindow  = $true
$psi.UseShellExecute = $false

# Testa se a porta ja esta em uso.
# ROBUSTEZ FIX: a versao anterior usava $tc.Connect() SINCRONO sem timeout -
# se a porta estivesse "filtrada" (pacotes descartados em vez de recusados
# ativamente, ex: firewall silencioso), essa chamada podia travar por
# dezenas de segundos. Como esta funcao roda na THREAD DE UI (chamada pelo
# watchdog a cada 10s e pelo clique em "Reiniciar servidor"), um travamento
# aqui congelava o icone inteiro da bandeja. ConnectAsync(...).Wait(500) usa
# o mesmo padrao ja correto de Test-ServidorAtivo neste arquivo.
function Test-PortaLivre {
    param([int]$Porta)
    $tc = $null
    try {
        $tc = New-Object Net.Sockets.TcpClient
        $ok = $tc.ConnectAsync("127.0.0.1", $Porta).Wait(500)
        if ($ok -and $tc.Connected) { return $false }  # porta ocupada
        return $true                                    # porta livre (ou timeout = trata como livre)
    } catch {
        return $true   # porta livre (conexao recusada)
    } finally {
        try { if ($tc) { $tc.Close() } } catch {}
    }
}

# ---------------------------------------------------------------------------
# Encerra o servidor de forma ordenada (v1.4.0):
#   1) pede /api/encerrar - o servidor registra no relatorio.log, avisa as
#      telas abertas e encerra sozinho;
#   2) espera ate 5 s o processo terminar;
#   3) so' entao usa taskkill /F /T (arvore inteira) como ultimo recurso.
# Retorna uma descricao de como terminou, para o log do tray.
# ---------------------------------------------------------------------------
function Stop-ServidorOrdenado {
    param([switch]$Reiniciar)
    $param = if ($Reiniciar) { "reiniciar=1&origem=bandeja" } else { "origem=bandeja" }
    $pediu = $false
    try {
        Invoke-WebRequest "$ADDR_LOCAL/api/encerrar?$param" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop | Out-Null
        $pediu = $true
    } catch {}

    $proc = $script:nodeProc
    if ($proc -and -not $proc.HasExited) {
        try { $proc.WaitForExit(5000) | Out-Null } catch {}
    } elseif ($pediu) {
        # Servidor iniciado fora do tray: espera a porta liberar.
        $n = 0
        while (-not (Test-PortaLivre -Porta $PORT) -and $n -lt 10) { Start-Sleep -Milliseconds 500; $n++ }
    }

    if ($proc -and -not $proc.HasExited) {
        $pidAlvo = $proc.Id
        try {
            Start-Process -FilePath "taskkill.exe" -ArgumentList "/F","/T","/PID","$pidAlvo" -WindowStyle Hidden -Wait -ErrorAction Stop
        } catch {
            try { $proc.Kill() } catch {}
        }
        try { $proc.WaitForExit(3000) | Out-Null } catch {}
        return "forcado (nao respondeu ao pedido de encerramento; PID $pidAlvo)"
    }
    if ($pediu) { return "ordenado" }
    return "processo ja nao estava em execucao"
}

$script:nodeProc = $null

if (Test-PortaLivre -Porta $PORT) {
    try {
        $script:nodeProc = [System.Diagnostics.Process]::Start($psi)
        Write-TrayLog "Servidor iniciado (PID $($script:nodeProc.Id))."
    } catch {
        Write-TrayLog "Falha ao iniciar o servidor: $($_.Exception.Message)" "ERRO"
        [System.Windows.Forms.MessageBox]::Show(
            "Nao foi possivel iniciar o servidor.`nVerifique se o Node.js esta instalado.",
            "$APP_NAME - Erro",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
        try { $mutex.ReleaseMutex() } catch {}
        exit 1
    }
} else {
    Write-TrayLog "Porta $PORT ja estava ocupada ao iniciar - assumindo servidor ja rodando."
}

# ---------------------------------------------------------------------------
# Aguarda o servidor ficar disponivel (ate 30s) antes de continuar
# (necessario para que o maquinaIP seja salvo pelo servidor antes de ler)
#
# DIAGNOSTICO FIX: antes, esse loop simplesmente esgotava os 30s em silencio
# se o servidor nunca abrisse a porta - sem diferenciar "processo morreu
# logo de cara" (Node ausente, erro de sintaxe, modulo faltando) de
# "processo vivo mas ainda inicializando" (Firebird demorando a responder,
# maquina lenta). Agora verifica HasExited no processo apos a espera e
# registra qual dos dois casos aconteceu, com o codigo de saida quando
# disponivel - a diferenca e' o que separa "reinstale o Node" de "so'
# espere mais um pouco".
# ---------------------------------------------------------------------------
$_espera = 0
$_portaAbriu = $false
while ($_espera -lt 30) {
    if (-not (Test-PortaLivre -Porta $PORT)) { $_portaAbriu = $true; break }
    if ($script:nodeProc -and $script:nodeProc.HasExited) { break }  # nao adianta continuar esperando
    Start-Sleep -Milliseconds 500
    $_espera++
}

if ($_portaAbriu) {
    Write-TrayLog "Servidor respondendo na porta $PORT apos $([math]::Round($_espera*0.5,1))s."
} elseif ($script:nodeProc -and $script:nodeProc.HasExited) {
    Write-TrayLog "Processo do servidor encerrou sozinho logo apos iniciar (codigo de saida: $($script:nodeProc.ExitCode)). Verifique relatorio.log na pasta do sistema para o motivo (Node.js ausente, modulo faltando, ou erro ao conectar no Firebird sao as causas mais comuns)." "ERRO"
    [System.Windows.Forms.MessageBox]::Show(
        "O servidor iniciou mas fechou sozinho logo em seguida.`nConsulte relatorio.log na pasta do sistema para o motivo.`n`nCausas comuns: Node.js nao instalado corretamente, ou banco de dados Firebird inacessivel.",
        "$APP_NAME - Erro",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
} elseif ($script:nodeProc) {
    Write-TrayLog "Servidor ainda nao respondeu na porta $PORT apos 30s, mas o processo continua vivo (PID $($script:nodeProc.Id)) - pode estar demorando para conectar ao Firebird. Continuando." "AVISO"
}

# Reler maquinaIP do config apos o servidor subir.
# O servidor SEMPRE sobrescreve maquinaIP com o IP real da maquina na inicializacao,
# entao aqui sempre obteremos o valor correto e atualizado.
try {
    if (Test-Path $cfgPath) {
        $raw2 = [System.IO.File]::ReadAllText($cfgPath, [System.Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
        $cfg2 = $raw2 | ConvertFrom-Json
        if ($cfg2.maquinaIP -and $cfg2.maquinaIP -ne "") {
            $MAQUINA_IP = $cfg2.maquinaIP.Trim()
        }
    }
} catch {}

# ---------------------------------------------------------------------------
# Visual do menu (v1.5.0): icones vetoriais (os mesmos SVG Lucide do relatorio),
# cores proprias e nitidez em telas com escala. Codigo C# compilado na hora
# (compativel com o PowerShell 5.1 do Windows). Se a compilacao falhar por
# qualquer motivo, o menu continua funcionando, so' que sem icones e no visual
# padrao do Windows - nunca derruba a bandeja.
# ---------------------------------------------------------------------------
$script:visualOk = $false
$csTray = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
// @@GDI-INICIO
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Windows.Forms;
// @@GDI-FIM

namespace RelTray
{
    // Trecho de caminho ja convertido: 0 = mover, 1 = linha, 2 = curva cubica, 3 = fechar.
    public struct Seg
    {
        public int Tipo;
        public float X1, Y1, X2, Y2, X3, Y3;
        public Seg(int t, float x1, float y1, float x2, float y2, float x3, float y3)
        { Tipo = t; X1 = x1; Y1 = y1; X2 = x2; Y2 = y2; X3 = x3; Y3 = y3; }
    }

    // Leitor minimo de icones SVG (o mesmo desenho dos icones do relatorio - Lucide,
    // grade 24x24). Elementos separados por ";":
    //   p:<d do path>   r:x,y,w,h,rx   c:cx,cy,r   e:cx,cy,rx,ry   l:x1,y1,x2,y2
    // Comandos de path: M L H V C S Q T A Z (maiusculos e minusculos). Arcos viram
    // curvas cubicas (SVG 1.1, apendice F.6). Nunca lanca: trecho invalido e' ignorado.
    public static class SvgMini
    {
        static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        public static List<Seg> Icone(string def)
        {
            List<Seg> o = new List<Seg>();
            if (string.IsNullOrEmpty(def)) return o;
            foreach (string bruto in def.Split(';'))
            {
                string el = bruto.Trim();
                if (el.Length < 3 || el[1] != ':') continue;
                string corpo = el.Substring(2);
                try
                {
                    switch (el[0])
                    {
                        case 'p': Caminho(corpo, o); break;
                        case 'r': Retangulo(Nums(corpo), o); break;
                        case 'c': { float[] n = Nums(corpo); if (n.Length >= 3) Elipse(n[0], n[1], n[2], n[2], o); } break;
                        case 'e': { float[] n = Nums(corpo); if (n.Length >= 4) Elipse(n[0], n[1], n[2], n[3], o); } break;
                        case 'l':
                            {
                                float[] n = Nums(corpo);
                                if (n.Length >= 4) { o.Add(new Seg(0, n[0], n[1], 0, 0, 0, 0)); o.Add(new Seg(1, n[2], n[3], 0, 0, 0, 0)); }
                            }
                            break;
                    }
                }
                catch { /* elemento invalido: ignora so' ele */ }
            }
            return o;
        }

        static float[] Nums(string s)
        {
            string[] p = s.Split(new char[] { ',', ' ' }, StringSplitOptions.RemoveEmptyEntries);
            List<float> r = new List<float>();
            foreach (string x in p) { float v; if (float.TryParse(x, NumberStyles.Float, Inv, out v)) r.Add(v); }
            return r.ToArray();
        }

        static void Retangulo(float[] n, List<Seg> o)
        {
            if (n.Length < 4) return;
            float x = n[0], y = n[1], w = n[2], h = n[3], r = n.Length > 4 ? n[4] : 0;
            r = Math.Max(0, Math.Min(r, Math.Min(w, h) / 2));
            if (r <= 0)
            {
                o.Add(new Seg(0, x, y, 0, 0, 0, 0)); o.Add(new Seg(1, x + w, y, 0, 0, 0, 0));
                o.Add(new Seg(1, x + w, y + h, 0, 0, 0, 0)); o.Add(new Seg(1, x, y + h, 0, 0, 0, 0)); o.Add(new Seg(3, 0, 0, 0, 0, 0, 0));
                return;
            }
            string d = string.Format(Inv, "M{0} {1}H{2}A{3} {3} 0 0 1 {4} {5}V{6}A{3} {3} 0 0 1 {2} {7}H{0}A{3} {3} 0 0 1 {8} {6}V{5}A{3} {3} 0 0 1 {0} {1}Z",
                x + r, y, x + w - r, r, x + w, y + r, y + h - r, y + h, x);
            Caminho(d, o);
        }

        static void Elipse(float cx, float cy, float rx, float ry, List<Seg> o)
        {
            string d = string.Format(Inv, "M{0} {1}A{2} {3} 0 1 0 {4} {1}A{2} {3} 0 1 0 {0} {1}Z", cx - rx, cy, rx, ry, cx + rx);
            Caminho(d, o);
        }

        // ---- tokenizacao ----
        sealed class Leitor
        {
            readonly string s; int i;
            public Leitor(string t) { s = t ?? ""; i = 0; }
            void Pular() { while (i < s.Length && (char.IsWhiteSpace(s[i]) || s[i] == ',')) i++; }
            public bool Fim { get { Pular(); return i >= s.Length; } }
            public bool ProximoEhComando { get { Pular(); return i < s.Length && char.IsLetter(s[i]) && s[i] != 'e' && s[i] != 'E'; } }
            public char Comando() { Pular(); return s[i++]; }
            public bool TemNumero { get { Pular(); return i < s.Length && (char.IsDigit(s[i]) || s[i] == '-' || s[i] == '+' || s[i] == '.'); } }
            public float Numero()
            {
                Pular();
                int ini = i;
                if (i < s.Length && (s[i] == '-' || s[i] == '+')) i++;
                bool ponto = false;
                while (i < s.Length && (char.IsDigit(s[i]) || (s[i] == '.' && !ponto)))
                {
                    if (s[i] == '.') ponto = true;
                    i++;
                }
                if (i < s.Length && (s[i] == 'e' || s[i] == 'E'))
                {
                    int volta = i; i++;
                    if (i < s.Length && (s[i] == '-' || s[i] == '+')) i++;
                    if (i < s.Length && char.IsDigit(s[i])) { while (i < s.Length && char.IsDigit(s[i])) i++; }
                    else i = volta;
                }
                if (i == ini) throw new FormatException("numero esperado");
                return float.Parse(s.Substring(ini, i - ini), NumberStyles.Float, Inv);
            }
            // Bandeira de arco: um unico "0" ou "1" (pode vir colado: "011").
            public bool Bandeira()
            {
                Pular();
                if (i < s.Length && (s[i] == '0' || s[i] == '1')) { return s[i++] == '1'; }
                throw new FormatException("bandeira esperada");
            }
        }

        public static void Caminho(string d, List<Seg> o)
        {
            Leitor L = new Leitor(d);
            float cx = 0, cy = 0, sx = 0, sy = 0;      // ponto atual e inicio do subcaminho
            float ux = 0, uy = 0; char ult = ' ';       // ultimo controle (S/T)
            char cmd = ' ';
            int guarda = 0;
            while (!L.Fim && guarda++ < 10000)
            {
                if (L.ProximoEhComando) cmd = L.Comando();
                else if (cmd == ' ') return;
                bool rel = char.IsLower(cmd);
                char C = char.ToUpperInvariant(cmd);
                switch (C)
                {
                    case 'M':
                        {
                            float x = L.Numero(), y = L.Numero();
                            if (rel) { x += cx; y += cy; }
                            o.Add(new Seg(0, x, y, 0, 0, 0, 0));
                            cx = sx = x; cy = sy = y;
                            cmd = rel ? 'l' : 'L';              // pares seguintes = linhas
                            ult = 'M';
                        }
                        break;
                    case 'L':
                        {
                            float x = L.Numero(), y = L.Numero();
                            if (rel) { x += cx; y += cy; }
                            o.Add(new Seg(1, x, y, 0, 0, 0, 0)); cx = x; cy = y; ult = 'L';
                        }
                        break;
                    case 'H':
                        { float x = L.Numero(); if (rel) x += cx; o.Add(new Seg(1, x, cy, 0, 0, 0, 0)); cx = x; ult = 'L'; }
                        break;
                    case 'V':
                        { float y = L.Numero(); if (rel) y += cy; o.Add(new Seg(1, cx, y, 0, 0, 0, 0)); cy = y; ult = 'L'; }
                        break;
                    case 'C':
                        {
                            float x1 = L.Numero(), y1 = L.Numero(), x2 = L.Numero(), y2 = L.Numero(), x = L.Numero(), y = L.Numero();
                            if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; }
                            o.Add(new Seg(2, x1, y1, x2, y2, x, y)); ux = x2; uy = y2; cx = x; cy = y; ult = 'C';
                        }
                        break;
                    case 'S':
                        {
                            float x2 = L.Numero(), y2 = L.Numero(), x = L.Numero(), y = L.Numero();
                            if (rel) { x2 += cx; y2 += cy; x += cx; y += cy; }
                            float x1 = ult == 'C' ? 2 * cx - ux : cx, y1 = ult == 'C' ? 2 * cy - uy : cy;
                            o.Add(new Seg(2, x1, y1, x2, y2, x, y)); ux = x2; uy = y2; cx = x; cy = y; ult = 'C';
                        }
                        break;
                    case 'Q':
                        {
                            float qx = L.Numero(), qy = L.Numero(), x = L.Numero(), y = L.Numero();
                            if (rel) { qx += cx; qy += cy; x += cx; y += cy; }
                            Quad(o, cx, cy, qx, qy, x, y); ux = qx; uy = qy; cx = x; cy = y; ult = 'Q';
                        }
                        break;
                    case 'T':
                        {
                            float x = L.Numero(), y = L.Numero();
                            if (rel) { x += cx; y += cy; }
                            float qx = ult == 'Q' ? 2 * cx - ux : cx, qy = ult == 'Q' ? 2 * cy - uy : cy;
                            Quad(o, cx, cy, qx, qy, x, y); ux = qx; uy = qy; cx = x; cy = y; ult = 'Q';
                        }
                        break;
                    case 'A':
                        {
                            float rx = L.Numero(), ry = L.Numero(), rot = L.Numero();
                            bool fa = L.Bandeira(), fs = L.Bandeira();
                            float x = L.Numero(), y = L.Numero();
                            if (rel) { x += cx; y += cy; }
                            Arco(o, cx, cy, rx, ry, rot, fa, fs, x, y); cx = x; cy = y; ult = 'A';
                        }
                        break;
                    case 'Z':
                        o.Add(new Seg(3, 0, 0, 0, 0, 0, 0)); cx = sx; cy = sy; ult = 'Z';
                        cmd = ' ';
                        if (!L.ProximoEhComando) return;        // "Z" seguido de numero: invalido
                        break;
                    default:
                        return;                                  // comando desconhecido: para
                }
            }
        }

        static void Quad(List<Seg> o, float x0, float y0, float qx, float qy, float x, float y)
        {
            o.Add(new Seg(2, x0 + 2f / 3f * (qx - x0), y0 + 2f / 3f * (qy - y0), x + 2f / 3f * (qx - x), y + 2f / 3f * (qy - y), x, y));
        }

        static double Angulo(double ux, double uy, double vx, double vy)
        {
            return Math.Atan2(ux * vy - uy * vx, ux * vx + uy * vy);
        }

        static void Arco(List<Seg> o, float x1, float y1, float rxF, float ryF, float rotGraus, bool fa, bool fs, float x2, float y2)
        {
            if (x1 == x2 && y1 == y2) return;
            double rx = Math.Abs(rxF), ry = Math.Abs(ryF);
            if (rx < 1e-6 || ry < 1e-6) { o.Add(new Seg(1, x2, y2, 0, 0, 0, 0)); return; }
            double phi = rotGraus * Math.PI / 180.0, cos = Math.Cos(phi), sin = Math.Sin(phi);
            double dx = (x1 - x2) / 2.0, dy = (y1 - y2) / 2.0;
            double x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
            double lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
            if (lam > 1) { double k = Math.Sqrt(lam); rx *= k; ry *= k; }
            double num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
            double den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
            double coef = den <= 0 ? 0 : Math.Sqrt(Math.Max(0, num / den));
            if (fa == fs) coef = -coef;
            double cxp = coef * rx * y1p / ry, cyp = -coef * ry * x1p / rx;
            double ccx = cos * cxp - sin * cyp + (x1 + x2) / 2.0, ccy = sin * cxp + cos * cyp + (y1 + y2) / 2.0;
            double t1 = Angulo(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
            double dt = Angulo((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
            if (!fs && dt > 0) dt -= 2 * Math.PI;
            else if (fs && dt < 0) dt += 2 * Math.PI;
            int n = (int)Math.Ceiling(Math.Abs(dt) / (Math.PI / 2) - 1e-9);
            if (n < 1) n = 1;
            double delta = dt / n, t = 4.0 / 3.0 * Math.Tan(delta / 4);
            for (int k = 0; k < n; k++)
            {
                double a1 = t1 + k * delta, a2 = a1 + delta;
                double c1 = Math.Cos(a1), s1 = Math.Sin(a1), c2 = Math.Cos(a2), s2 = Math.Sin(a2);
                double p1x = c1 - t * s1, p1y = s1 + t * c1;   // controle 1 (unitario)
                double p2x = c2 + t * s2, p2y = s2 - t * c2;   // controle 2
                o.Add(new Seg(2,
                    (float)(ccx + rx * cos * p1x - ry * sin * p1y), (float)(ccy + rx * sin * p1x + ry * cos * p1y),
                    (float)(ccx + rx * cos * p2x - ry * sin * p2y), (float)(ccy + rx * sin * p2x + ry * cos * p2y),
                    (k == n - 1) ? x2 : (float)(ccx + rx * cos * c2 - ry * sin * s2),
                    (k == n - 1) ? y2 : (float)(ccy + rx * sin * c2 + ry * cos * s2)));
            }
        }

        // Para conferencia (testes): os trechos de volta em SVG so' com M/L/C/Z.
        public static string ParaSvg(List<Seg> segs)
        {
            StringBuilder b = new StringBuilder();
            foreach (Seg g in segs)
            {
                switch (g.Tipo)
                {
                    case 0: b.AppendFormat(Inv, "M{0:0.###} {1:0.###}", g.X1, g.Y1); break;
                    case 1: b.AppendFormat(Inv, "L{0:0.###} {1:0.###}", g.X1, g.Y1); break;
                    case 2: b.AppendFormat(Inv, "C{0:0.###} {1:0.###} {2:0.###} {3:0.###} {4:0.###} {5:0.###}", g.X1, g.Y1, g.X2, g.Y2, g.X3, g.Y3); break;
                    case 3: b.Append("Z"); break;
                }
            }
            return b.ToString();
        }
    }
// @@GDI-INICIO

    // Desenha um icone (grade 24x24) no tamanho pedido, com traco arredondado e
    // suavizacao. Subcaminho minusculo (os "pontos" dos icones, ex.: M12 18h.01)
    // vira um circulo cheio do tamanho do traco.
    public static class Icones
    {
        public static Bitmap Criar(string def, int px, Color cor, float traco)
        {
            if (px < 8) px = 8;
            Bitmap bmp = new Bitmap(px, px, PixelFormat.Format32bppArgb);
            using (Graphics g = Graphics.FromImage(bmp))
            using (Pen pen = new Pen(cor, traco))
            using (SolidBrush pincel = new SolidBrush(cor))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.Clear(Color.Transparent);
                float esc = px / 24f;
                g.ScaleTransform(esc, esc);
                pen.StartCap = LineCap.Round; pen.EndCap = LineCap.Round; pen.LineJoin = LineJoin.Round;
                List<Seg> segs = SvgMini.Icone(def);
                List<List<Seg>> partes = new List<List<Seg>>();
                List<Seg> atual = null;
                foreach (Seg s in segs)
                {
                    if (s.Tipo == 0 || atual == null) { atual = new List<Seg>(); partes.Add(atual); }
                    atual.Add(s);
                }
                foreach (List<Seg> parte in partes) DesenharParte(g, pen, pincel, parte, traco);
            }
            return bmp;
        }

        static void DesenharParte(Graphics g, Pen pen, Brush pincel, List<Seg> parte, float traco)
        {
            float px = 0, py = 0, ix = 0, iy = 0, minX = 1e9f, minY = 1e9f, maxX = -1e9f, maxY = -1e9f;
            bool fechar = false;
            using (GraphicsPath gp = new GraphicsPath())
            {
                foreach (Seg s in parte)
                {
                    switch (s.Tipo)
                    {
                        case 0: px = ix = s.X1; py = iy = s.Y1; break;
                        case 1: gp.AddLine(px, py, s.X1, s.Y1); px = s.X1; py = s.Y1; break;
                        case 2: gp.AddBezier(px, py, s.X1, s.Y1, s.X2, s.Y2, s.X3, s.Y3); px = s.X3; py = s.Y3; break;
                        case 3: fechar = true; px = ix; py = iy; break;
                    }
                    if (s.Tipo == 0 || s.Tipo == 1) { minX = Math.Min(minX, s.X1); maxX = Math.Max(maxX, s.X1); minY = Math.Min(minY, s.Y1); maxY = Math.Max(maxY, s.Y1); }
                    if (s.Tipo == 2) { minX = Math.Min(minX, s.X3); maxX = Math.Max(maxX, s.X3); minY = Math.Min(minY, s.Y3); maxY = Math.Max(maxY, s.Y3); }
                }
                if (maxX - minX < 0.3f && maxY - minY < 0.3f)
                {
                    g.FillEllipse(pincel, ix - traco / 2f, iy - traco / 2f, traco, traco);
                    return;
                }
                if (fechar) gp.CloseFigure();
                g.DrawPath(pen, gp);
            }
        }

        // Icone da bandeja (quando nao ha favicon.png): quadrado arredondado em degrade
        // com grafico de barras branco.
        public static Icon Bandeja(int px)
        {
            using (Bitmap bmp = new Bitmap(px, px, PixelFormat.Format32bppArgb))
            {
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.Clear(Color.Transparent);
                    float r = px * 0.22f, w = px - 1;
                    using (GraphicsPath fundo = new GraphicsPath())
                    {
                        fundo.AddArc(0, 0, r * 2, r * 2, 180, 90); fundo.AddArc(w - r * 2, 0, r * 2, r * 2, 270, 90);
                        fundo.AddArc(w - r * 2, w - r * 2, r * 2, r * 2, 0, 90); fundo.AddArc(0, w - r * 2, r * 2, r * 2, 90, 90);
                        fundo.CloseFigure();
                        using (LinearGradientBrush lg = new LinearGradientBrush(new PointF(0, 0), new PointF(px, px), Color.FromArgb(37, 99, 235), Color.FromArgb(14, 165, 233)))
                            g.FillPath(lg, fundo);
                    }
                    float esc = px / 24f;
                    g.ScaleTransform(esc, esc);
                    using (Pen p = new Pen(Color.White, 2.6f))
                    {
                        p.StartCap = LineCap.Round; p.EndCap = LineCap.Round;
                        g.DrawLine(p, 7, 17, 7, 12); g.DrawLine(p, 12, 17, 12, 7); g.DrawLine(p, 17, 17, 17, 10);
                    }
                }
                IntPtr h = bmp.GetHicon();
                Icon tmp = Icon.FromHandle(h);
                Icon copia = (Icon)tmp.Clone();
                tmp.Dispose();
                DestroyIcon(h);
                return copia;
            }
        }
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern bool DestroyIcon(IntPtr h);
    }

    // Nitidez em telas com escala (125%, 150%...): sem isto o Windows estica o menu
    // desenhado a 100% e os icones ficam borrados. Chamado antes de criar janelas.
    public static class Dpi
    {
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern bool SetProcessDPIAware();
        public static void Ativar() { try { SetProcessDPIAware(); } catch { } }
    }

    // Cores do menu: fundo branco, destaque azul claro, bordas e separadores suaves.
    public class Cores : ProfessionalColorTable
    {
        static Color C(int r, int g, int b) { return Color.FromArgb(r, g, b); }
        public override Color ToolStripDropDownBackground { get { return Color.White; } }
        public override Color ImageMarginGradientBegin { get { return Color.White; } }
        public override Color ImageMarginGradientMiddle { get { return Color.White; } }
        public override Color ImageMarginGradientEnd { get { return Color.White; } }
        public override Color MenuBorder { get { return C(209, 213, 219); } }
        public override Color MenuItemBorder { get { return C(147, 197, 253); } }
        public override Color MenuItemSelected { get { return C(232, 240, 254); } }
        public override Color MenuItemSelectedGradientBegin { get { return C(232, 240, 254); } }
        public override Color MenuItemSelectedGradientEnd { get { return C(232, 240, 254); } }
        public override Color MenuItemPressedGradientBegin { get { return C(219, 234, 254); } }
        public override Color MenuItemPressedGradientMiddle { get { return C(219, 234, 254); } }
        public override Color MenuItemPressedGradientEnd { get { return C(219, 234, 254); } }
        public override Color SeparatorDark { get { return C(229, 231, 235); } }
        public override Color SeparatorLight { get { return Color.White; } }
        public override Color CheckBackground { get { return C(219, 234, 254); } }
        public override Color CheckSelectedBackground { get { return C(191, 219, 254); } }
        public override Color CheckPressedBackground { get { return C(191, 219, 254); } }
    }

    public class Renderizador : ToolStripProfessionalRenderer
    {
        public Renderizador() : base(new Cores()) { RoundedEdges = true; }
        protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
        {
            if (e.Item is ToolStripMenuItem) e.TextColor = e.Item.Enabled ? Color.FromArgb(31, 41, 55) : Color.FromArgb(156, 163, 175);
            base.OnRenderItemText(e);
        }
        protected override void OnRenderArrow(ToolStripArrowRenderEventArgs e)
        {
            e.ArrowColor = Color.FromArgb(107, 114, 128);
            base.OnRenderArrow(e);
        }
    }
// @@GDI-FIM
}
'@
try {
    Add-Type -TypeDefinition $csTray -ReferencedAssemblies System.Windows.Forms, System.Drawing -ErrorAction Stop
    $script:visualOk = $true
    [RelTray.Dpi]::Ativar()
} catch {
    Write-TrayLog "Visual do menu indisponivel (icones desligados): $($_.Exception.Message)" "AVISO"
}
try { Add-Type -AssemblyName Microsoft.VisualBasic -ErrorAction Stop } catch {}

# Textos com acento: este arquivo e' 100% ASCII (o PowerShell 5.1 le .ps1 sem BOM
# na pagina de codigo do Windows), entao os acentos vao como \u00XX e viram o
# caractere certo aqui. So' para textos fixos - nunca passar nomes/caminhos por aqui.
function L([string]$s) { try { return [regex]::Unescape($s) } catch { return $s } }

# Tamanho dos icones conforme a escala da tela (16 px a 100%, 24 px a 150%...).
$ICON_PX = 16
try {
    $gDpi = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero)
    $ICON_PX = [int][math]::Max(16, [math]::Round(16 * $gDpi.DpiX / 96))
    $gDpi.Dispose()
} catch {}

# Icones (grade 24x24, mesmos desenhos Lucide do relatorio). Formato: elementos
# separados por ";" - p:<path> r:x,y,w,h,rx c:cx,cy,r e:cx,cy,rx,ry l:x1,y1,x2,y2
$ICONES = @{
    abrir       = 'r:2,3,20,14,2;l:8,21,16,21;l:12,17,12,21'
    externo     = 'p:M15 3h6v6;p:M10 14 21 3;p:M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'
    atualizar   = 'p:M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8;p:M21 3v5h-5;p:M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16;p:M8 16H3v5'
    periodo     = 'r:3,4,18,18,2;l:16,2,16,6;l:8,2,8,6;l:3,10,21,10;p:M8 14h.01;p:M12 14h.01;p:M16 14h.01;p:M8 18h.01;p:M12 18h.01'
    telas       = 'r:2,3,20,14,2;l:8,21,16,21;l:12,17,12,21;p:M7 8h10;p:M7 12h6'
    foco        = 'p:M15 3h6v6;p:M9 21H3v-6;p:M21 3l-7 7;p:M3 21l7-7'
    aviso       = 'p:M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z;p:M12 7v3;p:M12 13h.01'
    tema        = 'c:12,12,4;p:M12 2v2;p:M12 20v2;p:m4.93 4.93 1.41 1.41;p:m17.66 17.66 1.41 1.41;p:M2 12h2;p:M20 12h2;p:m6.34 17.66-1.41 1.41;p:m19.07 4.93-1.41 1.41'
    celular     = 'r:5,2,14,20,2;p:M12 18h.01'
    config      = 'p:M20 7h-9;p:M14 17H5;c:17,17,3;c:7,7,3'
    banco       = 'e:12,5,9,3;p:M3 5V19A9 3 0 0 0 21 19V5;p:M3 12A9 3 0 0 0 21 12'
    info        = 'c:12,12,10;p:M12 16v-4;p:M12 8h.01'
    pasta       = 'p:M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'
    log         = 'p:M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z;p:M14 2v4a2 2 0 0 0 2 2h4;p:M10 9H8;p:M16 13H8;p:M16 17H8'
    aovivo      = 'p:M22 12h-4l-3 9L9 3l-3 9H2'
    terminal    = 'p:m4 17 6-6-6-6;p:M12 19h8'
    programas   = 'r:3,3,7,7,1;r:14,3,7,7,1;r:14,14,7,7,1;r:3,14,7,7,1'
    link        = 'p:M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71;p:M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'
    ferramentas = 'p:M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'
    reiniciar   = 'p:M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8;p:M3 3v5h5'
    sair        = 'p:M12 2v10;p:M18.4 6.6a9 9 0 1 1-12.77.04'
    servidor    = 'r:2,2,20,8,2;r:2,14,20,8,2;p:M6 6h.01;p:M6 18h.01'
    qr          = 'r:3,3,5,5,1;r:16,3,5,5,1;r:3,16,5,5,1;p:M21 16h-3a2 2 0 0 0-2 2v3;p:M21 21v.01;p:M12 7v3a2 2 0 0 1-2 2H7;p:M3 12h.01;p:M12 3h.01;p:M12 16v.01;p:M16 12h1;p:M21 12v.01;p:M12 21v-1'
}
function Get-Icone([string]$nome, [string]$cor) {
    if (-not $script:visualOk -or -not $ICONES.ContainsKey($nome)) { return $null }
    try { return [RelTray.Icones]::Criar($ICONES[$nome], $ICON_PX, [System.Drawing.ColorTranslator]::FromHtml($cor), 2.0) }
    catch { return $null }
}
# Item de menu com icone. $Texto passa por L (acentos); $Acao = scriptblock do clique.
function New-ItemMenu {
    param([string]$Texto, [string]$Icone = "", [string]$Cor = "#374151", [scriptblock]$Acao = $null, [switch]$Negrito)
    $it = New-Object System.Windows.Forms.ToolStripMenuItem
    $it.Text = L $Texto
    if ($Icone) { $img = Get-Icone $Icone $Cor; if ($img) { $it.Image = $img } }
    if ($Negrito) { $it.Font = New-Object System.Drawing.Font($menu.Font.FontFamily, $menu.Font.Size, [System.Drawing.FontStyle]::Bold) }
    $it.Padding = New-Object System.Windows.Forms.Padding(0, 3, 0, 3)
    if ($Acao) { $it.Add_Click($Acao) }
    return $it
}
function New-Separador { return (New-Object System.Windows.Forms.ToolStripSeparator) }

# Chamada a API local do servidor (127.0.0.1). Devolve o JSON ja convertido, ou
# $null em falha ($script:ultimoErroApi diz o motivo, inclusive a mensagem que o
# servidor mandou em respostas 4xx/5xx). Corpo em UTF-8 (acentos no PowerShell 5.1).
$script:ultimoErroApi = ""
function Invoke-Api {
    param([string]$Rota, [string]$Metodo = "GET", $Corpo = $null, [int]$Timeout = 4)
    $script:ultimoErroApi = ""
    try {
        $p = @{ Uri = "$ADDR_LOCAL$Rota"; Method = $Metodo; UseBasicParsing = $true; TimeoutSec = $Timeout; ErrorAction = 'Stop'; Headers = @{ 'X-Cliente' = 'Bandeja' } }
        if ($null -ne $Corpo) {
            $p.Body = [System.Text.Encoding]::UTF8.GetBytes(($Corpo | ConvertTo-Json -Compress))
            $p.ContentType = 'application/json; charset=utf-8'
        }
        $r = Invoke-WebRequest @p
        $txt = [System.Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
        if (-not $txt) { return @{ ok = $true } }
        return ($txt | ConvertFrom-Json)
    } catch {
        $msg = $_.Exception.Message
        # Corpo da resposta de erro ({ok:false, erro:"..."}): em ErrorDetails (PS 5.1 e 7)
        # ou, se vazio, lido do proprio WebException (PS 5.1).
        try { if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $je = $_.ErrorDetails.Message | ConvertFrom-Json; if ($je.erro) { $script:ultimoErroApi = [string]$je.erro; return $null } } } catch {}
        try {
            $resp = $_.Exception.Response
            if ($resp) {
                $sr = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
                $corpoErro = $sr.ReadToEnd(); $sr.Close()
                $j = $corpoErro | ConvertFrom-Json
                if ($j.erro) { $msg = [string]$j.erro }
            }
        } catch {}
        $script:ultimoErroApi = $msg
        return $null
    }
}
function Show-Balao([string]$Titulo, [string]$Texto, [string]$Tipo = "Info", [int]$Ms = 3500) {
    try {
        $tray.BalloonTipTitle = $Titulo
        $tray.BalloonTipText  = $Texto
        $tray.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::$Tipo
        $tray.ShowBalloonTip($Ms)
    } catch {}
}
function Show-Mensagem([string]$Texto, [string]$Titulo, [string]$Icone = "Information") {
    [System.Windows.Forms.MessageBox]::Show($Texto, $Titulo, [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::$Icone) | Out-Null
}
function Get-MaquinaIP {
    try {
        if (Test-Path $cfgPath) {
            $c = [System.IO.File]::ReadAllText($cfgPath, [System.Text.Encoding]::UTF8).TrimStart([char]0xFEFF) | ConvertFrom-Json
            if ($c.maquinaIP) { return ([string]$c.maquinaIP).Trim() }
        }
    } catch {}
    if ($MAQUINA_IP) { return $MAQUINA_IP }
    return "127.0.0.1"
}

# ---------------------------------------------------------------------------
# Janela "Dispositivos conectados": celulares e computadores com o relatorio
# aberto agora (nome do aparelho, IP, tipo, telas, rotas). Atualiza a cada 5 s.
# Variaveis em $script: porque os eventos (timer, botoes) rodam depois que a
# funcao ja terminou.
# ---------------------------------------------------------------------------
$script:formDisp = $null
function Update-Dispositivos {
    if (-not $script:formDisp -or $script:formDisp.IsDisposed) { return }
    $j = Invoke-Api "/api/dispositivos" -Timeout 3
    $lv = $script:dispLista
    if ($null -eq $j) {
        $script:dispStatus.Text = (L "N\u00e3o foi poss\u00edvel consultar o servidor: ") + $script:ultimoErroApi
        return
    }
    # Mantem a selecao entre as atualizacoes (a lista e refeita a cada 5 s).
    $selAntes = ""
    try { if ($lv.SelectedItems.Count -gt 0) { $selAntes = [string]$lv.SelectedItems[0].Tag } } catch {}
    $lv.BeginUpdate()
    try {
        $lv.Items.Clear()
        foreach ($d in @($j.dispositivos)) {
            if ($null -eq $d) { continue }
            $nome = if ($d.nome) { [string]$d.nome } else { L "(sem nome)" }
            # Apelido dado em "Minhas preferencias" (v1.6.1): aparece primeiro; o nome real fica entre parenteses.
            if ($d.apelido) { $nome = [string]$d.apelido + $(if ($d.nome) { " (" + [string]$d.nome + ")" } else { "" }) }
            $it = New-Object System.Windows.Forms.ListViewItem($nome)
            $tipo = (([string]$d.tipo) + " " + ([string]$d.modelo)).Trim()
            $rotas = ""
            try { $rotas = (@($d.rotas.PSObject.Properties) | ForEach-Object { "$($_.Name) x$($_.Value)" }) -join ", " } catch {}
            $prefs = L "padr\u00e3o do servidor"
            try { $pp = @($d.preferenciasProprias | Where-Object { $_ }); if ($pp.Count -gt 0) { $prefs = (L "pr\u00f3prias: ") + (($pp | ForEach-Object { [string]$_ }) -join ", ") } } catch {}
            foreach ($v in @([string]$d.ip, $tipo, [string]$d.sistema, [string]$d.navegador, $prefs, [string]$d.telasAbertas, [string]$d.conectadoDesde, [string]$d.ultimaAtividade, [string]$d.requisicoes, $rotas)) {
                $it.SubItems.Add($v) | Out-Null
            }
            $it.Tag = [string]$d.chavePreferencias
            $lv.Items.Add($it) | Out-Null
            if ($selAntes -and $it.Tag -eq $selAntes) { $it.Selected = $true }
        }
    } finally { $lv.EndUpdate() }
    $qtd = @($j.dispositivos).Count
    $script:dispStatus.Text = "$qtd " + $(if ($qtd -eq 1) { L "aparelho" } else { L "aparelhos" }) + (L " na rede \u2014 atualizado \u00e0s ") + (Get-Date -Format "HH:mm:ss") + (L " (esta m\u00e1quina n\u00e3o aparece)")
    Update-BotoesDispositivos
}
# Botoes que dependem de um aparelho selecionado (v1.6.0).
function Update-BotoesDispositivos {
    try {
        $tem = ($script:dispLista.SelectedItems.Count -gt 0) -and [string]$script:dispLista.SelectedItems[0].Tag
        $script:dispBotaoCfg.Enabled = [bool]$tem
        $script:dispBotaoPad.Enabled = [bool]$tem
    } catch {}
}
function Get-AparelhoSelecionado {
    try {
        if ($script:dispLista.SelectedItems.Count -eq 0) { return $null }
        $it = $script:dispLista.SelectedItems[0]
        if (-not [string]$it.Tag) { return $null }
        return @{ chave = [string]$it.Tag; texto = ([string]$it.Text + " (" + [string]$it.SubItems[1].Text + ")") }
    } catch { return $null }
}
function Show-Dispositivos {
    if ($script:formDisp -and -not $script:formDisp.IsDisposed) { $script:formDisp.Activate(); Update-Dispositivos; return }
    $f = New-Object System.Windows.Forms.Form
    $f.Text = "$APP_NAME - " + (L "Dispositivos conectados")
    $f.Size = New-Object System.Drawing.Size(1000, 440)
    $f.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $f.Font = New-Object System.Drawing.Font("Segoe UI", 9)
    $f.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
    try { $f.Icon = $tray.Icon } catch {}
    $lv = New-Object System.Windows.Forms.ListView
    $lv.View = [System.Windows.Forms.View]::Details
    $lv.FullRowSelect = $true; $lv.GridLines = $true; $lv.HideSelection = $false
    $lv.Dock = [System.Windows.Forms.DockStyle]::Fill
    foreach ($c in @(@("Nome do aparelho", 150), @("IP", 105), @("Tipo", 110), @("Sistema", 95), @("Navegador", 110), @("Prefer\u00eancias", 170), @("Telas", 50), @("Desde", 65), @("\u00daltima atividade", 105), @("Requisi\u00e7\u00f5es", 80), @("Rotas acessadas", 260))) {
        $lv.Columns.Add((L $c[0]), $c[1]) | Out-Null
    }
    # Rodape (v1.6.0): TableLayoutPanel com botoes AutoSize \u2014 o layout acompanha a escala
    # de DPI sozinho (antes as posicoes eram fixas em pixels e, com a tela em 125%/150%,
    # os botoes ficavam cortados e sem texto).
    $rodape = New-Object System.Windows.Forms.TableLayoutPanel
    $rodape.Dock = [System.Windows.Forms.DockStyle]::Bottom
    $rodape.AutoSize = $true; $rodape.AutoSizeMode = [System.Windows.Forms.AutoSizeMode]::GrowAndShrink
    $rodape.Padding = New-Object System.Windows.Forms.Padding(6, 6, 6, 6)
    $rodape.ColumnCount = 5; $rodape.RowCount = 1
    $rodape.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 100))) | Out-Null
    for ($i = 0; $i -lt 4; $i++) { $rodape.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::AutoSize))) | Out-Null }
    $st = New-Object System.Windows.Forms.Label
    $st.AutoSize = $false; $st.Dock = [System.Windows.Forms.DockStyle]::Fill
    $st.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
    $st.AutoEllipsis = $true
    $st.ForeColor = [System.Drawing.Color]::FromArgb(75, 85, 99)
    $novoBotao = {
        param([string]$texto)
        $b = New-Object System.Windows.Forms.Button
        $b.Text = L $texto
        $b.AutoSize = $true; $b.AutoSizeMode = [System.Windows.Forms.AutoSizeMode]::GrowAndShrink
        $b.MinimumSize = New-Object System.Drawing.Size(96, 30)
        $b.Padding = New-Object System.Windows.Forms.Padding(8, 2, 8, 2)
        $b.Margin = New-Object System.Windows.Forms.Padding(6, 0, 0, 0)
        $b.UseVisualStyleBackColor = $true
        return $b
    }
    $bCfg = & $novoBotao "Configura\u00e7\u00f5es do aparelho..."
    $bPad = & $novoBotao "Voltar ao padr\u00e3o"
    $bAt  = & $novoBotao "Atualizar"
    $bFe  = & $novoBotao "Fechar"
    $bCfg.Enabled = $false; $bPad.Enabled = $false
    $rodape.Controls.Add($st, 0, 0); $rodape.Controls.Add($bCfg, 1, 0); $rodape.Controls.Add($bPad, 2, 0); $rodape.Controls.Add($bAt, 3, 0); $rodape.Controls.Add($bFe, 4, 0)
    $f.Controls.Add($lv); $f.Controls.Add($rodape)
    $f.MinimumSize = New-Object System.Drawing.Size(720, 260)
    $script:formDisp = $f; $script:dispLista = $lv; $script:dispStatus = $st; $script:dispBotaoCfg = $bCfg; $script:dispBotaoPad = $bPad
    $lv.Add_SelectedIndexChanged({ Update-BotoesDispositivos })
    # Configuracoes do aparelho: abre o relatorio NESTA maquina com o modal das
    # preferencias daquele aparelho (duracao dos avisos, proibidos, teclas).
    $bCfg.Add_Click({
        $ap = Get-AparelhoSelecionado
        if ($null -eq $ap) { return }
        try { Start-Process ("$ADDR_LOCAL/?cfgAparelho=" + [System.Uri]::EscapeDataString($ap.chave)) } catch {
            Show-Mensagem ((L "N\u00e3o foi poss\u00edvel abrir o navegador: ") + $_.Exception.Message) $APP_NAME "Warning"
        }
    })
    $lv.Add_DoubleClick({ try { $script:dispBotaoCfg.PerformClick() } catch {} })
    $bPad.Add_Click({
        $ap = Get-AparelhoSelecionado
        if ($null -eq $ap) { return }
        $resp = [System.Windows.Forms.MessageBox]::Show((L "Apagar as prefer\u00eancias pr\u00f3prias de ") + $ap.texto + (L "?`n`nEle volta a seguir o padr\u00e3o do servidor (dura\u00e7\u00e3o dos avisos, proibidos e teclas)."), $APP_NAME, [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
        if ($resp -ne [System.Windows.Forms.DialogResult]::Yes) { return }
        $r = Invoke-Api ("/api/config?aparelho=" + [System.Uri]::EscapeDataString($ap.chave)) -Metodo "POST" -Corpo @{ restaurar = $true } -Timeout 5
        if ($null -eq $r -or -not $r.ok) {
            Show-Mensagem ((L "N\u00e3o foi poss\u00edvel restaurar: ") + $(if ($r -and $r.erro) { [string]$r.erro } else { $script:ultimoErroApi })) $APP_NAME "Warning"
        }
        Update-Dispositivos
    })
    $bAt.Add_Click({ Update-Dispositivos })
    $bFe.Add_Click({ try { $script:formDisp.Close() } catch {} })
    $script:dispTimer = New-Object System.Windows.Forms.Timer
    $script:dispTimer.Interval = 5000
    $script:dispTimer.Add_Tick({ Update-Dispositivos })
    $f.Add_FormClosed({
        try { $script:dispTimer.Stop(); $script:dispTimer.Dispose() } catch {}
        $script:formDisp = $null
    })
    $f.Add_Shown({ Update-Dispositivos; $script:dispTimer.Start() })
    $f.Show()
    $f.Activate()
}

# ---------------------------------------------------------------------------
# Icone da bandeja
# ---------------------------------------------------------------------------
$tray         = New-Object System.Windows.Forms.NotifyIcon
$tray.Text    = $APP_NAME
$tray.Visible = $true

$faviconPath = Join-Path $DIR "favicon.png"
if (Test-Path $faviconPath) {
    try {
        $bmp     = [System.Drawing.Bitmap]::FromFile($faviconPath)
        $resized = New-Object System.Drawing.Bitmap($bmp, 32, 32)
        $hIcon     = $resized.GetHicon()
        $tray.Icon = [System.Drawing.Icon]::FromHandle($hIcon)
        # LEAK FIX: (1) $resized nunca era descartado - Bitmap intermediario
        # do redimensionamento ficava preso na memoria pelo resto da sessao.
        # (2) GetHicon() retorna um HICON nativo (GDI) que .NET NAO libera
        # sozinho - Icon.FromHandle() apenas "empresta" o handle, nunca o
        # possui; a documentacao da Microsoft recomenda destruir esse handle
        # explicitamente via DestroyIcon (P/Invoke) apos clonar o Icon para
        # um objeto gerenciado independente do handle original.
        Add-Type -Namespace TrayNativo -Name Gdi32 -MemberDefinition '
            [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr hIcon);
        ' -ErrorAction SilentlyContinue
        $tray.Icon = $tray.Icon.Clone()  # copia gerenciada independente do HICON
        try { [TrayNativo.Gdi32]::DestroyIcon($hIcon) | Out-Null } catch {}
        $resized.Dispose()
        $bmp.Dispose()
    } catch { $tray.Icon = [System.Drawing.SystemIcons]::Application }
} else {
    # Sem favicon.png: icone proprio (grafico de barras em degrade azul) em vez do
    # icone generico de aplicativo do Windows.
    $tray.Icon = [System.Drawing.SystemIcons]::Application
    if ($script:visualOk) { try { $tray.Icon = [RelTray.Icones]::Bandeja(32) } catch {} }
}

# ---------------------------------------------------------------------------
# Menu de contexto (v1.5.0): todas as opcoes, em grupos, com icones.
#   [cabecalho: nome do sistema + status ao vivo]
#   Abrir relatorio / Abrir em nova aba
#   Atualizar dados de hoje / Gerar por periodo
#   Telas abertas > (trazer para frente, recarregar, aviso, tema)
#   Dispositivos conectados...
#   Configuracoes > (editar, banco FDB, status do banco)
#   Ferramentas > (informacoes, pasta, log, log ao vivo, api.ps1, programas, copiar endereco)
#   Reiniciar servidor / Sair
# ---------------------------------------------------------------------------
$menu = New-Object System.Windows.Forms.ContextMenuStrip
if ($script:visualOk) {
    try { $menu.Renderer = New-Object RelTray.Renderizador } catch { $menu.RenderMode = [System.Windows.Forms.ToolStripRenderMode]::System }
} else {
    $menu.RenderMode = [System.Windows.Forms.ToolStripRenderMode]::System
}
try { $menu.Font = New-Object System.Drawing.Font("Segoe UI", 9.75) } catch {}
$menu.ImageScalingSize = New-Object System.Drawing.Size($ICON_PX, $ICON_PX)
$menu.ShowCheckMargin = $false
$menu.ShowImageMargin = $true

# --- Cabecalho: nome + status (atualizado toda vez que o menu abre) ---
$cabTitulo = New-Object System.Windows.Forms.ToolStripLabel
$cabTitulo.Text = $APP_NAME
$cabTitulo.Font = New-Object System.Drawing.Font($menu.Font.FontFamily, ($menu.Font.Size + 0.5), [System.Drawing.FontStyle]::Bold)
$cabTitulo.ForeColor = [System.Drawing.Color]::FromArgb(17, 24, 39)
$cabTitulo.Padding = New-Object System.Windows.Forms.Padding(2, 6, 2, 0)
$imgCab = Get-Icone "servidor" "#2563EB"; if ($imgCab) { $cabTitulo.Image = $imgCab }
$cabStatus = New-Object System.Windows.Forms.ToolStripLabel
$cabStatus.Text = L "Verificando..."
$cabStatus.ForeColor = [System.Drawing.Color]::FromArgb(107, 114, 128)
$cabStatus.Padding = New-Object System.Windows.Forms.Padding(2, 0, 2, 0)
# Contagem em linha propria (v1.5.2): numa linha so o texto ficava cortado no menu.
$cabContagem = New-Object System.Windows.Forms.ToolStripLabel
$cabContagem.Text = ""
$cabContagem.ForeColor = [System.Drawing.Color]::FromArgb(107, 114, 128)
$cabContagem.Padding = New-Object System.Windows.Forms.Padding(2, 0, 2, 6)
$cabContagem.Visible = $false
$menu.Items.Add($cabTitulo) | Out-Null
$menu.Items.Add($cabStatus) | Out-Null
$menu.Items.Add($cabContagem) | Out-Null
$menu.Items.Add((New-Separador)) | Out-Null

function Update-Cabecalho {
    try {
        $db = Invoke-Api "/api/db-status" -Timeout 1
        if ($null -eq $db) {
            $cabStatus.Text = L "\u25cf Servidor fora do ar"
            $cabStatus.ForeColor = [System.Drawing.Color]::FromArgb(220, 38, 38)
            $cabContagem.Visible = $false
        } else {
            $telas = 0; $sc = Invoke-Api "/api/sse-clients" -Timeout 1; if ($sc) { $telas = [int]$sc.clients }
            $aparelhos = 0; $dv = Invoke-Api "/api/dispositivos" -Timeout 1; if ($dv) { $aparelhos = [int]$dv.total }
            $bancoTxt = if ($db.ok) { L "banco conectado" } elseif ($db.scanning) { L "procurando o banco..." } else { L "banco sem conex\u00e3o" }
            $cabStatus.Text = (L "\u25cf No ar \u00b7 ") + $bancoTxt
            $cabStatus.ForeColor = if ($db.ok) { [System.Drawing.Color]::FromArgb(22, 163, 74) } else { [System.Drawing.Color]::FromArgb(217, 119, 6) }
            $cabContagem.Text = [string]$telas + $(if ($telas -eq 1) { L " tela aberta" } else { L " telas abertas" }) + (L " \u00b7 ") + [string]$aparelhos + $(if ($aparelhos -eq 1) { L " aparelho na rede" } else { L " aparelhos na rede" })
            $cabContagem.Visible = $true
        }
    } catch {}
    # Recalcula a largura do menu com o texto novo (senao a linha sai cortada).
    try { $menu.PerformLayout() } catch {}
}
$menu.Add_Opening({ Update-Cabecalho })

# --- Abrir ---
$menu.Items.Add((New-ItemMenu "Abrir relat\u00f3rio" "abrir" "#2563EB" { Open-Relatorio "/" } -Negrito)) | Out-Null
$menu.Items.Add((New-ItemMenu "Abrir em nova aba do navegador" "externo" "#2563EB" { try { Start-Process $ADDR } catch {} })) | Out-Null
# QR code (v1.5.1): pagina do servidor com o codigo do endereco desta maquina na rede.
$menu.Items.Add((New-ItemMenu "Abrir no celular (QR code)..." "qr" "#2563EB" { try { Start-Process "$ADDR/qr" } catch {} })) | Out-Null
$menu.Items.Add((New-Separador)) | Out-Null

# --- Dados ---
$menu.Items.Add((New-ItemMenu "Atualizar dados de hoje" "atualizar" "#16A34A" {
    $clients = Get-SseClients
    if ($clients -gt 0) {
        # Aba aberta: navega para / (reload) e forca foco
        try { Invoke-WebRequest "$ADDR_LOCAL/api/navigate/hoje" -UseBasicParsing -TimeoutSec 2 | Out-Null } catch {}
        try { Invoke-WebRequest "$ADDR_LOCAL/api/navigate/foco" -UseBasicParsing -TimeoutSec 1 | Out-Null } catch {}
    } else {
        # Sem aba aberta: abre /atualizar no browser (redireciona para / apos limpar cache)
        try { Start-Process "$ADDR/atualizar" } catch {}
    }
})) | Out-Null
$menu.Items.Add((New-ItemMenu "Gerar por per\u00edodo..." "periodo" "#7C3AED" {
    $clients = Get-SseClients
    if ($clients -gt 0) {
        # Aba aberta: abre modal de periodo via SSE (nao abre nova aba)
        try {
            Invoke-WebRequest "$ADDR_LOCAL/api/navigate/hash/periodo" -UseBasicParsing -TimeoutSec 2 | Out-Null
        } catch {}
        try { Invoke-WebRequest "$ADDR_LOCAL/api/navigate/foco" -UseBasicParsing -TimeoutSec 1 | Out-Null } catch {}
    } else {
        # Sem aba aberta: abre /periodo no browser
        try { Start-Process "$ADDR/periodo" } catch {}
    }
})) | Out-Null
$menu.Items.Add((New-Separador)) | Out-Null

# --- Telas abertas ---
$subTelas = New-ItemMenu "Telas abertas" "telas" "#0891B2"
$subTelas.DropDownItems.Add((New-ItemMenu "Trazer o relat\u00f3rio para frente" "foco" "#0891B2" {
    $r = Invoke-Api "/api/navigate/foco" -Timeout 2
    if ($null -eq $r) { Open-Relatorio "/" }
})) | Out-Null
$subTelas.DropDownItems.Add((New-ItemMenu "Recarregar todas as telas" "atualizar" "#0891B2" {
    $r = Invoke-Api "/api/navigate/recarregar" -Timeout 3
    if ($null -eq $r) { Show-Balao $APP_NAME ((L "N\u00e3o foi poss\u00edvel recarregar: ") + $script:ultimoErroApi) "Warning"; return }
    $n = 0; try { $n = [int]$r.clients } catch {}
    Show-Balao $APP_NAME ((L "Recarregando ") + $n + $(if ($n -eq 1) { L " tela." } else { L " telas." })) "Info" 2500
})) | Out-Null
$subTelas.DropDownItems.Add((New-ItemMenu "Enviar aviso para as telas..." "aviso" "#0891B2" {
    $txt = ""
    try { $txt = [Microsoft.VisualBasic.Interaction]::InputBox((L "Mensagem que vai aparecer em destaque em todas as telas abertas (at\u00e9 300 caracteres):"), "$APP_NAME - " + (L "Enviar aviso"), "") } catch {}
    if ([string]::IsNullOrWhiteSpace($txt)) { return }
    if ($txt.Length -gt 300) { $txt = $txt.Substring(0, 300) }
    $r = Invoke-Api "/api/navigate/aviso" -Metodo POST -Corpo @{ msg = $txt; segundos = 15 } -Timeout 3
    if ($null -eq $r) { Show-Balao $APP_NAME ((L "Aviso n\u00e3o enviado: ") + $script:ultimoErroApi) "Warning"; return }
    $n = 0; try { $n = [int]$r.clients } catch {}
    Show-Balao $APP_NAME ((L "Aviso enviado para ") + $n + $(if ($n -eq 1) { L " tela." } else { L " telas." })) "Info" 2500
})) | Out-Null
$subTema = New-ItemMenu "Tema das telas" "tema" "#0891B2"
$subTema.DropDownItems.Add((New-Object System.Windows.Forms.ToolStripMenuItem((L "Carregando...")))) | Out-Null
$subTema.Add_DropDownOpening({
    $alvo = $this
    $alvo.DropDownItems.Clear()
    $t = Invoke-Api "/api/temas" -Timeout 2
    if ($null -eq $t -or -not $t.temas) {
        $vazio = New-Object System.Windows.Forms.ToolStripMenuItem((L "(servidor sem resposta)")); $vazio.Enabled = $false
        $alvo.DropDownItems.Add($vazio) | Out-Null; return
    }
    foreach ($tm in @($t.temas)) {
        $it = New-Object System.Windows.Forms.ToolStripMenuItem([string]$tm.nome)
        $it.Tag = [string]$tm.id
        $it.Add_Click({
            param($s, $e)
            $id = [string]$s.Tag
            $r = Invoke-Api ("/api/navigate/tema/" + [uri]::EscapeDataString($id)) -Timeout 3
            if ($null -eq $r) { Show-Balao $APP_NAME ((L "Tema n\u00e3o aplicado: ") + $script:ultimoErroApi) "Warning"; return }
            $n = 0; try { $n = [int]$r.clients } catch {}
            Show-Balao $APP_NAME ((L "Tema \u201c") + $s.Text + (L "\u201d aplicado em ") + $n + $(if ($n -eq 1) { L " tela." } else { L " telas." })) "Info" 2500
        })
        $alvo.DropDownItems.Add($it) | Out-Null
    }
})
$subTelas.DropDownItems.Add($subTema) | Out-Null
$menu.Items.Add($subTelas) | Out-Null
$menu.Items.Add((New-ItemMenu "Dispositivos conectados..." "celular" "#DB2777" { Show-Dispositivos })) | Out-Null
$menu.Items.Add((New-Separador)) | Out-Null

# --- Configuracoes ---
$subCfg = New-ItemMenu "Configura\u00e7\u00f5es" "config" "#475569"
$subCfg.DropDownItems.Add((New-ItemMenu "Editar configura\u00e7\u00f5es..." "config" "#475569" {
    # v1.6.0: o servidor so abre o modal nas telas DESTA maquina (nao nos celulares);
    # se nenhuma recebeu, abre a pagina de configuracoes no navegador.
    $enviado = 0
    $rn = Invoke-Api "/api/navigate/config" -Timeout 2
    if ($rn -and $rn.clients) { $enviado = [int]$rn.clients }
    if ($enviado -gt 0) {
        try { Invoke-WebRequest "$ADDR_LOCAL/api/navigate/foco" -UseBasicParsing -TimeoutSec 1 | Out-Null } catch {}
    } else {
        try {
            Start-Process "$ADDR/config"
        } catch {
            [System.Windows.Forms.MessageBox]::Show(
                "Nao foi possivel abrir o painel de configuracoes:`n$ADDR/config",
                "$APP_NAME",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Warning
            ) | Out-Null
        }
    }
})) | Out-Null
$subCfg.DropDownItems.Add((New-ItemMenu "Selecionar banco (FDB)..." "banco" "#475569" {
    # 1) Verifica se o servidor esta respondendo antes de qualquer acao
    if (-not (Test-ServidorAtivo)) {
        $tray.BalloonTipTitle = "$APP_NAME - Atencao"
        $tray.BalloonTipText  = "O servidor nao esta respondendo.`nAguarde a inicializacao ou use 'Reiniciar servidor'."
        $tray.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Warning
        $tray.ShowBalloonTip(5000)
        return
    }

    # 2) Verifica se ha banco ja configurado e funcionando (avisa mas nao bloqueia)
    $dbOk = $false
    try {
        $r   = Invoke-WebRequest "$ADDR_LOCAL/api/db-status" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        $st  = $r.Content | ConvertFrom-Json
        $dbOk = [bool]$st.ok
    } catch {}

    # Se banco ja esta OK, pede confirmacao antes de trocar
    if ($dbOk) {
        $resp = [System.Windows.Forms.MessageBox]::Show(
            "O banco de dados atual esta conectado e funcionando.`n`nDeseja selecionar um banco diferente mesmo assim?",
            "$APP_NAME - Selecionar banco",
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Question
        )
        if ($resp -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    }

    # 3) Navega ou abre a pagina de selecao de FDB
    $clients = Get-SseClients
    if ($clients -gt 0) {
        try {
            Invoke-WebRequest "$ADDR_LOCAL/api/navigate/selecionar-fdb" -UseBasicParsing -TimeoutSec 2 | Out-Null
        } catch {
            # Fallback: abre nova aba
            try { Start-Process "$ADDR/selecionar-fdb" } catch {}
        }
    } else {
        try {
            Start-Process "$ADDR/selecionar-fdb"
        } catch {
            [System.Windows.Forms.MessageBox]::Show(
                "Nao foi possivel abrir o seletor de banco.`nVerifique se o servidor esta rodando.",
                "$APP_NAME",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Warning
            ) | Out-Null
        }
    }
})) | Out-Null
$subCfg.DropDownItems.Add((New-ItemMenu "Status do banco de dados..." "banco" "#475569" {
    $db = Invoke-Api "/api/db-status" -Timeout 3
    $inf = Invoke-Api "/api/info" -Timeout 3
    if ($null -eq $db) { Show-Mensagem ((L "O servidor n\u00e3o respondeu: ") + $script:ultimoErroApi) "$APP_NAME" "Warning"; return }
    $caminho = ""; try { $caminho = [string]$inf.banco.caminho } catch {}
    $estado = if ($db.ok) { L "Conectado (somente leitura)." } elseif ($db.scanning) { L "Procurando o banco na rede..." } else { (L "Sem conex\u00e3o: ") + [string]$db.erro }
    Show-Mensagem ((L "Banco de dados (Firebird)`n`nEstado: ") + $estado + (L "`nServidor do banco: ") + [string]$db.ip + (L "`nArquivo: ") + $caminho) "$APP_NAME" $(if ($db.ok) { "Information" } else { "Warning" })
})) | Out-Null
$menu.Items.Add($subCfg) | Out-Null

# --- Ferramentas ---
$subFer = New-ItemMenu "Ferramentas" "ferramentas" "#EA580C"
$subFer.DropDownItems.Add((New-ItemMenu "Informa\u00e7\u00f5es do sistema..." "info" "#EA580C" {
    $i = Invoke-Api "/api/info" -Timeout 3
    if ($null -eq $i) { Show-Mensagem ((L "O servidor n\u00e3o respondeu: ") + $script:ultimoErroApi) "$APP_NAME" "Warning"; return }
    $txt = (L "Servidor: ") + $i.servidor + (L "`nGerador: ") + $i.gerador + (L "`nNode.js: ") + $i.node +
           (L "`n`nComputador: ") + $i.computador + (L "`nSistema: ") + $i.sistema +
           (L "`nEndere\u00e7o de acesso: http://") + $i.ip + ":" + $i.porta +
           (L "`n`nLigado h\u00e1: ") + $i.ligadoHa + (L "`nMem\u00f3ria: ") + $i.memoriaMB + " MB" + (L "`nTelas abertas: ") + $i.abasConectadas +
           (L "`n`nPasta: ") + $i.pasta
    Show-Mensagem $txt ("$APP_NAME - " + (L "Informa\u00e7\u00f5es"))
})) | Out-Null
$subFer.DropDownItems.Add((New-ItemMenu "Copiar endere\u00e7o de acesso" "link" "#EA580C" {
    $end = "http://" + (Get-MaquinaIP) + ":" + $PORT
    $ok = $false
    try { [System.Windows.Forms.Clipboard]::SetText($end); $ok = $true } catch { try { Set-Clipboard -Value $end; $ok = $true } catch {} }
    if ($ok) { Show-Balao $APP_NAME ((L "Copiado: ") + $end + (L "`nCole no navegador de qualquer computador ou celular da rede.")) "Info" 3500 }
    else { Show-Mensagem ((L "Endere\u00e7o de acesso:`n") + $end) "$APP_NAME" }
})) | Out-Null
$subFer.DropDownItems.Add((New-Separador)) | Out-Null
$subFer.DropDownItems.Add((New-ItemMenu "Abrir pasta do sistema" "pasta" "#EA580C" { try { Start-Process explorer.exe -ArgumentList "`"$DIR`"" } catch {} })) | Out-Null
$subFer.DropDownItems.Add((New-ItemMenu "Abrir o log (relatorio.log)" "log" "#EA580C" {
    if (-not (Test-Path $LOG_PATH)) { Show-Mensagem (L "O relatorio.log ainda n\u00e3o existe.") "$APP_NAME"; return }
    try { Start-Process notepad.exe -ArgumentList "`"$LOG_PATH`"" } catch {}
})) | Out-Null
$subFer.DropDownItems.Add((New-ItemMenu "Acompanhar o log ao vivo" "aovivo" "#EA580C" {
    $cmd = '$host.UI.RawUI.WindowTitle = ''{1} - log ao vivo''; Get-Content -LiteralPath ''{0}'' -Wait -Tail 80 -Encoding UTF8' -f ($LOG_PATH -replace "'", "''"), ($APP_NAME -replace "'", "''")
    try { Start-Process powershell.exe -ArgumentList @("-NoProfile", "-NoExit", "-Command", $cmd) } catch {}
})) | Out-Null
$subFer.DropDownItems.Add((New-ItemMenu "Cliente da API (api.ps1)" "terminal" "#EA580C" {
    $api = Join-Path $DIR "api.ps1"
    if (-not (Test-Path $api)) { Show-Mensagem (L "api.ps1 n\u00e3o encontrado na pasta do sistema.") "$APP_NAME" "Warning"; return }
    try { Start-Process powershell.exe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit", "-File", "`"$api`"", "-MaquinaIP", "127.0.0.1") } catch {}
})) | Out-Null
$subProg = New-ItemMenu "Programas" "programas" "#EA580C"
$subProg.DropDownItems.Add((New-Object System.Windows.Forms.ToolStripMenuItem((L "Carregando...")))) | Out-Null
$subProg.Add_DropDownOpening({
    $alvo = $this
    $alvo.DropDownItems.Clear()
    $p = Invoke-Api "/api/programas" -Timeout 2
    if ($null -eq $p -or -not $p.programas) {
        $vazio = New-Object System.Windows.Forms.ToolStripMenuItem((L "(servidor sem resposta)")); $vazio.Enabled = $false
        $alvo.DropDownItems.Add($vazio) | Out-Null; return
    }
    foreach ($pg in @($p.programas)) {
        $it = New-Object System.Windows.Forms.ToolStripMenuItem([string]$pg.nome)
        $it.Tag = [string]$pg.nome
        if (-not $pg.existe) { $it.Enabled = $false; $it.Text = [string]$pg.nome + (L "  (arquivo n\u00e3o encontrado)") }
        $it.Add_Click({
            param($s, $e)
            $r = Invoke-Api "/api/programas/abrir" -Metodo POST -Corpo @{ nome = [string]$s.Tag } -Timeout 5
            if ($null -eq $r) { Show-Balao $APP_NAME ((L "N\u00e3o abriu: ") + $script:ultimoErroApi) "Warning" }
        })
        $alvo.DropDownItems.Add($it) | Out-Null
    }
    $dica = New-Object System.Windows.Forms.ToolStripMenuItem((L "Para incluir programas: lista \u201cprogramas\u201d no config.json"))
    $dica.Enabled = $false
    $alvo.DropDownItems.Add((New-Separador)) | Out-Null
    $alvo.DropDownItems.Add($dica) | Out-Null
})
$subFer.DropDownItems.Add($subProg) | Out-Null
$menu.Items.Add($subFer) | Out-Null
$menu.Items.Add((New-Separador)) | Out-Null

# --- Servidor ---
$menu.Items.Add((New-ItemMenu "Reiniciar servidor" "reiniciar" "#D97706" {
    Write-TrayLog "Reinicio manual solicitado pelo usuario via bandeja."
    # 1) Encerra o servidor de forma ordenada (log + aviso nas telas abertas)
    #    e, so' se ele nao responder, mata a arvore do PID que o tray lancou
    #    (taskkill /F /T /PID - nunca "todo node.exe" da maquina).
    $comoParou = Stop-ServidorOrdenado -Reiniciar
    Write-TrayLog "Servidor parado para reinicio ($comoParou)."
    $script:nodeProc = $null

    # 2) Aguarda a porta ficar livre (ate 10s) antes de relancar
    $esperaPorta = 0
    while (-not (Test-PortaLivre -Porta $PORT) -and $esperaPorta -lt 20) {
        Start-Sleep -Milliseconds 500
        $esperaPorta++
    }

    # 3) Relanca o servidor via tray
    $reiniciouOk = $false
    try {
        $script:nodeProc = [System.Diagnostics.Process]::Start($psi)
        # Confere que o processo NAO morreu logo em seguida (ex.: porta ainda
        # ocupada por um servidor que nao respondeu ao encerramento -> EADDRINUSE).
        # Antes bastava o Start retornar algo para o balao dizer "sucesso".
        if ($null -ne $script:nodeProc) {
            Start-Sleep -Milliseconds 2000
            $reiniciouOk = -not $script:nodeProc.HasExited
            if (-not $reiniciouOk) {
                Write-TrayLog "Servidor relancado encerrou logo em seguida (codigo $($script:nodeProc.ExitCode)) - porta $PORT ainda ocupada?" "ERRO"
            }
        }
    } catch {
        Write-TrayLog "Falha ao relancar o servidor: $($_.Exception.Message)" "ERRO"
    }

    if ($reiniciouOk) {
        Write-TrayLog "Servidor reiniciado manualmente com sucesso (novo PID: $($script:nodeProc.Id))."
        $tray.BalloonTipTitle = $APP_NAME
        $tray.BalloonTipText  = "Servidor reiniciado com sucesso!"
        $tray.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Info
        $tray.ShowBalloonTip(3000)
    } else {
        Write-TrayLog "Falha ao reiniciar o servidor apos clique manual." "ERRO"
        $tray.BalloonTipTitle = "$APP_NAME - Erro"
        $tray.BalloonTipText  = "Falha ao reiniciar o servidor.`nVerifique se o Node.js esta instalado."
        $tray.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Error
        $tray.ShowBalloonTip(5000)
    }
})) | Out-Null
$menu.Items.Add((New-ItemMenu "Sair" "sair" "#DC2626" {
    Write-TrayLog "Encerramento solicitado pelo usuario via bandeja."
    $watchTimer.Stop()   # impede o watchdog de relancar o servidor durante o encerramento
    $tray.Visible = $false
    $comoParou = Stop-ServidorOrdenado
    Write-TrayLog "Servidor encerrado pela bandeja ($comoParou). Bandeja finalizada."
    $script:nodeProc = $null
    # Mensagem clara: antes o icone so' sumia, sem confirmar nada.
    [System.Windows.Forms.MessageBox]::Show(
        "O servidor de relatorios foi encerrado.`n`nOs relatorios abertos no navegador mostram o aviso 'Servidor encerrado' e voltam sozinhos quando o servidor for iniciado de novo.`n`nPara iniciar novamente: abra gerar_relatorio_do_dia.bat ou reinicie o computador.",
        "$APP_NAME - Servidor encerrado",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
    try { $mutex.ReleaseMutex() } catch {}
    [System.Windows.Forms.Application]::Exit()
})) | Out-Null

$tray.ContextMenuStrip = $menu
$tray.Add_DoubleClick({ Open-Relatorio "/" })

# ---------------------------------------------------------------------------
# Timer 1: Reinicia node se cair (verifica processo E porta) OU se travar
# (processo vivo mas sem responder ao HTTP por 3 verificacoes seguidas ~30s).
# ROBUSTEZ FIX: a versao anterior so' detectava PROCESSO MORTO (HasExited).
# Um processo travado (deadlock, loop infinito no event loop do Node) fica
# "vivo" para o Windows para sempre e nunca era reiniciado automaticamente.
# Exige 3 falhas consecutivas (nao 1) antes de agir, para nao reiniciar por
# causa de uma lentidao pontual (ex: geracao de relatorio de periodo longo).
# ---------------------------------------------------------------------------
$script:falhasConsecutivas = 0
$watchTimer = New-Object System.Windows.Forms.Timer
$watchTimer.Interval = 10000
$watchTimer.Add_Tick({
    try {
        $procMorreu = ($null -eq $script:nodeProc -or $script:nodeProc.HasExited)
        if ($procMorreu) {
            $script:falhasConsecutivas = 0
            $portaLivre = Test-PortaLivre -Porta $PORT
            if ($portaLivre) {
                Write-TrayLog "Processo do servidor nao esta mais ativo - reiniciando automaticamente." "AVISO"
                $script:nodeProc = [System.Diagnostics.Process]::Start($psi)
                $tray.BalloonTipTitle = $APP_NAME
                $tray.BalloonTipText  = "Servidor reiniciado automaticamente."
                $tray.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Warning
                $tray.ShowBalloonTip(2500)
            } else {
                $script:nodeProc = $null
            }
            return
        }

        # Processo "vivo" segundo o SO - confirma que esta REALMENTE respondendo.
        if (Test-ServidorAtivo) {
            $script:falhasConsecutivas = 0
        } else {
            $script:falhasConsecutivas++
            if ($script:falhasConsecutivas -ge 3) {
                Write-TrayLog "Servidor nao responde ha ~30s (processo vivo, porem travado) - forcando reinicio." "ERRO"
                $pidTravado = $script:nodeProc.Id
                try { Start-Process -FilePath "taskkill.exe" -ArgumentList "/F","/T","/PID","$pidTravado" -WindowStyle Hidden -Wait -ErrorAction Stop } catch {}
                $script:nodeProc = $null
                $script:falhasConsecutivas = 0
                $tray.BalloonTipTitle = "$APP_NAME - Atencao"
                $tray.BalloonTipText  = "Servidor parou de responder e foi reiniciado automaticamente."
                $tray.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Warning
                $tray.ShowBalloonTip(4000)
            }
        }
    } catch {}
})
$watchTimer.Start()

# ---------------------------------------------------------------------------
# Timer 2: Verifica status do banco (uma vez apos 20s)
# ---------------------------------------------------------------------------
$script:dbChecked = $false
$dbTimer = New-Object System.Windows.Forms.Timer
$dbTimer.Interval = 20000
$dbTimer.Add_Tick({
    if ($script:dbChecked) { $dbTimer.Stop(); return }
    $script:dbChecked = $true
    $dbTimer.Stop()
    try {
        $r  = Invoke-WebRequest "$ADDR_LOCAL/api/db-status" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
        $st = $r.Content | ConvertFrom-Json
        if ($st.scanCompleto -and -not $st.ok) {
            Write-TrayLog "Banco de dados inacessivel na checagem inicial: $($st.erro)" "ERRO"
            $tray.BalloonTipTitle = "$APP_NAME - Atencao!"
            $tray.BalloonTipText  = "Nao foi possivel conectar ao banco!`n$($st.erro)`nVerifique se o servidor esta ligado."
            $tray.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Error
            $tray.ShowBalloonTip(10000)
        }
    } catch {}
})
$dbTimer.Start()

# ---------------------------------------------------------------------------
# Notificacao inicial
# ---------------------------------------------------------------------------
$tray.BalloonTipTitle = $APP_NAME
if ($MAQUINA_IP) {
    $tray.BalloonTipText = "Servidor iniciado!`nAcesso externo: http://${MAQUINA_IP}:${PORT}`nDuplo clique para abrir."
} else {
    $tray.BalloonTipText = "Servidor iniciado! Duplo clique para abrir."
}
$tray.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Info
$tray.ShowBalloonTip(3500)

# ---------------------------------------------------------------------------
# Loop de mensagens Windows
# ---------------------------------------------------------------------------
[System.Windows.Forms.Application]::Run()

$watchTimer.Stop(); $dbTimer.Stop()
$tray.Visible = $false; $tray.Dispose()
try { $mutex.ReleaseMutex() } catch {}