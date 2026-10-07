@echo off
setlocal enabledelayedexpansion
:: =========================================================
::  remover-inicializacao.bat                          v1.0.0
::  Autor: Ruda Gabriel
::  Desfaz o instalar-na-inicializacao.bat: remove TUDO o que
::  faz o relatorio iniciar sozinho no logon (tarefa agendada,
::  atalho na pasta Inicializar, chave Run do registro e o
::  bootstrap local em %LOCALAPPDATA%\RelatoriosBootstrap) e
::  pergunta se tambem deve encerrar os processos do relatorio
::  (servidor, icone da bandeja e geracoes em andamento).
::
::  Nao apaga config.json, relatorio.log nem a regra de
::  firewall. Para reativar: instalar-na-inicializacao.bat.
::
::  O trabalho e' feito por _remover-inicializacao.ps1 (mesma
::  pasta): so' pede Administrador (UAC) se algum item exigir.
::  Codigo de saida: 0 = tudo removido, 1 = sobrou pendencia.
::
::  (Historico completo das versoes: CHANGELOG.md no repositorio.)
::  CHANGELOG 1.0.0 - 2026-10-06 10:00 - Primeira versao.
::   Mantem CRLF e somente ASCII - edite com editor que
::   preserve CRLF.
:: =========================================================

chcp 65001 >nul 2>&1
title Relatorios - Remover inicializacao automatica

:: pushd aceita pasta de rede (UNC), cd /d nao.
pushd "%~dp0" 2>nul
if errorlevel 1 (
    echo.
    echo ERRO: nao foi possivel acessar a pasta do script: %~dp0
    echo.
    pause
    exit /b 1
)

if not exist "_remover-inicializacao.ps1" (
    echo.
    echo ERRO: _remover-inicializacao.ps1 nao encontrado em:
    echo   %~dp0
    echo Copie a pasta completa do sistema e tente novamente.
    echo.
    popd
    pause
    exit /b 1
)

echo.
echo =======================================================
echo   Remover inicializacao automatica do relatorio
echo =======================================================
echo.
echo Sera removido tudo o que inicia o relatorio sozinho
echo ao ligar/entrar no Windows:
echo   - tarefa agendada
echo   - atalho na pasta Inicializar e chave Run do registro
echo   - bootstrap local ^(%%LOCALAPPDATA%%\RelatoriosBootstrap^)
echo.
echo Configuracoes ^(config.json^), log e regra de firewall
echo NAO sao apagados.
echo.

:: Pergunta repetida ate uma resposta valida. RESP e' zerada a
:: cada volta: "set /p" com ENTER vazio mantem o valor anterior.
:perguntar
set "RESP="
set /p "RESP=Deseja tambem ENCERRAR todos os processos do relatorio (servidor, icone da bandeja e geracoes em andamento)? [S/N]: "
if not defined RESP goto :perguntar
set "RESP=!RESP:"=!"
if /i "!RESP!"=="S"   goto :resp_sim
if /i "!RESP!"=="SIM" goto :resp_sim
if /i "!RESP!"=="N"   goto :resp_nao
if /i "!RESP!"=="NAO" goto :resp_nao
echo   Responda S ou N.
goto :perguntar

:resp_sim
set "ARG_MATAR=-MatarProcessos"
echo.
echo Os processos do relatorio serao encerrados. Telas de relatorio
echo abertas mostrarao "Servidor de relatorios encerrado".
goto :executar

:resp_nao
set "ARG_MATAR="
echo.
echo Os processos em execucao serao mantidos.

:executar
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_remover-inicializacao.ps1" !ARG_MATAR!
set "COD=!errorlevel!"

:: powershell ausente/bloqueado: errorlevel 9009 ou similar.
if !COD! gtr 1 (
    echo.
    echo ERRO: nao foi possivel executar o PowerShell ^(codigo !COD!^).
    echo Verifique se o PowerShell esta disponivel e nao bloqueado
    echo por politica e tente novamente.
    set "COD=1"
)

echo.
popd
pause
exit /b !COD!
