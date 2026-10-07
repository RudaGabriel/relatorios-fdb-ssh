# =============================================================================
# _remover-inicializacao.ps1                                          v1.0.1
# Autor: Ruda Gabriel
# -----------------------------------------------------------------------------
# Auxiliar do remover-inicializacao.bat (nao precisa ser executado direto).
# Desfaz TUDO o que faz o sistema iniciar sozinho no logon:
#   - tarefas agendadas que chamam o bootstrap/launcher/tray/servidor
#     (qualquer nome - inclusive de versoes antigas ou de outro appName);
#   - atalhos/scripts nas pastas Inicializar (do usuario e de todos);
#   - valores nas chaves Run do registro (HKCU e HKLM) que apontem para o
#     sistema;
#   - a pasta %LOCALAPPDATA%\RelatoriosBootstrap (bootstrap.vbs e
#     launcher.path), apagando so' esses arquivos, por nome;
#   - bootstrap.vbs/launcher.vbs que estejam AGUARDANDO a rede para subir o
#     servidor (sem isso o servidor subiria ate 30 min depois da remocao).
# Com -MatarProcessos tambem encerra o servidor (primeiro de forma ordenada,
# pela /api/encerrar, para registrar no log e avisar as telas abertas), o
# icone da bandeja e geracoes de relatorio em andamento.
#
# Nao mexe em config.json, relatorio.log, cache, nem na regra de firewall
# (a regra nao inicia nada e e' necessaria para os outros computadores da
# rede caso o servidor volte a ser iniciado manualmente).
#
# Seguranca contra falso positivo: so' considera processos node/powershell/
# pwsh/wscript/cscript cuja LINHA DE COMANDO cite arquivos do sistema - um
# editor com servidor-relatorio.js aberto, por exemplo, nunca e' encerrado.
#
# Sem Administrador, o que exigir privilegio (tarefa criada pela instalacao
# elevada, itens de todos os usuarios, processos de outra sessao) falha;
# nesse caso pede elevacao (UAC) uma unica vez e refaz SO' essa parte, a
# partir de uma copia em %TEMP% (a pasta do sistema pode estar numa unidade
# de rede mapeada, que a sessao elevada nao enxerga).
#
# Codigo de saida: 0 = tudo removido/encerrado, 1 = sobrou algo (listado).
#
# CHANGELOG 1.0.1 - 2026-10-07 22:30 - Data e hora do log do MESMO instante.
# CHANGELOG 1.0.0 - 2026-10-06 10:00 - Primeira versao.
# =============================================================================

param(
    [switch]$MatarProcessos,
    # Usuario = instancia normal (faz tudo). Maquina = instancia elevada
    # (refaz so' o que depende de Administrador).
    [ValidateSet('Usuario', 'Maquina')]
    [string]$Escopo = 'Usuario',
    # So' na instancia elevada: arquivo JSON com os parametros da original.
    [string]$ParamsFile = ''
)

$ErrorActionPreference = 'Continue'

$NOMES_PROC    = @('node.exe', 'powershell.exe', 'pwsh.exe', 'wscript.exe', 'cscript.exe')

$script:Removidos = New-Object System.Collections.ArrayList
$script:Falhas    = New-Object System.Collections.ArrayList
# Falhas em itens do PERFIL do usuario: a instancia elevada nao as refaz
# (pode ser outra conta), entao continuam valendo depois da elevacao.
$script:FalhasUsuario = New-Object System.Collections.ArrayList
$script:EtapaUsuario  = $false
$script:TrayEncerrado = $false

# ---------------------------------------------------------------------------
# Parametros: na instancia original vem do config.json; na elevada, do
# arquivo JSON gravado pela original.
# ---------------------------------------------------------------------------
$DIR        = Split-Path -Parent $MyInvocation.MyCommand.Path
$PASTA_PROJ = $DIR
$APP_NAME   = ''
$PORTA      = 7734
$LOG_PATH   = Join-Path $DIR 'relatorio.log'
$RESULT_PATH = ''

function Get-PortaValida($valor) {
    $p = 0
    if ([int]::TryParse([string]$valor, [ref]$p) -and $p -ge 1 -and $p -le 65535) { return $p }
    return 7734
}

