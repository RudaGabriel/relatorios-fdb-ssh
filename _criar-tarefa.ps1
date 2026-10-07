# =============================================================================
# _criar-tarefa.ps1                                                   v1.0.0
# Autor: Ruda Gabriel
# -----------------------------------------------------------------------------
# Auxiliar do instalar-na-inicializacao.bat (nao precisa ser executado direto).
# Cria (ou recria) a tarefa agendada que inicia o relatorio, com a
# configuracao completa - o "schtasks /create" nao consegue definir metade
# destas opcoes:
#
#   Disparadores:  "Ao fazer logon" de QUALQUER usuario  +  "Ao inicializar"
#   Condicoes:     todas desmarcadas (sem ocioso, sem exigir energia AC, sem
#                  reativar o computador, sem exigir rede)
#   Configuracoes: executar por demanda; executar o mais cedo possivel se uma
#                  inicializacao agendada foi perdida; se falhar, reiniciar a
#                  cada 1 minuto ate 99 vezes; SEM limite de tempo de execucao;
#                  forcar a interrupcao se nao parar quando solicitado; nunca
#                  excluir; se ja estiver rodando, nao iniciar outra instancia.
#
# Roda como o usuario que instalou, "somente quando conectado" (Interactive):
# o icone da bandeja precisa da area de trabalho. Por isso o disparador "Ao
# inicializar" so' consegue abrir o tray quando ja ha sessao (logon automatico);
# sem sessao, o disparador "Ao fazer logon" cobre assim que alguem entrar. Os
# dois disparando juntos nao duplicam nada: "nao iniciar outra instancia" na
# tarefa e o mutex do proprio tray garantem uma unica copia.
#
# Codigo de saida: 0 = criada e conferida, 1 = falhou (o .bat cai no schtasks).
#
# CHANGELOG 1.0.0 - 2026-10-07 10:00 - Primeira versao.
# =============================================================================

param(
    [Parameter(Mandatory = $true)][string]$Nome,
    [Parameter(Mandatory = $true)][string]$Bootstrap,
    [string]$Usuario = ''
)

$ErrorActionPreference = 'Stop'

try {
    if (-not (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)) {
        throw 'modulo ScheduledTasks indisponivel neste Windows'
    }
    if (-not (Test-Path -LiteralPath $Bootstrap)) { throw "bootstrap nao encontrado: $Bootstrap" }
    if (-not $Usuario) {
        $Usuario = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }
    }

    $acao = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $Bootstrap + '"')

    # -AtLogOn sem -User = "Quando qualquer usuario fizer logon".
    $gatilhos = @(
        (New-ScheduledTaskTrigger -AtLogOn),
        (New-ScheduledTaskTrigger -AtStartup)
    )

    $principal = New-ScheduledTaskPrincipal -UserId $Usuario -LogonType Interactive -RunLevel Limited

    # Padroes que ja atendem e por isso nao aparecem aqui: executar por demanda
    # (AllowDemandStart), forcar interrupcao (AllowHardTerminate), sem
    # condicao de ocioso, sem reativar o computador, sem exigir rede, sem
    # exclusao automatica.
    $cfg = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RestartCount 99 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -MultipleInstances IgnoreNew

    $tarefa = New-ScheduledTask -Action $acao -Trigger $gatilhos -Principal $principal -Settings $cfg `
        -Description 'Inicia o servidor de relatorios (icone na bandeja) no logon e ao ligar o computador. Criada por instalar-na-inicializacao.bat.'

    Register-ScheduledTask -TaskName $Nome -InputObject $tarefa -Force | Out-Null

    # Confere o que ficou gravado (nao confia so' no retorno do Register).
    $t = Get-ScheduledTask -TaskName $Nome
    $tipos = @($t.Triggers | ForEach-Object { $_.CimClass.CimClassName })
    if (-not ($tipos -contains 'MSFT_TaskLogonTrigger') -or -not ($tipos -contains 'MSFT_TaskBootTrigger')) {
        throw "disparadores gravados incompletos: $($tipos -join ', ')"
    }
    $s = $t.Settings
    if ($s.DisallowStartIfOnBatteries -or $s.RestartCount -ne 99 -or $s.ExecutionTimeLimit -ne 'PT0S') {
        throw 'configuracoes gravadas diferentes do esperado'
    }

    Write-Output "  [OK] Tarefa '$Nome': ao fazer logon (qualquer usuario) e ao inicializar;"
    Write-Output '       sem condicoes; reinicia a cada 1 min (ate 99x); sem limite de tempo.'
    exit 0
} catch {
    Write-Output "  [AVISO] Configuracao completa da tarefa falhou: $($_.Exception.Message)"
    exit 1
}
