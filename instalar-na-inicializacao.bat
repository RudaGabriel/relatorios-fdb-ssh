@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo =======================================================
echo   Configurar Inicializacao Automatica
echo =======================================================
echo.
echo Configura o servidor para iniciar automaticamente ao fazer login.
echo O bootstrap fica LOCAL na maquina e aguarda ate 30 min pelo
echo servidor na rede antes de lanca-lo.
echo.

:: ---------------------------------------------------------------------------
:: 1. Verifica / instala Node.js
:: ---------------------------------------------------------------------------
:verificar_node
node --version >nul 2>&1
if %errorlevel% equ 0 goto :node_ok

echo Node.js nao encontrado. Instalando silenciosamente...
echo (acompanhe em %TEMP%\relatorio_node_install.log)
echo.

powershell -NoProfile -ExecutionPolicy Bypass -NonInteractive ^
    -File "%~dp0_instalar-node.ps1"

:: Atualiza PATH da sessao atual
for /f "usebackq tokens=*" %%P in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine')"`) do (
    set "PATH=%%P;%PATH%"
)

node --version >nul 2>&1
if %errorlevel% equ 0 goto :node_ok

echo.
echo ERRO: Node.js nao foi instalado corretamente.
echo Verifique: %TEMP%\relatorio_node_install.log
echo Ou instale em: https://nodejs.org
echo.
pause
exit /b 1

:node_ok
for /f "tokens=*" %%V in ('node --version 2^>nul') do echo Node.js: %%V
echo.

:: ---------------------------------------------------------------------------
:: 2. Le appName do config.json
:: ---------------------------------------------------------------------------
set "CFG=%~dp0config.json"
set "_TMP=%TEMP%\_relcfg_%RANDOM%.txt"
set "APP_NAME="

powershell -NoProfile -Command ^
    "try{(Get-Content '%CFG%' -Raw -Encoding UTF8 | ConvertFrom-Json).appName}catch{''}" ^
    > "!_TMP!" 2>nul
if exist "!_TMP!" ( set /p APP_NAME= < "!_TMP!" & del "!_TMP!" >nul 2>&1 )
set "APP_NAME=!APP_NAME: =!"

if not defined APP_NAME goto :pedir_nome
if "!APP_NAME!"=="" goto :pedir_nome
goto :nome_ok

:pedir_nome
echo Voce ainda nao configurou o nome do sistema.
echo Exemplos: Farmacia Central, Loja Silva, Mercado XYZ
echo.
set "NOVO_NOME="
set /p NOVO_NOME=Nome do sistema: 
if "!NOVO_NOME!"=="" set "NOVO_NOME=Relatorios"

