# _instalar-node.ps1
# Instala Node.js automaticamente no Windows 10/11 x64.
# Metodos: winget -> MSI silencioso -> MSI com log detalhado.
# Auto-eleva para Administrador se necessario.
#
# @version 1.3.0
# @author Ruda Gabriel
# @changelog
#   1.3.0 - 2026-10-05 16:24 - Revisao completa.
#     - Integridade: o MSI baixado era executado como Administrador sem
#       nenhuma verificacao. Agora o SHA-256 e' conferido contra o
#       SHASUMS256.txt oficial da mesma versao; sem acesso a ele, exige
#       assinatura digital (Authenticode) valida do arquivo.
#     - Auto-elevacao: a instancia nao elevada sempre saia com codigo 0, mesmo
#       quando a elevada falhava - os .bat seguiam como se o Node estivesse
#       instalado. Agora o codigo de saida da instancia elevada e' repassado.
#     - Node.js 20 (fim de suporte em abril/2026) trocado pela LTS 22.22.0.
#     - Read-Host protegido: os .bat chamam este script com -NonInteractive,
#       onde Read-Host lanca erro em vez de esperar o ENTER.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# TITULO FIX (ajuste solicitado): nunca derruba o script se falhar (ex:
# config.json ainda nao existe nesta etapa da instalacao) - titulo e' so'
# cosmetico, nao pode impedir a instalacao do Node.js.
try {
    $__appName = "Relatorios"
    $__cfgPath = Join-Path $PSScriptRoot "config.json"
    if (Test-Path $__cfgPath) {
        $__cfg = Get-Content $__cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
        if ($__cfg.appName) { $__appName = $__cfg.appName }
    }
    $host.UI.RawUI.WindowTitle = "$__appName - Instalando Node.js"
} catch {}

# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------
# NOTA (trade-off consciente): versao fixa em vez de buscar dinamicamente a
# ultima LTS. Buscar a versao mais recente exigiria uma chamada de rede extra
# (novo ponto de falha) so' para DESCOBRIR o que baixar, antes mesmo de baixar
# o instalador. Mantido simples e previsivel - reveja/atualize este numero
# periodicamente (verifique a LTS atual em https://nodejs.org/en/download).
$NODE_VERSION = "22.22.0"
$NODE_MSI     = "node-v$NODE_VERSION-x64.msi"
$NODE_URL     = "https://nodejs.org/dist/v$NODE_VERSION/$NODE_MSI"
$NODE_SHASUMS = "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
$NODE_DIR     = "C:\Program Files\nodejs"
$LOG_FILE     = "$env:TEMP\node-install-log.txt"
$TMP_MSI      = "$env:TEMP\node-setup.msi"

