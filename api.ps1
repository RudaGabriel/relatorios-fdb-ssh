<#
.SYNOPSIS
Cliente CLI robusto para servidor-relatorio.js
.DESCRIPTION
Interface PowerShell para interação com API do servidor de relatórios.
- IP manual via parâmetro ou prompt interativo
- Retry exponencial e tratamento rigoroso de erros
- Menu interativo + modo direto para scripting
- Contém APENAS endpoints implementados no backend atual
.REQUIREMENTS
PowerShell 5.1+ ou 7+ | Salvar como UTF-8 sem BOM
#>
[CmdletBinding()]
param(
    [string]$ConfigPath = "$PSScriptRoot\config.json",
    [ValidateSet("status","db-status","sse-clients","proibidos","config","salvar-fdb","abrir-picker","navigate-hoje","navigate-config","navigate-fdb","navigate-periodo","upload-favicon","restart","pronto","log-error","sse-test","menu")]
    [string]$Endpoint = "menu",
    [object]$Payload,
    [string]$MaquinaIP = $null
)

# ===========================================================================
# 1. CARREGAMENTO SEGURO DE CONFIG
# ===========================================================================
function Get-ConfigSegura {
    param([string]$Path)
    if (-not (Test-Path $Path)) { throw "ERRO: config.json nao encontrado em '${Path}'" }
    try {
        $raw = Get-Content $Path -Raw -Encoding UTF8
        $cfg = $raw | ConvertFrom-Json -ErrorAction Stop
        if ($null -eq $cfg.porta) { throw "config.json invalido: falta 'porta'" }
        return $cfg
    } catch { throw "Falha ao parsear config.json: $($_.Exception.Message)" }
}

$Config = Get-ConfigSegura -Path $ConfigPath

# ===========================================================================
# 2. DEFINIÇÃO DO IP (Parâmetro > Config > Prompt)
# ===========================================================================
$IpDefinido = $null
if (-not [string]::IsNullOrWhiteSpace($MaquinaIP)) {
    $IpDefinido = $MaquinaIP.Trim()
    Write-Host "[CONFIG] IP via parametro: ${IpDefinido}" -ForegroundColor DarkGray
} elseif ($null -ne $Config.maquinaIP -and -not [string]::IsNullOrWhiteSpace($Config.maquinaIP)) {
    $IpDefinido = $Config.maquinaIP.Trim()
    Write-Host "[CONFIG] IP do config.json: ${IpDefinido}" -ForegroundColor DarkGray
} else {
    Write-Host "[CONFIG] IP nao definido. Solicitando manualmente..." -ForegroundColor Yellow
    $IpDefinido = Read-Host "Informe o IP do servidor (ex: 192.168.1.50 ou localhost)"
    if ([string]::IsNullOrWhiteSpace($IpDefinido)) { throw "ERRO: IP nao informado." }
}

if ($IpDefinido -notmatch "^[a-zA-Z0-9.\-_:]+$") {
    Write-Warning "Formato atipico: '${IpDefinido}'. Tentando conexao..."
}

$BaseUri = "http://${IpDefinido}:$($Config.porta)"
Write-Host "[CONFIG] Servidor ativo: ${BaseUri}" -ForegroundColor Cyan

