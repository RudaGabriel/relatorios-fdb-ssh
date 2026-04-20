# iniciar-tray.ps1
# Servidor em background + icone na bandeja do sistema.
# Instancia unica via mutex global.
# Abrir Relatorio: se ja tem aba aberta (SSE), foca ela. Se nao, abre browser.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'SilentlyContinue'

# ---------------------------------------------------------------------------
# Instancia unica via mutex
# ---------------------------------------------------------------------------
$mutexName = "Global\RelatoriosTray_7734"
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
$acquired = $false
try { $acquired = $mutex.WaitOne(0) } catch { $acquired = $false }
if (-not $acquired) { exit 0 }

# ---------------------------------------------------------------------------
# Le config.json
# ---------------------------------------------------------------------------
$DIR     = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfgPath = Join-Path $DIR "config.json"

$APP_NAME  = "Relatorios"
$PORT      = 7734
$MAQUINA_IP = $null

try {
    if (Test-Path $cfgPath) {
        $raw = [System.IO.File]::ReadAllText($cfgPath, [System.Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
        $cfg = $raw | ConvertFrom-Json
        if ($cfg.appName   -and $cfg.appName   -ne "") { $APP_NAME   = $cfg.appName }
        if ($cfg.porta     -and $cfg.porta      -gt 0)  { $PORT       = [int]$cfg.porta }
        if ($cfg.maquinaIP -and $cfg.maquinaIP  -ne "") { $MAQUINA_IP = $cfg.maquinaIP.Trim() }
    }
} catch {}

# $ADDR      → usado em Start-Process (abre no browser)
# $ADDR_LOCAL → usado em Invoke-WebRequest (sempre IPv4 127.0.0.1, nunca falha por ::1)
$ADDR       = "http://localhost:$PORT"
$ADDR_LOCAL = "http://127.0.0.1:$PORT"

# ---------------------------------------------------------------------------
# Funcao: Abre relatorio — foca aba existente se possivel
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

# Aguarda o script e dependencias ficarem acessiveis (rede pode estar mapeando no boot)
$maxTentativas = 120
$tentativa     = 0
while (-not (Test-Path $serverScript) -and $tentativa -lt $maxTentativas) {
    $tentativa++
    Start-Sleep -Seconds 15
}

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName        = "node"
$psi.Arguments       = "`"$serverScript`" --user SYSDBA --pass masterkey --no-browser"
$psi.WindowStyle     = [System.Diagnostics.ProcessWindowStyle]::Hidden
$psi.CreateNoWindow  = $true
$psi.UseShellExecute = $false

# Testa se a porta ja esta em uso
function Test-PortaLivre {
    param([int]$Porta)
    try {
        $tc = New-Object Net.Sockets.TcpClient
        $tc.Connect("127.0.0.1", $Porta)
        $tc.Close()
        return $false  # porta ocupada
    } catch {
        return $true   # porta livre
    }
}

$script:nodeProc = $null

if (Test-PortaLivre -Porta $PORT) {
    try {
        $script:nodeProc = [System.Diagnostics.Process]::Start($psi)
    } catch {
        [System.Windows.Forms.MessageBox]::Show(
            "Nao foi possivel iniciar o servidor.`nVerifique se o Node.js esta instalado.",
            "$APP_NAME - Erro",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
        try { $mutex.ReleaseMutex() } catch {}
        exit 1
    }
}

# ---------------------------------------------------------------------------
# Aguarda o servidor ficar disponivel (ate 30s) antes de continuar
# (necessario para que o maquinaIP seja salvo pelo servidor antes de ler)
# ---------------------------------------------------------------------------
$_espera = 0
while ($_espera -lt 30) {
    if (-not (Test-PortaLivre -Porta $PORT)) { break }
    Start-Sleep -Milliseconds 500
    $_espera++
}

