@echo off
title Node-Firebird - Instalador de Modulo
setlocal enabledelayedexpansion
cd /d "%~dp0"
chcp 65001 >nul 2>&1

:: =========================================================
::  node-firebird.bat
::  - Verifica / instala Node.js automaticamente
::  - Instala o modulo node-firebird via npm
::  - Tratamento robusto de erros e atualizacao de PATH
:: =========================================================

echo.
echo  [INFO] Verificando ambiente Node.js...
echo.

call :verificar_node
if %errorlevel% neq 0 (
    echo  [ERRO CRITICO] Falha ao preparar ambiente Node.js.
    pause
    exit /b 1
)

:: =========================================================
:: EXIBIR VERSOES CONFIRMADAS
:: =========================================================
for /f "tokens=*" %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"
for /f "tokens=*" %%v in ('npm -v 2^>nul') do set "NPM_VER=%%v"

echo  [OK] Node.js: %NODE_VER%
echo  [OK] NPM: %NPM_VER%
echo.

:: =========================================================
:: INSTALAR MODULO node-firebird
:: =========================================================
echo  [INFO] Instalando modulo node-firebird...

call npm install node-firebird
if %errorlevel% neq 0 (
    echo.
    echo  [ERRO] Falha ao instalar node-firebird.
    echo  Possiveis causas:
    echo   - Sem conexao com a internet
    echo   - Proxy corporativo nao configurado
    echo   - Permissao de escrita negada em node_modules
    echo.
    echo  Solucao manual:
    echo   npm install node-firebird
    echo.
    pause
    exit /b 1
)

echo.
echo  [OK] node-firebird instalado com sucesso.
echo.
pause
exit /b 0

:: -------------------------------------------------------
:: SUB-ROTINA: VERIFICAR E INSTALAR NODE.JS
:: Reutiliza logica padronizada dos demais scripts .bat
:: -------------------------------------------------------
:verificar_node
where node >nul 2>&1
if %errorlevel% equ 0 exit /b 0

echo  [AVISO] Node.js nao detectado no PATH.
echo  [INFO] Iniciando instalacao silenciosa via _instalar-node.ps1...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -NonInteractive ^
-File "%~dp0_instalar-node.ps1"

if %errorlevel% neq 0 (
    echo.
    echo  [ERRO] Instalacao do Node.js falhou.
    echo  [INFO] Log de diagnostico: %TEMP%\node-install-log.txt
    echo  [INFO] Alternativa manual: https://nodejs.org/en/download
    echo.
    pause
    exit /b 1
)

:: Atualiza PATH da sessao atual com valor do PATH do sistema
for /f "usebackq tokens=*" %%P in (
    `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine')"`
) do (
    set "PATH=%%P;%PATH%"
)

:: Validacao pos-instalacao
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [ERRO] Node.js instalado mas nao reconhecido nesta sessao.
    echo  [INFO] Feche este terminal, abra um novo e execute novamente.
    echo.
    pause
    exit /b 1
)

exit /b 0