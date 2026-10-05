@echo off
setlocal enabledelayedexpansion
:: =========================================================
::  executar-testes.bat                                v1.0.0
::  Autor: Ruda Gabriel
::  Roda a bateria de testes automaticos do sistema (servidor
::  e gerador de relatorio) usando o Firebird SIMULADO de
::  test\mock-firebird - nao precisa de banco real, nao altera
::  config.json nem nenhum arquivo da loja (cada teste roda numa
::  pasta temporaria propria).
::
::  Uso: duplo clique, ou "test\executar-testes.bat" de qualquer
::  pasta. Codigo de saida: 0 = tudo passou, 1 = falha/erro.
::
::  CHANGELOG 1.0.0 - 2026-10-05 22:15 - Substitui o antigo
::   bateria-de-testes.bat ("node relatorio.test" + pause), que so'
::   funcionava se executado de dentro da pasta test, nao conferia
::   o Node.js e nao usava o executor de testes do Node (node --test),
::   entao nao mostrava o resumo de aprovados/reprovados nem
::   devolvia codigo de saida. Mantem CRLF - edite com editor que
::   preserve CRLF.
:: =========================================================

:: Saida dos testes tem acentos: UTF-8 no console.
chcp 65001 >nul 2>&1
title Relatorios - Bateria de testes

:: Sempre a partir da raiz do projeto (pasta acima de "test"),
:: qualquer que seja a pasta de onde o .bat foi chamado.
pushd "%~dp0.." 2>nul
if errorlevel 1 (
    echo.
    echo  [ERRO] Nao foi possivel acessar a pasta do projeto: %~dp0..
    goto :fim_erro
)

if not exist "test\relatorio.test.js" (
    echo.
    echo  [ERRO] test\relatorio.test.js nao encontrado em:
    echo    %CD%
    echo  Verifique se a pasta do sistema esta completa.
    goto :fim_erro
)

:: Node.js instalado e no PATH?
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [ERRO] Node.js nao encontrado no PATH.
    echo  Instale com gerar_relatorio_do_dia.bat ou em https://nodejs.org
    goto :fim_erro
)

:: Versao minima 18 (executor "node --test" e "fetch" usados nos testes).
set "NODE_VER="
for /f "tokens=*" %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"
set "NODE_MAJOR="
for /f "tokens=1 delims=." %%m in ("!NODE_VER:v=!") do set "NODE_MAJOR=%%m"
if not defined NODE_MAJOR (
    echo.
    echo  [ERRO] Nao foi possivel identificar a versao do Node.js.
    goto :fim_erro
)
if !NODE_MAJOR! LSS 18 (
    echo.
    echo  [ERRO] Node.js !NODE_VER! e antigo demais - os testes exigem a versao 18 ou superior.
    goto :fim_erro
)

echo.
echo  =======================================================
echo    Bateria de testes - Node.js !NODE_VER!
echo    Pasta: %CD%
echo  =======================================================
echo.

node --test "test\relatorio.test.js"
set "RESULTADO=!errorlevel!"

echo.
if "!RESULTADO!"=="0" (
    echo  [OK] Todos os testes passaram.
) else (
    echo  [FALHA] Um ou mais testes falharam - veja os detalhes acima.
)
popd
echo.
pause
exit /b !RESULTADO!

:fim_erro
popd 2>nul
echo.
pause
exit /b 1
