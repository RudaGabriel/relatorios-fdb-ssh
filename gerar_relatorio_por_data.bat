@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: =========================================================
::  Relatorio por Data Especifica
::  - Verifica / instala Node.js automaticamente
::  - Verifica / instala modulo node-firebird automaticamente
::  - Inicia servidor se necessario
::  - Abre relatorio no navegador
:: =========================================================

call :verificar_node
if %errorlevel% neq 0 exit /b 1

call :verificar_modulos
if %errorlevel% neq 0 exit /b 1

:: Ano padrao
for /f "tokens=2 delims==" %%a in ('wmic os get LocalDateTime /value ^| find "="') do set "LDT=%%a"
set "ANO_PADRAO=!LDT:~0,4!"
if not defined ANO_PADRAO set "ANO_PADRAO=2026"

set "DATAIN="
set /p DATAIN=Data (D/M ou DD/MM) [ano=%ANO_PADRAO%]: 
if "!DATAIN!"=="" exit /b 1

set "DATAIN=!DATAIN: =!"
set "DATAIN=!DATAIN:-=/!"

for /f "tokens=1-3 delims=/" %%a in ("!DATAIN!") do (
    set "D=%%a"
    set "M=%%b"
    set "Y=%%c"
)
if not defined D goto :invalida
if not defined M goto :invalida
if not defined Y set "Y=!ANO_PADRAO!"
if "!D:~1,1!"=="" set "D=0!D!"
if "!M:~1,1!"=="" set "M=0!M!"

set "ISO=!Y!-!M!-!D!"
echo.
echo  Data: !D!/!M!/!Y!

:: Garante que o servidor esta rodando
call :iniciar_servidor

:: Abre URL com & de forma segura via PowerShell
set "_TMPURL=%TEMP%\_rel_url_%RANDOM%.txt"
set "_ISO=!ISO!"
powershell -NoProfile -Command "$d='!_ISO!'; Set-Content -Path '!_TMPURL!' -Value ('http://localhost:7734/periodo?i='+$d+'&f='+$d) -Encoding UTF8"
powershell -NoProfile -Command "$u=(Get-Content '!_TMPURL!' -Encoding UTF8 | Select-Object -First 1).Trim(); Start-Process $u"
del "!_TMPURL!" >nul 2>&1
exit /b 0

:invalida
echo  Data invalida. Use DD/MM ou DD/MM/AAAA.
pause
exit /b 1

:: -------------------------------------------------------
:iniciar_servidor
powershell -NoProfile -Command ^
    "try{$t=New-Object Net.Sockets.TcpClient;$ok=$t.ConnectAsync('127.0.0.1',7734).Wait(1500);$t.Close();if($ok){exit 0}else{exit 1}}catch{exit 1}" >nul 2>&1
if %errorlevel% equ 0 exit /b 0

echo  Iniciando servidor de relatorios...
start "" wscript.exe "%~dp0launcher.vbs"

set "_t=0"
:_loop_ini
set /a "_t+=1"
if %_t% gtr 30 exit /b 0
powershell -NoProfile -Command ^
    "try{$t=New-Object Net.Sockets.TcpClient;$ok=$t.ConnectAsync('127.0.0.1',7734).Wait(1500);$t.Close();if($ok){exit 0}else{exit 1}}catch{exit 1}" >nul 2>&1
if %errorlevel% equ 0 exit /b 0
timeout /t 2 /nobreak >nul
goto :_loop_ini

:: -------------------------------------------------------
:: Verifica se node-firebird esta instalado.
:: Se nao estiver, instala via npm.
:: -------------------------------------------------------
:verificar_modulos
node -e "require('node-firebird')" >nul 2>&1
if %errorlevel% equ 0 exit /b 0

echo.
echo  Modulo node-firebird nao encontrado. Instalando...
echo.
pushd "%~dp0"

call npm install node-firebird --prefer-offline >nul 2>&1
if %errorlevel% equ 0 goto :_mod_validar

call npm install node-firebird
if %errorlevel% neq 0 (
    echo.
    echo  ERRO: Falha ao instalar node-firebird.
    echo  Execute node-firebird.bat como Administrador.
    echo.
    popd
    pause
    exit /b 1
)

:_mod_validar
popd
node -e "require('node-firebird')" >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  ERRO: node-firebird instalado mas nao reconhecido nesta sessao.
    echo  Feche e reabra o terminal e tente novamente.
    echo.
    pause
    exit /b 1
)
echo  [OK] node-firebird pronto.
exit /b 0

:: -------------------------------------------------------
:verificar_node
where node >nul 2>&1
if %errorlevel% equ 0 exit /b 0

echo.
echo  Node.js nao encontrado. Instalando...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -NonInteractive ^
    -File "%~dp0_instalar-node.ps1"
if %errorlevel% neq 0 (
    echo.
    echo  ERRO: Falha na instalacao do Node.js.
    echo  Instale manualmente em: https://nodejs.org/en/download
    echo.
    pause
    exit /b 1
)
for /f "usebackq tokens=*" %%P in (
    `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine')"`) do (
    set "PATH=%%P;%PATH%"
)
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  ERRO: Node.js instalado mas nao encontrado no PATH.
    echo  Feche e reabra o terminal e tente novamente.
    echo.
    pause
    exit /b 1
)
exit /b 0