# ===========================================================================
# 3. ENGINE HTTP COM RETRY EXPONENCIAL
# ===========================================================================
function Invoke-ApiCall {
    param(
        [Parameter(Mandatory=$true)][string]$Rota,
        [string]$Metodo = "GET",
        [object]$Corpo,
        [string]$ContentType = "application/json; charset=utf-8",
        [int]$Timeout = 10,
        [int]$MaxRetries = 2
    )
    $uri = "${BaseUri}${Rota}"
    $tentativa = 0
    $ultimoErro = ""
    while ($tentativa -le $MaxRetries) {
        try {
            $params = @{
                Uri = $uri
                Method = $Metodo
                UseBasicParsing = $true
                TimeoutSec = $Timeout
                Headers = @{ "Accept" = "application/json" }
                ErrorAction = "Stop"
            }
            if ($Metodo -ne "GET" -and $null -ne $Corpo) {
                $params["Body"] = $Corpo
                $params["ContentType"] = $ContentType
            }
            $res = Invoke-WebRequest @params
            if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300) {
                if ([string]::IsNullOrWhiteSpace($res.Content)) { return $null }
                try { return $res.Content | ConvertFrom-Json -ErrorAction Stop }
                catch { return $res.Content }
            } else {
                $ultimoErro = "HTTP $($res.StatusCode) - $($res.StatusDescription)"
            }
        } catch [System.Net.WebException] {
            $ultimoErro = "Falha de rede: $($_.Exception.Message)"
        } catch {
            $ultimoErro = "Erro: $($_.Exception.Message)"
        }
        $tentativa++
        if ($tentativa -le $MaxRetries) {
            $delay = [math]::Pow(2, $tentativa) * 500
            Write-Warning "[RETRY ${tentativa}/${MaxRetries}] ${ultimoErro} | Aguardando $($delay/1000)s..."
            Start-Sleep -Milliseconds $delay
        }
    }
    throw "FALHA CRITICA apos ${MaxRetries} tentativas. Ultimo erro: ${ultimoErro}"
}

# ===========================================================================
# 4. EXECUÇÃO DE ENDPOINTS (VALIDADOS NO BACKEND)
# ===========================================================================
function Executar-Endpoint {
    param([string]$Ep, [object]$Data)
    switch ($Ep) {
        "status" { return Invoke-ApiCall -Rota "/api/status" }
        "db-status" { return Invoke-ApiCall -Rota "/api/db-status" }
        "sse-clients" { return Invoke-ApiCall -Rota "/api/sse-clients" }
        "proibidos" {
            if ($Data) {
                if ($Data -isnot [array]) { throw "Payload deve ser array de strings" }
                return Invoke-ApiCall -Rota "/api/proibidos" -Metodo POST -Corpo ($Data | ConvertTo-Json -Compress)
            }
            return Invoke-ApiCall -Rota "/api/proibidos"
        }
        "config" {
            if ($Data) {
                $valido = @{}
                if ($Data.ContainsKey("appName")) { $valido["appName"] = $Data.appName }
                if ($Data.ContainsKey("pollInterval")) { $valido["pollInterval"] = [int]$Data.pollInterval }
                if ($Data.ContainsKey("maxLogLines")) { $valido["maxLogLines"] = [int]$Data.maxLogLines }
                if ($Data.ContainsKey("proibidos")) { $valido["proibidos"] = $Data.proibidos }
                if ($Data.ContainsKey("favicon")) { $valido["favicon"] = $Data.favicon }
                return Invoke-ApiCall -Rota "/api/config" -Metodo POST -Corpo ($valido | ConvertTo-Json -Compress)
            }
            return Invoke-ApiCall -Rota "/api/config"
        }
        "salvar-fdb" {
            if ($Data -isnot [string] -or [string]::IsNullOrWhiteSpace($Data)) { throw "Informe caminho do .fdb" }
            if (-not $Data.EndsWith(".fdb", [StringComparison]::OrdinalIgnoreCase)) { throw "Caminho deve terminar com .fdb" }
            return Invoke-ApiCall -Rota "/api/salvar-fdb" -Metodo POST -Corpo (@{caminho=$Data} | ConvertTo-Json -Compress)
        }
        "abrir-picker" { return Invoke-ApiCall -Rota "/api/abrir-picker-fdb" }
        "navigate-hoje" { return Invoke-ApiCall -Rota "/api/navigate/hoje" }
        "navigate-config" { return Invoke-ApiCall -Rota "/api/navigate/config" }
        "navigate-fdb" { return Invoke-ApiCall -Rota "/api/navigate/selecionar-fdb" }
        "navigate-periodo" {
            if ($Data -isnot [array] -or $Data.Count -ne 2) { throw "Informe 2 datas: @('YYYY-MM-DD','YYYY-MM-DD')" }
            $d1 = $Data[0] -replace '/','-'; $d2 = $Data[1] -replace '/','-'
            return Invoke-ApiCall -Rota "/api/navigate/periodo/${d1}/${d2}"
        }
        "upload-favicon" {
            if ($Data -isnot [string] -or -not (Test-Path $Data)) { throw "Caminho de imagem invalido" }
            $bytes = [System.IO.File]::ReadAllBytes($Data)
            return Invoke-ApiCall -Rota "/api/upload-favicon" -Metodo POST -ContentType "application/octet-stream" -Corpo $bytes
        }
        "restart" {
            Write-Warning "Solicitando restart do servidor..."
            return Invoke-ApiCall -Rota "/api/restart"
        }
        "pronto" {
            if ($Data -isnot [string]) { throw "Informe chave de polling" }
            $escaped = [System.Uri]::EscapeDataString($Data)
            return Invoke-ApiCall -Rota "/pronto?k=${escaped}"
        }
        "log-error" {
            if ($Data -isnot [hashtable]) { throw "Payload deve ser hashtable" }
            return Invoke-ApiCall -Rota "/api/log-error" -Metodo POST -Corpo ($Data | ConvertTo-Json -Compress)
        }
        "sse-test" {
            Write-Host "[SSE] Verificando conexao Server-Sent Events..." -ForegroundColor Cyan
            try {
                $uri = "${BaseUri}/api/sse-clients"
                $req = [System.Net.HttpWebRequest]::Create($uri)
                $req.Timeout = 8000
                $res = $req.GetResponse()
                $reader = New-Object System.IO.StreamReader($res.GetResponseStream())
                $linha = $reader.ReadLine()
                $reader.Close(); $res.Close()
                return @{ conectado = $true; primeira_mensagem = $linha }
            } catch {
                return @{ conectado = $false; erro = $_.Exception.Message }
            }
        }
        default { throw "Endpoint desconhecido: ${Ep}" }
    }
}