# ---------------------------------------------------------------------------
# Read-Host seguro: com -NonInteractive (como os .bat chamam) Read-Host lanca
# erro; aqui so' pausa quando ha console interativo.
# ---------------------------------------------------------------------------
function Wait-Enter {
    try { Read-Host "Pressione ENTER para fechar" | Out-Null } catch {}
}

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
        # ROBUSTEZ FIX: se o usuario clicar "Nao" no prompt do UAC, Start-Process
        # -Verb RunAs lanca uma excecao terminante (ErrorActionPreference='Stop'
        # esta em vigor no escopo do modulo) - sem este try/catch, o script
        # encerrava com um stack trace .NET cru em vez de uma mensagem clara,
        # inconsistente com o padrao de log amigavel usado no resto do arquivo.
        try {
            $procElevado = Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$script`"" -Verb RunAs -Wait -PassThru -ErrorAction Stop
        } catch {
            Write-Log "Elevacao para Administrador foi cancelada ou falhou: $($_.Exception.Message)" "ERRO"
            Write-Log "A instalacao do Node.js requer privilegios de Administrador. Execute novamente e aceite o prompt do UAC." "ERRO"
            exit 1
        }
        # Repassa o resultado REAL da instancia elevada (antes: sempre 0).
        $codigoElevado = 0
        try { if ($procElevado -and $procElevado.HasExited) { $codigoElevado = [int]$procElevado.ExitCode } } catch {}
        exit $codigoElevado
    }
}

# ---------------------------------------------------------------------------
# Verifica a integridade do MSI baixado antes de executa-lo como Administrador.
# 1) SHA-256 contra o SHASUMS256.txt oficial da versao (falha => rejeita).
# 2) Sem acesso ao SHASUMS256.txt: exige assinatura Authenticode valida.
# ---------------------------------------------------------------------------
function Test-MsiIntegro {
    $hashLocal = $null
    try { $hashLocal = (Get-FileHash -Path $TMP_MSI -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant() } catch {
        Write-Log "Nao foi possivel calcular o SHA-256 do instalador: $($_.Exception.Message)" "ERRO"
        return $false
    }
    $hashOficial = $null
    try {
        try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
        $wc = New-Object System.Net.WebClient
        $somas = $wc.DownloadString($NODE_SHASUMS)
        foreach ($linha in ($somas -split "`n")) {
            $partes = $linha.Trim() -split '\s+'
            if ($partes.Count -ge 2 -and $partes[1] -eq $NODE_MSI) { $hashOficial = $partes[0].ToLowerInvariant(); break }
        }
    } catch {
        Write-Log "SHASUMS256.txt indisponivel ($($_.Exception.Message)) - conferindo assinatura digital." "AVISO"
    }
    if ($hashOficial) {
        if ($hashOficial -eq $hashLocal) { Write-Log "SHA-256 conferido com o oficial." "OK"; return $true }
        Write-Log "SHA-256 NAO confere (esperado $hashOficial, obtido $hashLocal)." "ERRO"
        return $false
    }
    try {
        $assin = Get-AuthenticodeSignature -FilePath $TMP_MSI -ErrorAction Stop
        if ($assin.Status -eq 'Valid') { Write-Log "Assinatura digital valida: $($assin.SignerCertificate.Subject)" "OK"; return $true }
        Write-Log "Assinatura digital invalida ou ausente (status: $($assin.Status))." "ERRO"
    } catch {
        Write-Log "Nao foi possivel verificar a assinatura digital: $($_.Exception.Message)" "ERRO"
    }
    return $false
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
    $TIMEOUT_DOWNLOAD_SEG = 180
    for ($i = 1; $i -le $limite; $i++) {
        Write-Log "Tentativa de download $i de $limite (timeout: ${TIMEOUT_DOWNLOAD_SEG}s)..."
        try {
            $ErrorActionPreference = 'Stop'

            # TIMEOUT FIX: nem Start-BitsTransfer nem WebClient.DownloadFile tem
            # timeout de rede embutido. Se a conexao travar em vez de falhar
            # (ex: firewall descartando pacotes silenciosamente, proxy pendurado),
            # o download ficava preso PARA SEMPRE - nunca cai no catch, nunca
            # avanca de tentativa, e a instalacao inteira do Node.js trava sem
            # nenhuma mensagem de erro. Executa o download num job em segundo
            # plano com teto rigido de tempo; se estourar, mata o job e trata
            # como falha desta tentativa (cai no laco normal de retry).
            $job = Start-Job -ScriptBlock {
                param($url, $dest)
                try {
                    # PS 5.1 nao habilita TLS 1.2 por padrao (nodejs.org exige).
                    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
                    if (Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue) {
                        Start-BitsTransfer -Source $url -Destination $dest -ErrorAction Stop
                    } else {
                        $wc = New-Object System.Net.WebClient
                        $wc.DownloadFile($url, $dest)
                    }
                    return $true
                } catch {
                    return $_.Exception.Message
                }
            } -ArgumentList $NODE_URL, $TMP_MSI

            $terminou = Wait-Job -Job $job -Timeout $TIMEOUT_DOWNLOAD_SEG
            if (-not $terminou) {
                Write-Log "Download nao respondeu em ${TIMEOUT_DOWNLOAD_SEG}s - abortando esta tentativa." "AVISO"
                Stop-Job -Job $job -ErrorAction SilentlyContinue
            } else {
                $resultadoJob = Receive-Job -Job $job -ErrorAction SilentlyContinue
                if ($resultadoJob -ne $true) {
                    Write-Log "Job de download retornou erro: $resultadoJob" "AVISO"
                }
            }
            Remove-Job -Job $job -Force -ErrorAction SilentlyContinue

            if (Test-Path $TMP_MSI) {
                $tamBytes = (Get-Item $TMP_MSI -ErrorAction Stop).Length
                $tamMB    = [math]::Round($tamBytes / 1MB, 1)

                if ($tamBytes -gt 5000000) {
                    Write-Log "Download OK. Tamanho: $tamMB MB" "OK"
                    if (Test-MsiIntegro) { return $true }
                    Write-Log "Arquivo baixado reprovado na verificacao de integridade. Removendo e tentando novamente." "AVISO"
                    Remove-Item $TMP_MSI -Force -ErrorAction SilentlyContinue
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
    Wait-Enter
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
    Wait-Enter
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