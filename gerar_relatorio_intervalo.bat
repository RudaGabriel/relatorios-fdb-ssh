@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: =========================================================
::  Relatorio por Periodo
::  - Verifica / instala Node.js automaticamente
::  - Inicia servidor se necessario
::  - Abre relatorio no navegador
:: =========================================================

call :verificar_node
if %errorlevel% neq 0 exit /b 1

:: Ano padrao
for /f "tokens=2 delims==" %%a in ('wmic os get LocalDateTime /value ^| find "="') do set "LDT=%%a"
set "ANO_PADRAO=!LDT:~0,4!"
if not defined ANO_PADRAO set "ANO_PADRAO=2026"

echo.
echo =======================================================
echo     GERAR RELATORIO POR PERIODO
echo =======================================================
echo.

set "DATA_I="
set /p DATA_I=Data INICIAL (D/M ou DD/MM ou DD/MM/AAAA): 
if "!DATA_I!"=="" exit /b 1
call :ParseData "!DATA_I!" DI MI YI
if "!ERRO!"=="1" goto :data_invalida

set "DATA_F="
set /p DATA_F=Data FINAL   (D/M ou DD/MM ou DD/MM/AAAA): 
if "!DATA_F!"=="" exit /b 1
call :ParseData "!DATA_F!" DF MF YF
if "!ERRO!"=="1" goto :data_invalida

set "ISO_I=!YI!-!MI!-!DI!"
set "ISO_F=!YF!-!MF!-!DF!"

echo.
echo  Periodo: !DI!/!MI!/!YI! ate !DF!/!MF!/!YF!

:: Garante que o servidor esta rodando
call :iniciar_servidor

:: Abre URL com & de forma segura via PowerShell
set "_TMPURL=%TEMP%\_rel_url_%RANDOM%.txt"
set "_ISO_I=!ISO_I!"
set "_ISO_F=!ISO_F!"
powershell -NoProfile -Command "$i='!_ISO_I!'; $f='!_ISO_F!'; Set-Content -Path '!_TMPURL!' -Value ('http://localhost:7734/periodo?i='+$i+'&f='+$f) -Encoding UTF8"
powershell -NoProfile -Command "$u=(Get-Content '!_TMPURL!' -Encoding UTF8 | Select-Object -First 1).Trim(); Start-Process $u"
del "!_TMPURL!" >nul 2>&1
exit /b 0

:data_invalida
echo  Data invalida. Use formatos como 1/3, 01/03, 01/03/2026.
pause
exit /b 1

:: -------------------------------------------------------
:ParseData
set "ERRO=0"
set "INP=%~1"
if "!INP!"=="" (set "ERRO=1" & exit /b)
set "INP=!INP: =!"
set "INP=!INP:-=/!"
for /f "tokens=1-3 delims=/" %%a in ("!INP!") do (
    set "_d=%%a"
    set "_m=%%b"
    set "_y=%%c"
)
if not defined _d (set "ERRO=1" & exit /b)
if not defined _m (set "ERRO=1" & exit /b)
if not defined _y set "_y=!ANO_PADRAO!"
if "!_d:~1,1!"=="" set "_d=0!_d!"
if "!_m:~1,1!"=="" set "_m=0!_m!"
set "%2=!_d!" & set "%3=!_m!" & set "%4=!_y!"
set "_d=" & set "_m=" & set "_y="
exit /b

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