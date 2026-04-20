@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: =========================================================
::  Iniciar Servidor + Tray
::  - Verifica / instala Node.js automaticamente
::  - Nao relanca se servidor E tray ja estiverem rodando
::  - Relanca se somente um deles estiver ativo (ex: tray morreu)
:: =========================================================

call :verificar_node
if %errorlevel% neq 0 exit /b 1

set "_SERVIDOR_OK=0"
set "_TRAY_OK=0"

powershell -NoProfile -Command "try{$t=New-Object Net.Sockets.TcpClient;$t.Connect('127.0.0.1',7734);$t.Close();exit 0}catch{exit 1}" >nul 2>&1
if %errorlevel% equ 0 set "_SERVIDOR_OK=1"

powershell -NoProfile -Command "if((Get-WmiObject Win32_Process -Filter 'Name=""powershell.exe""' -ErrorAction SilentlyContinue)|Where-Object{$_.CommandLine -like '*iniciar-tray.ps1*'}){exit 0}else{exit 1}" >nul 2>&1
if %errorlevel% equ 0 set "_TRAY_OK=1"

if "!_SERVIDOR_OK!"=="1" if "!_TRAY_OK!"=="1" (
    echo Servidor e bandeja ja estao rodando.
    exit /b 0
)

:: Lanca o launcher — ele garante instancia unica de tray internamente via WMI
wscript.exe "%~dp0launcher.vbs"
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