# ===========================================================================
# 5. MENU INTERATIVO
# ===========================================================================
function Mostrar-Menu {
    Write-Host "`n================================================================" -ForegroundColor Cyan
    Write-Host " CLIENTE API - SERVIDOR RELATORIO (${BaseUri})" -ForegroundColor Cyan
    Write-Host " IP Ativo: ${IpDefinido}" -ForegroundColor DarkGray
    Write-Host "================================================================`n" -ForegroundColor Cyan
    Write-Host "=== OPERACOES PRINCIPAIS ==="
    Write-Host " 1. status           | Qt/vendas e total do dia"
    Write-Host " 2. db-status        | Status conexao Firebird (fbHost)"
    Write-Host " 3. sse-clients      | Abas conectadas via SSE"
    Write-Host " 4. proibidos (GET)  | Listar produtos filtrados"
    Write-Host " 5. proibidos (POST) | Atualizar lista (array de strings)"
    Write-Host " 6. config (GET)     | Ler configuracoes ativas"
    Write-Host " 7. config (POST)    | Alterar appName, pollInterval, etc."
    Write-Host " 8. salvar-fdb       | Definir caminho do SMALL.FDB"
    Write-Host " 9. abrir-picker     | Abrir seletor nativo do Windows"
    Write-Host "10. navigate-hoje    | Focar abas em / (hoje)"
    Write-Host "11. navigate-config  | Focar abas em /#config"
    Write-Host "12. navigate-fdb     | Focar abas em /selecionar-fdb"
    Write-Host "13. navigate-periodo | Navegar para periodo especifico"
    Write-Host "14. upload-favicon   | Enviar novo icone PNG/ICO/JPG"
    Write-Host "15. restart          | Reiniciar servidor (process-safe)"
    Write-Host "16. pronto           | Polling de geracao (?k=...)"
    Write-Host "17. log-error        | Simular envio de erro do browser"
    Write-Host "18. sse-test         | Testar conexao Server-Sent Events"
    Write-Host "19. alterar-ip       | Redefinir IP manualmente agora"
    Write-Host "`n 0. Sair"
    Write-Host "================================================================`n" -ForegroundColor Cyan
}

