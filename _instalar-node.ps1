# _instalar-node.ps1
# Instala Node.js automaticamente no Windows 10/11 x64.
# Metodos: winget -> MSI silencioso -> MSI com log detalhado.
# Auto-eleva para Administrador se necessario.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------
$NODE_VERSION = "20.19.0"
$NODE_URL     = "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-x64.msi"
$NODE_DIR     = "C:\Program Files\nodejs"
$LOG_FILE     = "$env:TEMP\node-install-log.txt"
$TMP_MSI      = "$env:TEMP\node-setup.msi"

# ---------------------------------------------------------------------------
# Log com timestamp
# ---------------------------------------------------------------------------
function Write-Log {
    param(
        [string]$Msg,
        [string]$Nivel = 'INFO'
    )
    $ts    = (Get-Date).ToString("HH:mm:ss")
    $linha = "[$ts][$Nivel] $Msg"
    Write-Host $linha
    Add-Content -Path $LOG_FILE -Value $linha -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------------
# Auto-elevacao para Administrador
# ---------------------------------------------------------------------------
function Ensure-Admin {
    $identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    $isAdmin   = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

    if (-not $isAdmin) {
        Write-Log "Nao esta rodando como Administrador. Reiniciando elevado..." "AVISO"
        $script = $MyInvocation.ScriptName
        if (-not $script) { $script = $PSCommandPath }
        Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$script`"" -Verb RunAs -Wait
        exit 0
    }
}

# ---------------------------------------------------------------------------
# Retorna versao do Node se encontrado no PATH
# ---------------------------------------------------------------------------
function Get-NodeVersion {
    try {
        $saida = & node --version 2>$null
        if ($saida -match 'v(\d+\.\d+\.\d+)') { return $Matches[1] }
    } catch {}
    return $null
}

# ---------------------------------------------------------------------------
# Procura node.exe fora do PATH
# ---------------------------------------------------------------------------
function Find-NodeDir {
    $candidatos = @(
        $NODE_DIR,
        "$env:ProgramFiles\nodejs",
        "${env:ProgramFiles(x86)}\nodejs",
        "$env:LOCALAPPDATA\Programs\nodejs"
    )
    foreach ($c in $candidatos) {
        if (Test-Path "$c\node.exe") { return $c }
    }
    return $null
}

# ---------------------------------------------------------------------------
# Adiciona diretorio ao PATH da sessao e do sistema
# ---------------------------------------------------------------------------
function Add-ToPath {
    param([string]$Dir)
    if (-not $Dir) { return }
    if (-not (Test-Path $Dir)) { return }

    if ($env:Path -notlike "*$Dir*") {
        $env:Path = "$Dir;$env:Path"
    }

    try {
        $mPath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
        if ($mPath -notlike "*$Dir*") {
            [System.Environment]::SetEnvironmentVariable("Path", "$mPath;$Dir", "Machine")
            Write-Log "PATH do sistema atualizado: $Dir" "OK"
        }
    } catch {
        Write-Log "Nao foi possivel atualizar PATH do sistema: $($_.Exception.Message)" "AVISO"
    }
}

# ---------------------------------------------------------------------------
# Metodo 1 -- winget
# ---------------------------------------------------------------------------
function Install-ViaWinget {
    Write-Log "Tentando instalar via winget..."
    try {
        $wg = Get-Command winget -ErrorAction Stop
        Write-Log "winget encontrado: $($wg.Source)"
        $saida = & winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements 2>&1
        Write-Log "Saida winget: $saida"
        Start-Sleep -Seconds 5

        $dir = Find-NodeDir
        if ($dir) {
            Add-ToPath $dir
            $ver = Get-NodeVersion
            if ($ver) {
                Write-Log "Node.js $ver instalado via winget." "OK"
                return $true
            }
        }
    } catch {
        Write-Log "winget nao disponivel ou falhou: $($_.Exception.Message)" "AVISO"
    }
    return $false
}

# ---------------------------------------------------------------------------
# Download do MSI com 3 tentativas
# ---------------------------------------------------------------------------
function Download-Msi {
    Write-Log "Baixando Node.js $NODE_VERSION..."
    Write-Log "URL: $NODE_URL"

    if (Test-Path $TMP_MSI) {
        Remove-Item $TMP_MSI -Force -ErrorAction SilentlyContinue
    }

    $limite = 3
    for ($i = 1; $i -le $limite; $i++) {
        Write-Log "Tentativa de download $i de $limite..."
        try {
            $ErrorActionPreference = 'Stop'

            $usaBits = $null -ne (Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue)
            if ($usaBits) {
                Start-BitsTransfer -Source $NODE_URL -Destination $TMP_MSI -ErrorAction Stop
            } else {
                $wc = New-Object System.Net.WebClient
                $wc.DownloadFile($NODE_URL, $TMP_MSI)
            }

            if (Test-Path $TMP_MSI) {
                $tamBytes = (Get-Item $TMP_MSI -ErrorAction Stop).Length
                $tamMB    = [math]::Round($tamBytes / 1MB, 1)

                if ($tamBytes -gt 5000000) {
                    Write-Log "Download OK. Tamanho: $tamMB MB" "OK"
                    return $true
                } else {
                    Write-Log "Arquivo suspeito ($tamMB MB). Removendo e tentando novamente." "AVISO"
                    Remove-Item $TMP_MSI -Force -ErrorAction SilentlyContinue
                }
            }
        } catch {
            Write-Log "Falha na tentativa $i : $($_.Exception.Message)" "AVISO"
        }
        $ErrorActionPreference = 'Stop'
        Start-Sleep -Seconds 3
    }

    Write-Log "Download falhou apos $limite tentativas." "ERRO"
    return $false
}

# ---------------------------------------------------------------------------
# Metodo 2 -- MSI silencioso
# ---------------------------------------------------------------------------
function Install-ViaMsiSilent {
    Write-Log "Instalando via MSI (modo silencioso)..."
    $ErrorActionPreference = 'SilentlyContinue'
    $proc   = Start-Process msiexec -ArgumentList "/i `"$TMP_MSI`" /qn /norestart ALLUSERS=1 ADDLOCAL=ALL" -Wait -PassThru
    $codigo = $proc.ExitCode
    $ErrorActionPreference = 'Stop'

    Write-Log "msiexec retornou: $codigo"
    if ($codigo -eq 0 -or $codigo -eq 3010) { return $true }

    Write-Log "MSI silencioso falhou (codigo $codigo)." "AVISO"
    return $false
}

# ---------------------------------------------------------------------------
# Metodo 3 -- MSI com log verbose (diagnostico)
# ---------------------------------------------------------------------------
function Install-ViaMsiComLog {
    Write-Log "Instalando via MSI com log detalhado..."
    Write-Log "Log sera salvo em: $LOG_FILE"

    $ErrorActionPreference = 'SilentlyContinue'
    $proc   = Start-Process msiexec -ArgumentList "/i `"$TMP_MSI`" /qb /norestart ALLUSERS=1 ADDLOCAL=ALL /L*V `"$LOG_FILE`"" -Wait -PassThru
    $codigo = $proc.ExitCode
    $ErrorActionPreference = 'Stop'

    Write-Log "msiexec (log) retornou: $codigo"

    if ($codigo -eq 0 -or $codigo -eq 3010) { return $true }

    Write-Log "Instalacao MSI falhou. Log em: $LOG_FILE" "ERRO"

    if (Test-Path $LOG_FILE) {
        $ultimas = Get-Content $LOG_FILE -Tail 25 -ErrorAction SilentlyContinue
        if ($ultimas) {
            Write-Host ""
            Write-Host "--- Ultimas linhas do log MSI ---"
            $ultimas | ForEach-Object { Write-Host $_ }
            Write-Host "---------------------------------"
            Write-Host ""
        }
    }
    return $false
}

# ===========================================================================
# INICIO
# ===========================================================================
Ensure-Admin

Write-Log "=== Instalador Node.js v$NODE_VERSION ==="

# Ja instalado e no PATH?
$ver = Get-NodeVersion
if ($ver) {
    Write-Log "Node.js ja esta instalado: v$ver" "OK"
    exit 0
}

# Instalado fora do PATH?
$dir = Find-NodeDir
if ($dir) {
    Add-ToPath $dir
    $ver = Get-NodeVersion
    if ($ver) {
        Write-Log "Node.js encontrado em '$dir' e adicionado ao PATH (v$ver)." "OK"
        exit 0
    }
}

# --- Tentativa 1: winget ---
if (Install-ViaWinget) { exit 0 }

# --- Download do MSI ---
if (-not (Download-Msi)) {
    Write-Log "Impossivel baixar o instalador. Verifique a internet." "ERRO"
    Write-Log "Download manual: $NODE_URL" "ERRO"
    Read-Host "Pressione ENTER para fechar"
    exit 1
}

# --- Tentativa 2: MSI silencioso ---
$instalou = Install-ViaMsiSilent

# --- Tentativa 3: MSI com log ---
if (-not $instalou) {
    $instalou = Install-ViaMsiComLog
}

# Limpa MSI temporario
Remove-Item $TMP_MSI -Force -ErrorAction SilentlyContinue

if (-not $instalou) {
    Write-Log "Todas as tentativas falharam." "ERRO"
    Write-Log "Instale manualmente: https://nodejs.org/en/download" "ERRO"
    Write-Log "Log de diagnostico: $LOG_FILE" "ERRO"
    Read-Host "Pressione ENTER para fechar"
    exit 1
}

# Atualiza PATH e confirma
$dir = Find-NodeDir
if ($dir) { Add-ToPath $dir }
Start-Sleep -Seconds 2

$ver = Get-NodeVersion
if ($ver) {
    Write-Log "Node.js v$ver instalado com sucesso!" "OK"
    exit 0
} else {
    Write-Log "Instalacao concluida. Abra um NOVO terminal para usar o node." "AVISO"
    Write-Log "Se o problema persistir, reinicie o computador." "AVISO"
    exit 0
}