if ($Escopo -eq 'Maquina') {
    try {
        $prm = [System.IO.File]::ReadAllText($ParamsFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
        $APP_NAME       = [string]$prm.appName
        $PORTA          = Get-PortaValida $prm.porta
        $LOG_PATH       = [string]$prm.logPath
        $RESULT_PATH    = [string]$prm.resultPath
        $MatarProcessos = [bool]$prm.matar
        $PASTA_PROJ     = [string]$prm.pastaProjeto
    } catch {
        Write-Host "ERRO: parametros da instancia elevada ilegiveis: $($_.Exception.Message)"
        exit 1
    }
} else {
    try {
        $raw = [System.IO.File]::ReadAllText((Join-Path $DIR 'config.json'), [System.Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
        $cfg = $raw | ConvertFrom-Json
        if ($cfg.appName) { $APP_NAME = ([string]$cfg.appName).Trim() }
        $PORTA = Get-PortaValida $cfg.porta
    } catch {}
    # Pasta sem permissao de escrita (rede somente leitura): log em %TEMP%.
    try { Add-Content -Path $LOG_PATH -Value $null -ErrorAction Stop } catch { $LOG_PATH = Join-Path $env:TEMP 'relatorio-remover.log' }
}
if (-not $APP_NAME) { $APP_NAME = 'Relatorios' }

# "launcher.vbs" e' nome generico (outro programa pode ter um): so' conta o
# DESTA pasta. Os demais nomes sao exclusivos do sistema.
$LAUNCHER_RX = [regex]::Escape((Join-Path $PASTA_PROJ 'launcher.vbs'))
# Linha de comando de processos: casa com arquivos do sistema.
$PADRAO_PROC   = "servidor-relatorio\.js|gerar-relatorio-html\.js|iniciar-tray\.ps1|RelatoriosBootstrap|$LAUNCHER_RX"
# Itens de inicializacao (tarefa, atalho, registro): a cadeia de
# inicializacao e os pontos de entrada que alguem possa ter posto ali.
$PADRAO_INICIO = "RelatoriosBootstrap|iniciar-tray\.ps1|servidor-relatorio\.js|gerar-relatorio-html\.js|gerar_relatorio_(do_dia|por_data|intervalo)\.bat|$LAUNCHER_RX"

function Write-RemLog([string]$Msg) {
    try {
        $agora = Get-Date
        $linha = "[{0:dd-MM-yyyy}] [{0:HH:mm:ss}] [REMOVER] {1}" -f $agora, $Msg
        Add-Content -Path $LOG_PATH -Value $linha -Encoding UTF8 -ErrorAction SilentlyContinue
    } catch {}
}
function Add-Removido([string]$Texto) {
    [void]$script:Removidos.Add($Texto)
    Write-Host "  [OK] $Texto" -ForegroundColor Green
    Write-RemLog "Removido: $Texto"
}
function Add-Falha([string]$Texto) {
    [void]$script:Falhas.Add($Texto)
    if ($script:EtapaUsuario) { [void]$script:FalhasUsuario.Add($Texto) }
    Write-Host "  [FALHA] $Texto" -ForegroundColor Yellow
    Write-RemLog "FALHA: $Texto"
}

function Test-Admin {
    try {
        $id = [Security.Principal.WindowsIdentity]::GetCurrent()
        return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch { return $false }
}

# ---------------------------------------------------------------------------
# PROCESSOS
# ---------------------------------------------------------------------------
function Get-ProcessosRelatorio([string[]]$Nomes) {
    $lista = $null
    try { $lista = Get-CimInstance Win32_Process -ErrorAction Stop }
    catch { try { $lista = Get-WmiObject Win32_Process -ErrorAction Stop } catch { $lista = @() } }
    # Exclui $PID: esta propria instancia nunca se auto-encerra, qualquer
    # que seja a linha de comando com que foi chamada.
    return @($lista | Where-Object {
        $_.ProcessId -ne $PID -and
        ($Nomes -contains ([string]$_.Name).ToLower()) -and
        ([string]$_.CommandLine) -match $PADRAO_PROC
    })
}

function Stop-ProcessoRelatorio($Proc) {
    $desc = "processo $($Proc.Name) PID $($Proc.ProcessId) ($(Get-DescricaoProc $Proc))"
    try {
        Stop-Process -Id $Proc.ProcessId -Force -ErrorAction Stop
        Add-Removido "encerrado $desc"
    } catch {
        # Ja terminou sozinho entre a listagem e o kill: nao e' falha.
        if (-not (Get-Process -Id $Proc.ProcessId -ErrorAction SilentlyContinue)) { Add-Removido "encerrado $desc"; return }
        Add-Falha "nao foi possivel encerrar $desc - $($_.Exception.Message)"
    }
}

function Get-DescricaoProc($Proc) {
    $cl = [string]$Proc.CommandLine
    if ($cl -match 'servidor-relatorio\.js')     { return 'servidor' }
    if ($cl -match 'gerar-relatorio-html\.js')   { return 'geracao de relatorio' }
    if ($cl -match 'iniciar-tray\.ps1')          { return 'icone da bandeja' }
    if ($cl -match 'RelatoriosBootstrap')        { return 'bootstrap aguardando a rede' }
    if ($cl -match 'launcher\.vbs')              { return 'launcher' }
    return 'relatorio'
}

function Stop-ProcessosRelatorio {
    Write-Host ''
    Write-Host 'Encerrando processos do relatorio...' -ForegroundColor Cyan

    # 1) Bootstrap/launcher primeiro: senao relancam o tray no meio do caminho.
    foreach ($p in (Get-ProcessosRelatorio @('wscript.exe', 'cscript.exe'))) { Stop-ProcessoRelatorio $p }

    # 2) Encerramento ordenado do servidor: registra no relatorio.log e
    #    mostra "Servidor encerrado" nas telas abertas. Feito ANTES de matar
    #    o tray para nao deixar o watchdog dele religar o servidor sem tray.
    $servidores = Get-ProcessosRelatorio @('node.exe') | Where-Object { ([string]$_.CommandLine) -match 'servidor-relatorio\.js' }
    if (@($servidores).Count -gt 0) {
        try {
            Invoke-WebRequest "http://127.0.0.1:$PORTA/api/encerrar?origem=remover-inicializacao" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop | Out-Null
            Write-Host '  Servidor recebeu o pedido de encerramento ordenado.'
            Write-RemLog 'Pedido de encerramento ordenado enviado ao servidor.'
        } catch {
            Write-Host '  Servidor nao respondeu ao encerramento ordenado - sera forcado.'
            Write-RemLog "Encerramento ordenado sem resposta: $($_.Exception.Message)"
        }
    }

    # 3) Icone da bandeja (powershell/pwsh rodando iniciar-tray.ps1).
    foreach ($p in (Get-ProcessosRelatorio @('powershell.exe', 'pwsh.exe'))) { Stop-ProcessoRelatorio $p; $script:TrayEncerrado = $true }

    # 4) Espera ate 6 s o servidor sair sozinho (ordenado) antes de forcar.
    $limite = (Get-Date).AddSeconds(6)
    while ((Get-Date) -lt $limite -and @(Get-ProcessosRelatorio @('node.exe')).Count -gt 0) { Start-Sleep -Milliseconds 500 }

    # 5) O que sobrou (servidor travado, geracao em andamento, tray que o
    #    watchdog tenha religado nesse meio-tempo) e' forcado.
    foreach ($p in (Get-ProcessosRelatorio $NOMES_PROC)) { Stop-ProcessoRelatorio $p }

    Start-Sleep -Milliseconds 500
    $restantes = @(Get-ProcessosRelatorio $NOMES_PROC)
    foreach ($p in $restantes) { Add-Falha "processo continua em execucao: $($p.Name) PID $($p.ProcessId) ($(Get-DescricaoProc $p))" }
    if (@($servidores).Count -eq 0 -and $restantes.Count -eq 0 -and $script:Removidos.Count -eq 0) {
        Write-Host '  Nenhum processo do relatorio estava em execucao.'
    }
}

# So' bootstrap/launcher aguardando a rede (sem matar servidor nem tray).
function Stop-BootstrapAguardando {
    $lista = @(Get-ProcessosRelatorio @('wscript.exe', 'cscript.exe'))
    if ($lista.Count -eq 0) { return }
    Write-Host ''
    Write-Host 'Encerrando inicializacao automatica em andamento...' -ForegroundColor Cyan
    foreach ($p in $lista) { Stop-ProcessoRelatorio $p }
}

# ---------------------------------------------------------------------------
# TAREFAS AGENDADAS
# ---------------------------------------------------------------------------
function Remove-TarefasAgendadas {
    Write-Host ''
    Write-Host 'Tarefas agendadas...' -ForegroundColor Cyan
    $achou = $false
    $tarefas = $null
    try { $tarefas = @(Get-ScheduledTask -ErrorAction Stop) } catch { $tarefas = $null }

    if ($null -ne $tarefas) {
        foreach ($t in $tarefas) {
            $acoes = @($t.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' '
            if ($acoes -notmatch $PADRAO_INICIO) { continue }
            $achou = $true
            $nome = "$($t.TaskPath)$($t.TaskName)"
            try {
                Unregister-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath -Confirm:$false -ErrorAction Stop
                Add-Removido "tarefa agendada '$nome'"
            } catch {
                Add-Falha "tarefa agendada '$nome' - $($_.Exception.Message)"
            }
        }
    }

    # Complemento/fallback (Windows sem o modulo ScheduledTasks, ou tarefa
    # que esta conta nao consegue LER mas talvez consiga apagar): os nomes
    # que o instalador usa, com e sem espacos (versoes antigas).
    $nomes = @("$APP_NAME - Relatorios", "$($APP_NAME -replace ' ', '') - Relatorios") | Select-Object -Unique
    foreach ($n in $nomes) {
        & schtasks.exe /query /tn "$n" *> $null
        if ($LASTEXITCODE -ne 0) { continue }
        $achou = $true
        & schtasks.exe /delete /tn "$n" /f *> $null
        if ($LASTEXITCODE -eq 0) { Add-Removido "tarefa agendada '$n'" }
        else { Add-Falha "tarefa agendada '$n' - schtasks recusou (acesso negado?)" }
    }
    if (-not $achou) { Write-Host '  Nenhuma tarefa agendada do relatorio.' }
}

# ---------------------------------------------------------------------------
# PASTAS INICIALIZAR (Startup)
# ---------------------------------------------------------------------------
function Get-AlvoArquivo([System.IO.FileInfo]$Arq) {
    $ext = $Arq.Extension.ToLower()
    if ($ext -eq '.lnk') {
        try {
            $sh = New-Object -ComObject WScript.Shell
            $lnk = $sh.CreateShortcut($Arq.FullName)
            return "$($lnk.TargetPath) $($lnk.Arguments) $($lnk.WorkingDirectory)"
        } catch { return '' }
    }
    if (@('.vbs', '.vbe', '.bat', '.cmd', '.js', '.ps1', '.url') -contains $ext -and $Arq.Length -lt 1MB) {
        try { return [System.IO.File]::ReadAllText($Arq.FullName) } catch { return '' }
    }
    return ''
}

function Remove-ItensStartup([string]$Pasta, [string]$Rotulo) {
    if (-not $Pasta -or -not (Test-Path -LiteralPath $Pasta)) { return $false }
    $achou = $false
    foreach ($arq in @(Get-ChildItem -LiteralPath $Pasta -File -Force -ErrorAction SilentlyContinue)) {
        if ((Get-AlvoArquivo $arq) -notmatch $PADRAO_INICIO) { continue }
        $achou = $true
        try {
            Remove-Item -LiteralPath $arq.FullName -Force -ErrorAction Stop
            Add-Removido "atalho de inicializacao ($Rotulo): $($arq.Name)"
        } catch {
            Add-Falha "atalho de inicializacao ($Rotulo): $($arq.Name) - $($_.Exception.Message)"
        }
    }
    return $achou
}

# ---------------------------------------------------------------------------
# REGISTRO (chaves Run / RunOnce)
# ---------------------------------------------------------------------------
function Remove-ItensRegistro([string[]]$Chaves) {
    $achou = $false
    foreach ($ch in $Chaves) {
        if (-not (Test-Path -LiteralPath $ch)) { continue }
        $props = $null
        try { $props = Get-ItemProperty -LiteralPath $ch -ErrorAction Stop } catch { continue }
        foreach ($pr in $props.PSObject.Properties) {
            if ($pr.Name -like 'PS*') { continue }
            if ([string]$pr.Value -notmatch $PADRAO_INICIO) { continue }
            $achou = $true
            try {
                Remove-ItemProperty -LiteralPath $ch -Name $pr.Name -Force -ErrorAction Stop
                Add-Removido "registro $ch\$($pr.Name)"
            } catch {
                Add-Falha "registro $ch\$($pr.Name) - $($_.Exception.Message)"
            }
        }
    }
    return $achou
}

# ---------------------------------------------------------------------------
# PASTA DO BOOTSTRAP LOCAL
# ---------------------------------------------------------------------------
function Remove-PastaBootstrap {
    Write-Host ''
    Write-Host 'Bootstrap local...' -ForegroundColor Cyan
    if (-not $env:LOCALAPPDATA) { Write-Host '  %LOCALAPPDATA% indefinido - ignorado.'; return }
    $pasta = Join-Path $env:LOCALAPPDATA 'RelatoriosBootstrap'
    if (-not (Test-Path -LiteralPath $pasta)) { Write-Host '  Nenhum bootstrap instalado.'; return }
    # Apaga por NOME (nunca a pasta com tudo dentro): se alguem guardou
    # outra coisa ali, nao some junto.
    foreach ($nome in @('bootstrap.vbs', 'launcher.path')) {
        $arq = Join-Path $pasta $nome
        if (-not (Test-Path -LiteralPath $arq)) { continue }
        try {
            Remove-Item -LiteralPath $arq -Force -ErrorAction Stop
            Add-Removido "arquivo $arq"
        } catch {
            Add-Falha "arquivo $arq - $($_.Exception.Message)"
        }
    }
    if (@(Get-ChildItem -LiteralPath $pasta -Force -ErrorAction SilentlyContinue).Count -eq 0) {
        try { Remove-Item -LiteralPath $pasta -Force -ErrorAction Stop; Add-Removido "pasta $pasta" } catch {}
    }
}

# ---------------------------------------------------------------------------
# EXECUCAO
# ---------------------------------------------------------------------------
$ehAdmin = Test-Admin
Write-RemLog ("=== iniciado - escopo={0} admin={1} matarProcessos={2} usuario={3} ===" -f $Escopo, $ehAdmin, [bool]$MatarProcessos, $env:USERNAME)

if ($MatarProcessos) { Stop-ProcessosRelatorio } else { Stop-BootstrapAguardando }

Remove-TarefasAgendadas

Write-Host ''
Write-Host 'Pastas Inicializar e registro...' -ForegroundColor Cyan
$achouIni = $false
$startupComum = ''
try { $startupComum = [Environment]::GetFolderPath('CommonStartup') } catch {}
if (Remove-ItensStartup $startupComum 'todos os usuarios') { $achouIni = $true }
if (Remove-ItensRegistro @('HKLM:\Software\Microsoft\Windows\CurrentVersion\Run',
                           'HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce',
                           'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run')) { $achouIni = $true }
if ($Escopo -eq 'Usuario') {
    # Itens do USUARIO so' na instancia original: a elevada pode estar em
    # outra conta (credencial de administrador diferente) e mexeria no
    # perfil errado.
    $script:EtapaUsuario = $true
    $startupUsuario = ''
    try { $startupUsuario = [Environment]::GetFolderPath('Startup') } catch {}
    if (Remove-ItensStartup $startupUsuario 'usuario') { $achouIni = $true }
    if (Remove-ItensRegistro @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',
                               'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce')) { $achouIni = $true }
    $script:EtapaUsuario = $false
}
if (-not $achouIni) { Write-Host '  Nenhum atalho ou registro de inicializacao do relatorio.' }

if ($Escopo -eq 'Usuario') {
    $script:EtapaUsuario = $true
    Remove-PastaBootstrap
    $script:EtapaUsuario = $false
}

# ---------------------------------------------------------------------------
# INSTANCIA ELEVADA: devolve o resultado para a original e sai.
# ---------------------------------------------------------------------------
if ($Escopo -eq 'Maquina') {
    try {
        $res = @{ removidos = @($script:Removidos); falhas = @($script:Falhas) } | ConvertTo-Json -Depth 3
        [System.IO.File]::WriteAllText($RESULT_PATH, $res, (New-Object System.Text.UTF8Encoding($false)))
    } catch {}
    Write-RemLog ("=== instancia elevada concluida - removidos={0} falhas={1} ===" -f $script:Removidos.Count, $script:Falhas.Count)
    if ($script:Falhas.Count -gt 0) { exit 1 } else { exit 0 }
}

# ---------------------------------------------------------------------------
# Sobrou falha fora do perfil do usuario, sem Administrador: eleva UMA vez
# e refaz so' a parte de maquina. A instancia elevada roda de uma copia em
# %TEMP% (local).
# ---------------------------------------------------------------------------
if ($script:Falhas.Count -gt $script:FalhasUsuario.Count -and -not $ehAdmin) {
    Write-Host ''
    Write-Host 'Alguns itens exigem Administrador. Solicitando permissao (UAC)...' -ForegroundColor Cyan
    $tag     = [guid]::NewGuid().ToString('N')
    $tmpPs1  = Join-Path $env:TEMP "_remover-inicializacao-$tag.ps1"
    $tmpPrm  = Join-Path $env:TEMP "_remover-inicializacao-$tag.json"
    $tmpRes  = Join-Path $env:TEMP "_remover-inicializacao-$tag.res.json"
    try {
        Copy-Item -LiteralPath $MyInvocation.MyCommand.Path -Destination $tmpPs1 -Force -ErrorAction Stop
        $prm = @{ appName = $APP_NAME; porta = $PORTA; logPath = $LOG_PATH; resultPath = $tmpRes
                  matar = [bool]$MatarProcessos; pastaProjeto = $PASTA_PROJ } | ConvertTo-Json
        [System.IO.File]::WriteAllText($tmpPrm, $prm, (New-Object System.Text.UTF8Encoding($false)))
        $argsElev = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$tmpPs1`" -Escopo Maquina -ParamsFile `"$tmpPrm`""
        $proc = Start-Process -FilePath 'powershell.exe' -ArgumentList $argsElev -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ErrorAction Stop
        $res = $null
        try { $res = [System.IO.File]::ReadAllText($tmpRes, [System.Text.Encoding]::UTF8) | ConvertFrom-Json } catch {}
        if ($null -eq $res) {
            Write-Host "  A instancia elevada nao devolveu resultado (codigo $($proc.ExitCode))." -ForegroundColor Yellow
        } else {
            # Resultado elevado substitui as falhas de maquina anteriores (o
            # que ela removeu deixou de ser falha); as do perfil continuam.
            $script:Falhas.Clear()
            foreach ($f in $script:FalhasUsuario) { [void]$script:Falhas.Add($f) }
            foreach ($r in @($res.removidos)) { if ($r) { Add-Removido "[admin] $r" } }
            foreach ($f in @($res.falhas))    { if ($f) { Add-Falha "[admin] $f" } }
        }
    } catch {
        Write-Host "  Elevacao cancelada ou bloqueada: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-RemLog "Elevacao cancelada/bloqueada: $($_.Exception.Message)"
    } finally {
        foreach ($f in @($tmpPs1, $tmpPrm, $tmpRes)) { try { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue } catch {} }
    }
}

# ---------------------------------------------------------------------------
# RESUMO
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '======================================================='
if ($script:Falhas.Count -eq 0) {
    Write-Host '  Inicializacao automatica REMOVIDA.' -ForegroundColor Green
    if ($MatarProcessos) {
        Write-Host '  Nenhum processo do relatorio ficou em execucao.' -ForegroundColor Green
        # Processo encerrado a forca nao apaga o proprio icone: o Windows so'
        # o remove quando o mouse passa por cima.
        if ($script:TrayEncerrado) { Write-Host '  Se o icone ainda aparecer na bandeja, passe o mouse sobre ele.' }
    }
    else {
        Write-Host '  Processos em execucao foram mantidos: o servidor continua'
        Write-Host '  ate sair pelo icone da bandeja ou reiniciar o computador.'
    }
} else {
    Write-Host "  Concluido com $($script:Falhas.Count) pendencia(s):" -ForegroundColor Yellow
    foreach ($f in $script:Falhas) { Write-Host "    - $f" -ForegroundColor Yellow }
    Write-Host '  Execute de novo como Administrador (botao direito >'
    Write-Host '  "Executar como administrador") para concluir.'
}
Write-Host '======================================================='
Write-Host '  Para reativar: instalar-na-inicializacao.bat'
Write-Host '  Detalhes no log:' $LOG_PATH
Write-RemLog ("=== concluido - removidos={0} pendencias={1} ===" -f $script:Removidos.Count, $script:Falhas.Count)

if ($script:Falhas.Count -gt 0) { exit 1 }
exit 0