# ===========================================================================
# 6. EXECUÇÃO PRINCIPAL
# ===========================================================================
if ($Endpoint -eq "menu") {
    Mostrar-Menu
    while ($true) {
        $escolha = Read-Host "Selecione a operacao"
        if ($escolha -eq "0") { exit }

        if ($escolha -eq "19") {
            $novoIp = Read-Host "Novo IP do servidor"
            if (-not [string]::IsNullOrWhiteSpace($novoIp)) {
                $IpDefinido = $novoIp.Trim()
                $BaseUri = "http://${IpDefinido}:$($Config.porta)"
                Write-Host "[SUCESSO] IP alterado para ${IpDefinido}" -ForegroundColor Green
                Mostrar-Menu
            } else {
                Write-Host "[AVISO] IP nao alterado." -ForegroundColor Yellow
            }
            continue
        }

        try {
            $epMap = @{
                "1"="status"; "2"="db-status"; "3"="sse-clients"
                "4"="proibidos"; "5"="proibidos"; "6"="config"; "7"="config"
                "8"="salvar-fdb"; "9"="abrir-picker"; "10"="navigate-hoje"
                "11"="navigate-config"; "12"="navigate-fdb"; "13"="navigate-periodo"
                "14"="upload-favicon"; "15"="restart"; "16"="pronto"; "17"="log-error"
                "18"="sse-test"
            }
            $epNome = $epMap[$escolha]
            if (-not $epNome) { Write-Warning "Opcao invalida"; continue }

            $dados = $null
            switch ($escolha) {
                "5" {
                    $inp = Read-Host "Proibidos (separados por virgula)"
                    $dados = $inp.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
                }
                "7" {
                    $dados = @{}
                    $an = Read-Host "appName (Enter para manter)"
                    if ($an) { $dados["appName"] = $an }
                    $pi = Read-Host "pollInterval ms (Enter para manter)"
                    if ($pi -and [int]::TryParse($pi, [ref]$null)) { $dados["pollInterval"] = [int]$pi }
                    $ml = Read-Host "maxLogLines (Enter para manter)"
                    if ($ml -and [int]::TryParse($ml, [ref]$null)) { $dados["maxLogLines"] = [int]$ml }
                    if ($dados.Count -eq 0) { Write-Warning "Nenhum valor informado"; continue }
                }
                "8" { $dados = Read-Host "Caminho completo do .fdb" }
                "13" {
                    $d1 = Read-Host "Data inicio (YYYY-MM-DD)"
                    $d2 = Read-Host "Data fim (YYYY-MM-DD)"
                    $dados = @($d1, $d2)
                }
                "14" { $dados = Read-Host "Caminho da imagem (PNG/ICO/JPG)" }
                "16" { $dados = Read-Host "Chave de polling" }
                "17" { $dados = @{ msg = Read-Host "Mensagem de erro"; stack = "Simulado CLI" } }
            }

            $resultado = Executar-Endpoint -Ep $epNome -Data $dados
            Write-Host "`n[RESPOSTA] " -ForegroundColor Green
            if ($resultado) { $resultado | ConvertTo-Json -Depth 5 | Write-Host }
            else { Write-Host "(sem conteudo)" -ForegroundColor DarkGray }
        } catch {
            Write-Host "`n[ERRO] $($_.Exception.Message)" -ForegroundColor Red
        }
        Write-Host "`nPressione ENTER para continuar..."
        $null = Read-Host
    }
} else {
    try {
        $resultado = Executar-Endpoint -Ep $Endpoint -Data $Payload
        if ($resultado) { $resultado | ConvertTo-Json -Depth 5 }
        else { Write-Host "Operacao concluida." -ForegroundColor Green }
    } catch {
        Write-Host "[ERRO] $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}