:: Salva appName no config.json via PowerShell (lida com BOM e JSON corrompido)
set "_TMPPS=%TEMP%\_relcfgwrite_%RANDOM%.ps1"
(
    echo $n = '!NOVO_NOME!'
    echo $p = '%CFG%'
    echo $o = @{}
    echo try{
    echo   $raw = [System.IO.File]::ReadAllText($p,[System.Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
    echo   $o = $raw ^| ConvertFrom-Json ^| ForEach-Object{$h=@{};$_.PSObject.Properties^|ForEach-Object{$h[$_.Name]=$_.Value};$h}
    echo }catch{}
    echo $o['appName'] = $n
    echo if(-not $o.ContainsKey('porta')){$o['porta']=7734}
    echo [System.IO.File]::WriteAllText($p,($o^|ConvertTo-Json -Depth 10 -Compress),(New-Object System.Text.UTF8Encoding($false)))
) > "!_TMPPS!"
powershell -NoProfile -ExecutionPolicy Bypass -File "!_TMPPS!" 2>nul
del "!_TMPPS!" >nul 2>&1
set "APP_NAME=!NOVO_NOME!"
echo.

:nome_ok
echo Sistema: !APP_NAME!
echo.

:: ---------------------------------------------------------------------------
:: 3. Gera o bootstrap LOCAL
::    O bootstrap aguarda o launcher.vbs ficar disponível na rede (até 30 min)
::    e então o executa. Fica em %LOCALAPPDATA% — sempre acessível sem rede.
:: ---------------------------------------------------------------------------
set "LAUNCHER_PATH=%~dp0launcher.vbs"
set "TASK_NAME=!APP_NAME! - Relatorios"
set "BOOTSTRAP_DIR=%LOCALAPPDATA%\RelatoriosBootstrap"
set "BOOTSTRAP_FILE=!BOOTSTRAP_DIR!\bootstrap.vbs"

if not exist "!BOOTSTRAP_DIR!" md "!BOOTSTRAP_DIR!" >nul 2>&1

echo Criando bootstrap local em:
echo   !BOOTSTRAP_FILE!
echo.

:: Gera bootstrap.vbs via PowerShell (aspas internas usam Chr(34))
set "_BPS=%TEMP%\_bstrap_%RANDOM%.ps1"
(
    echo $lp  = '!LAUNCHER_PATH!'
    echo $out = '!BOOTSTRAP_FILE!'
    echo $q   = [char]34
    echo $lines = @(
    echo   "' bootstrap.vbs — gerado por instalar-na-inicializacao.bat"
    echo   "' Aguarda ate 30 min (120 x 15s) pelo launcher.vbs na rede e o executa."
    echo   ""
    echo   "Dim vbsPath, maxT, n, fso, sh"
    echo   ("vbsPath = " + $q + $lp + $q)
    echo   ("Set fso = CreateObject(" + $q + "Scripting.FileSystemObject" + $q + ")")
    echo   ("Set sh  = CreateObject(" + $q + "WScript.Shell" + $q + ")")
    echo   "maxT = 120"
    echo   "n    = 0"
    echo   "Do While n < maxT"
    echo   "    If fso.FileExists(vbsPath) Then"
    echo   ("        sh.Run " + $q + "wscript.exe " + $q + " ^& Chr(34) ^& vbsPath ^& Chr(34), 0, False")
    echo   "        WScript.Quit 0"
    echo   "    End If"
    echo   "    n = n + 1"
    echo   "    WScript.Sleep 15000"
    echo   "Loop"
    echo   "WScript.Quit 1"
    echo )
    echo [System.IO.File]::WriteAllLines($out, $lines, [System.Text.Encoding]::UTF8)
) > "!_BPS!"
powershell -NoProfile -ExecutionPolicy Bypass -File "!_BPS!" 2>nul
set "_BPS_ERR=%errorlevel%"
del "!_BPS!" >nul 2>&1

:: Fallback: escrever bootstrap diretamente pelo CMD se PowerShell falhou
if not exist "!BOOTSTRAP_FILE!" goto :bootstrap_fallback
if !_BPS_ERR! neq 0 goto :bootstrap_fallback
goto :bootstrap_ok

:bootstrap_fallback
echo  (PowerShell falhou — usando fallback direto do CMD)
(
    echo ' bootstrap.vbs - gerado por instalar-na-inicializacao.bat
    echo ' Aguarda ate 30 min pelo launcher.vbs na rede.
    echo Dim vbsPath, maxT, n, fso, sh
    echo vbsPath = "!LAUNCHER_PATH!"
    echo Set fso = CreateObject^("Scripting.FileSystemObject"^)
    echo Set sh  = CreateObject^("WScript.Shell"^)
    echo maxT = 120
    echo n    = 0
    echo Do While n ^< maxT
    echo     If fso.FileExists^(vbsPath^) Then
    echo         sh.Run "wscript.exe " ^& Chr^(34^) ^& vbsPath ^& Chr^(34^), 0, False
    echo         WScript.Quit 0
    echo     End If
    echo     n = n + 1
    echo     WScript.Sleep 15000
    echo Loop
    echo WScript.Quit 1
) > "!BOOTSTRAP_FILE!"

:bootstrap_ok
if not exist "!BOOTSTRAP_FILE!" (
    echo ERRO: Nao foi possivel criar o bootstrap local.
    echo Verifique permissoes em: !BOOTSTRAP_DIR!
    pause
    exit /b 1
)
echo Bootstrap criado com sucesso.
echo.

:: ---------------------------------------------------------------------------
:: 4. Registra tarefa agendada apontando para o BOOTSTRAP LOCAL
::    - Nunca falha com "arquivo nao encontrado" (bootstrap é local)
::    - O delay de 2 min dá tempo ao Windows de montar drives de rede
:: ---------------------------------------------------------------------------
schtasks /delete /tn "!TASK_NAME!" /f >nul 2>&1

schtasks /create /tn "!TASK_NAME!" ^
    /tr "wscript.exe \"!BOOTSTRAP_FILE!\"" ^
    /sc ONLOGON /ru "%USERNAME%" /rl LIMITED /delay 0002:00 /f >nul 2>&1

if %errorlevel% equ 0 (
    echo =======================================================
    echo   Sucesso!
    echo =======================================================
    echo.
    echo   Cadeia de inicializacao:
    echo     1. Tarefa agendada ONLOGON + delay 2 min
    echo     2. bootstrap.vbs LOCAL aguarda ate 30 min pelo launcher.vbs na rede
    echo     3. launcher.vbs lanca iniciar-tray.ps1 ^(oculto^)
    echo     4. iniciar-tray.ps1 aguarda ate 30 min pelo servidor-relatorio.js
    echo     5. servidor-relatorio.js aguarda ate 30 min pelo banco Firebird
    echo.
    echo   Bootstrap local ^(tarefa aponta aqui^):
    echo     !BOOTSTRAP_FILE!
    echo.
    echo   Launcher na rede ^(bootstrap espera este^):
    echo     !LAUNCHER_PATH!
    echo.
    echo   Para remover:
    echo     schtasks /delete /tn "!TASK_NAME!" /f
    echo.
    goto :iniciar_agora
)

:: Fallback: atalho na pasta Startup
echo  schtasks falhou. Usando pasta de Inicializacao como fallback...
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=!STARTUP!\!APP_NAME! Relatorios.vbs"

(
    echo Dim sh
    echo Set sh = CreateObject^("WScript.Shell"^)
    echo sh.Run "wscript.exe " ^& Chr^(34^) ^& "!BOOTSTRAP_FILE!" ^& Chr^(34^), 0, False
) > "!SHORTCUT!"

if exist "!SHORTCUT!" (
    echo   Atalho criado em:
    echo     !SHORTCUT!
    echo.
) else (
    echo ERRO: Nao foi possivel configurar a inicializacao automatica.
    echo Tente executar como Administrador.
    pause
    exit /b 1
)

:iniciar_agora
echo Iniciando servidor agora...
wscript.exe "!LAUNCHER_PATH!"
echo.
echo Pronto! O icone aparecera na bandeja em instantes.
echo.
pause
exit /b 0