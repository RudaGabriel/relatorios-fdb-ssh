@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: =========================================================
::  Relatorio do Dia
::  - Verifica / instala Node.js automaticamente
::  - Verifica / instala modulo node-firebird automaticamente
::  - Inicia servidor se necessario
::  - Abre relatorio de hoje no navegador
:: =========================================================

call :verificar_node
if %errorlevel% neq 0 exit /b 1

call :verificar_modulos
if %errorlevel% neq 0 exit /b 1

:: Verifica se o servidor ja esta rodando
powershell -NoProfile -Command "try{$t=New-Object Net.Sockets.TcpClient;$t.Connect('127.0.0.1',7734);$t.Close();exit 0}catch{exit 1}" >nul 2>&1
if %errorlevel% equ 0 goto :servidor_pronto

:: Servidor nao esta rodando — inicia
echo Iniciando servidor de relatorios...
wscript.exe "%~dp0launcher.vbs"

:: Aguarda o servidor responder
call :aguardar_servidor

:servidor_pronto
start "" "http://localhost:7734"
exit /b 0

:: -------------------------------------------------------
:aguardar_servidor
set "_t=0"
:_loop
set /a "_t+=1"
if %_t% gtr 15 exit /b 0
timeout /t 2 /nobreak >nul
powershell -NoProfile -Command "try{$t=New-Object Net.Sockets.TcpClient;$t.Connect('127.0.0.1',7734);$t.Close();exit 0}catch{exit 1}" >nul 2>&1
if %errorlevel% neq 0 goto :_loop
exit /b 0

:: -------------------------------------------------------
:: Verifica se node-firebird esta instalado.
:: Se nao estiver, executa npm install diretamente.
:: -------------------------------------------------------
:verificar_modulos
node -e "require('node-firebird')" >nul 2>&1
if %errorlevel% equ 0 exit /b 0

echo.
echo  Modulo node-firebird nao encontrado. Instalando...
echo.
pushd "%~dp0"

:: Tentativa silenciosa primeiro (ideal para uso em producao)
call npm install node-firebird --prefer-offline >nul 2>&1
if %errorlevel% equ 0 goto :_mod_validar

:: Se falhou (sem cache local), instala com saida visivel
call npm install node-firebird
if %errorlevel% neq 0 (
    echo.
    echo  ERRO: Falha ao instalar node-firebird.
    echo  Possiveis causas:
    echo    - Sem acesso a internet
    echo    - Permissao negada em node_modules
    echo  Solucao: execute node-firebird.bat como Administrador.
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
:: Verifica se Node.js esta instalado; se nao, executa o instalador.
:: Atualiza o PATH da sessao atual apos instalar.
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
:: Atualiza PATH da sessao para encontrar o node recem instalado
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