# Tenta reler maquinaIP do config (o servidor grava na inicializacao)
if (-not $MAQUINA_IP) {
    try {
        if (Test-Path $cfgPath) {
            $raw2 = [System.IO.File]::ReadAllText($cfgPath, [System.Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
            $cfg2 = $raw2 | ConvertFrom-Json
            if ($cfg2.maquinaIP -and $cfg2.maquinaIP -ne "") {
                $MAQUINA_IP = $cfg2.maquinaIP.Trim()
            }
        }
    } catch {}
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
        $tray.Icon = [System.Drawing.Icon]::FromHandle($resized.GetHicon())
        $bmp.Dispose()
    } catch { $tray.Icon = [System.Drawing.SystemIcons]::Application }
} else {
    $tray.Icon = [System.Drawing.SystemIcons]::Application
}

# ---------------------------------------------------------------------------
# Menu de contexto
# ---------------------------------------------------------------------------
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$menu.RenderMode = [System.Windows.Forms.ToolStripRenderMode]::System

# --- Abrir Relatorio (negrito) ---
$itemAbrir = New-Object System.Windows.Forms.ToolStripMenuItem
$itemAbrir.Text = "Abrir Relatorio"
$itemAbrir.Font = New-Object System.Drawing.Font($menu.Font.FontFamily, $menu.Font.Size, [System.Drawing.FontStyle]::Bold)
$itemAbrir.Add_Click({ Open-Relatorio "/" })
$menu.Items.Add($itemAbrir) | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

# --- Atualizar dados de hoje ---
$itemAtualizar = New-Object System.Windows.Forms.ToolStripMenuItem
$itemAtualizar.Text = "Atualizar dados de hoje"
$itemAtualizar.Add_Click({ Start-Process "$ADDR/atualizar" })
$menu.Items.Add($itemAtualizar) | Out-Null

# --- Gerar por periodo ---
$itemPeriodo = New-Object System.Windows.Forms.ToolStripMenuItem
$itemPeriodo.Text = "Gerar por periodo..."
$itemPeriodo.Add_Click({ Start-Process "$ADDR/periodo" })
$menu.Items.Add($itemPeriodo) | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

# --- Editar configuracoes ---
$itemEditarCfg = New-Object System.Windows.Forms.ToolStripMenuItem
$itemEditarCfg.Text = "Editar configuracoes..."
$itemEditarCfg.Add_Click({
    $clients = Get-SseClients
    if ($clients -gt 0) {
        try {
            Invoke-WebRequest "$ADDR_LOCAL/api/navigate/config" -UseBasicParsing -TimeoutSec 2 | Out-Null
        } catch {}
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
})
$menu.Items.Add($itemEditarCfg) | Out-Null

# --- Selecionar banco (FDB)... ---
$itemFdb = New-Object System.Windows.Forms.ToolStripMenuItem
$itemFdb.Text = "Selecionar banco (FDB)..."
$itemFdb.Add_Click({
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
})
$menu.Items.Add($itemFdb) | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

# --- Reiniciar servidor ---
$itemReiniciar = New-Object System.Windows.Forms.ToolStripMenuItem
$itemReiniciar.Text = "Reiniciar servidor"
$itemReiniciar.Add_Click({
    try {
        if ($script:nodeProc -and -not $script:nodeProc.HasExited) {
            $script:nodeProc.Kill()
            $script:nodeProc.WaitForExit(3000)
        }
    } catch {}
    $reiniciouOk = $false
    try {
        $script:nodeProc = [System.Diagnostics.Process]::Start($psi)
        $reiniciouOk = $true
    } catch {}
    if ($reiniciouOk) {
        $tray.BalloonTipTitle = $APP_NAME
        $tray.BalloonTipText  = "Servidor reiniciado com sucesso!"
        $tray.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Info
        $tray.ShowBalloonTip(3000)
    } else {
        $tray.BalloonTipTitle = "$APP_NAME - Erro"
        $tray.BalloonTipText  = "Falha ao reiniciar o servidor."
        $tray.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Error
        $tray.ShowBalloonTip(5000)
    }
})
$menu.Items.Add($itemReiniciar) | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

# --- Sair ---
$itemSair = New-Object System.Windows.Forms.ToolStripMenuItem
$itemSair.Text = "Sair"
$itemSair.Add_Click({
    $tray.Visible = $false
    try { if ($script:nodeProc -and -not $script:nodeProc.HasExited) { $script:nodeProc.Kill() } } catch {}
    try { $mutex.ReleaseMutex() } catch {}
    [System.Windows.Forms.Application]::Exit()
})
$menu.Items.Add($itemSair) | Out-Null

$tray.ContextMenuStrip = $menu
$tray.Add_DoubleClick({ Open-Relatorio "/" })

# ---------------------------------------------------------------------------
# Timer 1: Reinicia node se cair (verifica processo E porta)
# ---------------------------------------------------------------------------
$watchTimer = New-Object System.Windows.Forms.Timer
$watchTimer.Interval = 10000
$watchTimer.Add_Tick({
    try {
        $procMorreu = ($null -eq $script:nodeProc -or $script:nodeProc.HasExited)
        if ($procMorreu) {
            $portaLivre = Test-PortaLivre -Porta $PORT
            if ($portaLivre) {
                $script:nodeProc = [System.Diagnostics.Process]::Start($psi)
                $tray.BalloonTipTitle = $APP_NAME
                $tray.BalloonTipText  = "Servidor reiniciado automaticamente."
                $tray.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Warning
                $tray.ShowBalloonTip(2500)
            } else {
                $script:nodeProc = $null
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