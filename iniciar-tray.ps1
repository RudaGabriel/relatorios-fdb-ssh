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

$APP_NAME = "Relatorios"
$PORT     = 7734

try {
    if (Test-Path $cfgPath) {
        $cfg = Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($cfg.appName -and $cfg.appName -ne "") { $APP_NAME = $cfg.appName }
        if ($cfg.porta   -and $cfg.porta   -gt 0)  { $PORT = [int]$cfg.porta }
    }
} catch {}

$ADDR = "http://localhost:$PORT"

# ---------------------------------------------------------------------------
# Funcao: Abre relatorio — foca aba existente se possivel
# ---------------------------------------------------------------------------
function Open-Relatorio {
    param([string]$UrlPath = "/")
    # Verifica quantas abas SSE estao abertas
    $clients = 0
    try {
        $r = Invoke-WebRequest "$ADDR/api/sse-clients" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        $j = $r.Content | ConvertFrom-Json
        $clients = [int]$j.clients
    } catch { $clients = 0 }

    if ($clients -gt 0) {
        # Ha aba aberta — navega ela em vez de abrir nova
        if ($UrlPath -eq "/") {
            try { Invoke-WebRequest "$ADDR/api/navigate/hoje" -UseBasicParsing -TimeoutSec 2 | Out-Null } catch {}
        } else {
            # Para /periodo?i=D1&f=D2 passado como path bruto, abre mesmo assim
            try { Start-Process ($ADDR + $UrlPath) } catch {}
        }
    } else {
        # Nenhuma aba — abre nova
        try { Start-Process ($ADDR + $UrlPath) } catch {}
    }
}

# ---------------------------------------------------------------------------
# Inicia o servidor Node.js
# ---------------------------------------------------------------------------
$serverScript = Join-Path $DIR "servidor-relatorio.js"

# Aguarda o script e dependências ficarem acessíveis (rede pode estar mapeando no boot)
# Tenta a cada 15 segundos por até 30 minutos (120 tentativas)
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

# Função auxiliar: testa se a porta já está em uso
function Test-PortaLivre {
    param([int]$Porta)
    try {
        $tc = New-Object Net.Sockets.TcpClient
        $tc.Connect("127.0.0.1", $Porta)
        $tc.Close()
        return $false  # porta ocupada (servidor já rodando)
    } catch {
        return $true   # porta livre
    }
}

$script:nodeProc = $null

if (Test-PortaLivre -Porta $PORT) {
    # Porta livre — inicia o Node normalmente
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
} else {
    # Servidor já rodando nessa porta (iniciado por outra instância)
    # O tray mostra o ícone normalmente e gerencia o processo existente
    # nodeProc permanece null; o watchTimer só reinicia se a porta também parar de responder
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

$itemAbrir = New-Object System.Windows.Forms.ToolStripMenuItem
$itemAbrir.Text = "Abrir Relatorio"
$itemAbrir.Font = New-Object System.Drawing.Font($menu.Font.FontFamily, $menu.Font.Size, [System.Drawing.FontStyle]::Bold)
$itemAbrir.Add_Click({ Open-Relatorio "/" })
$menu.Items.Add($itemAbrir) | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$itemAtualizar = New-Object System.Windows.Forms.ToolStripMenuItem
$itemAtualizar.Text = "Atualizar dados de hoje"
$itemAtualizar.Add_Click({ Start-Process "$ADDR/atualizar" })
$menu.Items.Add($itemAtualizar) | Out-Null

$itemPeriodo = New-Object System.Windows.Forms.ToolStripMenuItem
$itemPeriodo.Text = "Gerar por periodo..."
$itemPeriodo.Add_Click({ Start-Process "$ADDR/periodo" })
$menu.Items.Add($itemPeriodo) | Out-Null

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$itemEditarCfg = New-Object System.Windows.Forms.ToolStripMenuItem
$itemEditarCfg.Text = "Editar configuracoes..."
$itemEditarCfg.Add_Click({
    # Verifica se ha aba aberta com SSE — se sim, abre o modal inline (navigate-hash)
    $clients = 0
    try {
        $r = Invoke-WebRequest "$ADDR/api/sse-clients" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        $j = $r.Content | ConvertFrom-Json
        $clients = [int]$j.clients
    } catch { $clients = 0 }

    if ($clients -gt 0) {
        # Ha aba aberta — dispara o modal de configuracoes via SSE
        try {
            Invoke-WebRequest "$ADDR/api/navigate/config" -UseBasicParsing -TimeoutSec 2 | Out-Null
        } catch {}
    } else {
        # Sem aba aberta — abre browser na pagina /config
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

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

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
            # Confirma que a porta também parou antes de reiniciar
            # (evita reinício em loop quando servidor externo ocupa a porta)
            $portaLivre = Test-PortaLivre -Porta $PORT
            if ($portaLivre) {
                $script:nodeProc = [System.Diagnostics.Process]::Start($psi)
                $tray.BalloonTipTitle = $APP_NAME
                $tray.BalloonTipText  = "Servidor reiniciado automaticamente."
                $tray.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Warning
                $tray.ShowBalloonTip(2500)
            } else {
                # Porta ocupada por outra instância — adota o processo existente
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
        $r  = Invoke-WebRequest "$ADDR/api/db-status" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
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
$tray.BalloonTipText  = "Servidor iniciado! Duplo clique para abrir."
$tray.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Info
$tray.ShowBalloonTip(3500)

# ---------------------------------------------------------------------------
# Loop de mensagens Windows
# ---------------------------------------------------------------------------
[System.Windows.Forms.Application]::Run()

$watchTimer.Stop(); $dbTimer.Stop()
$tray.Visible = $false; $tray.Dispose()
try { $mutex.ReleaseMutex() } catch {}