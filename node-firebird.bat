@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: =========================================================
::  Instalador node-firebird
::  - Verifica / instala Node.js automaticamente
::  - Atualiza PATH da sessao para evitar erros pos-instalacao
::  - Executa npm install com validacao de saida
:: =========================================================

call :verificar_node
if %errorlevel% neq 0 (
    echo ERRO CRITICO: Nao foi possivel preparar o ambiente Node.js.
    pause
    exit /b 1
)

echo.
echo Instalando modulo node-firebird...
echo.
call npm i node-firebird
if %errorlevel% neq 0 (
    echo.
    echo ERRO: Falha ao instalar o pacote via npm.
    echo Verifique sua conexao com a internet e as permissoes de rede.
    pause
    exit /b 1
)

echo.
echo node-firebird instalado com sucesso.
echo.
pause
exit /b 0

:: -------------------------------------------------------
:: Sub-rotina: Verificar e instalar Node.js
:: -------------------------------------------------------
:verificar_node
where node >nul 2>&1
if %errorlevel% equ 0 exit /b 0

echo.
echo  Node.js nao encontrado. Iniciando instalacao silenciosa...
echo  (Acompanhe o progresso ou aguarde a finalizacao)
echo.

powershell -NoProfile -ExecutionPolicy Bypass -NonInteractive ^
-File "%~dp0_instalar-node.ps1"

if %errorlevel% neq 0 (
    echo.
    echo  ERRO: O instalador do Node.js retornou falha.
    echo  Log de diagnostico: %TEMP%\node-install-log.txt
    echo  Alternativa manual: https://nodejs.org/en/download
    echo.
    pause
    exit /b 1
)

:: Atualiza PATH da sessao atual para reconhecer o node imediatamente
for /f "usebackq tokens=*" %%P in (
    `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine')"`
) do (
    set "PATH=%%P;%PATH%"
)

:: Validacao pos-instalacao
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  ERRO: Node.js instalado, mas nao detectado no PATH da sessao.
    echo  Feche este terminal, abra um novo e execute novamente.
    echo  Se o problema persistir, reinicie a estacao de trabalho.
    echo.
    pause
    exit /b 1
)

exit /b 0