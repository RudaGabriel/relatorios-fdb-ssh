' =============================================================================
' bootstrap.vbs                                                        v1.2.0
' Autor: Ruda Gabriel
' -----------------------------------------------------------------------------
' Inicializacao automatica do Relatorios FDB.
'
' A tarefa agendada (criada por instalar-na-inicializacao.bat) roda este
' arquivo no logon. Ele le em "launcher.path" (mesma pasta) o caminho do
' launcher.vbs do sistema e o abre. Se a pasta do sistema estiver na rede e
' ainda nao estiver disponivel, tenta de novo a cada 15 segundos por ate
' 30 minutos.
'
' Codigos de saida: 0 = launcher aberto, 2 = launcher.path nao existe,
' 3 = launcher.path vazio, 5 = launcher nao apareceu em 30 minutos.
'
' (Historico completo das versoes: CHANGELOG.md no repositorio.)
' CHANGELOG 1.2.0 - 2026-10-29 - Codigo simplificado e legivel.
'   O Microsoft Defender classificava a versao anterior como
'   "Trojan:Script/ObfusScript.A!ml" (falso positivo do modelo de aprendizado
'   de maquina). Sem ADODB.Stream, sem montar texto com Chr/ChrW e sem
'   "On Error Resume Next" geral: launcher.path agora e' gravado pelo
'   instalador em UTF-16, que o Scripting.FileSystemObject le direto.
' =============================================================================

Option Explicit

Const PARA_LEITURA = 1
Const FORMATO_UNICODE = -1
Const FORMATO_ANSI = 0
Const TENTATIVAS = 120
Const ESPERA_MS = 15000

Dim arquivos, shell, pastaDoBootstrap, arquivoDoCaminho, caminhoDoLauncher, tentativa

Set arquivos = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

pastaDoBootstrap = arquivos.GetParentFolderName(WScript.ScriptFullName)
arquivoDoCaminho = arquivos.BuildPath(pastaDoBootstrap, "launcher.path")

If Not arquivos.FileExists(arquivoDoCaminho) Then
    WScript.Quit 2
End If

caminhoDoLauncher = LerCaminho(arquivoDoCaminho)
If caminhoDoLauncher = "" Then
    WScript.Quit 3
End If

For tentativa = 1 To TENTATIVAS
    If arquivos.FileExists(caminhoDoLauncher) Then
        shell.Run "wscript.exe """ & caminhoDoLauncher & """", 1, False
        WScript.Quit 0
    End If
    WScript.Sleep ESPERA_MS
Next

WScript.Quit 5


' Le a primeira linha de launcher.path. O instalador grava em UTF-16 (marca
' FF FE no inicio); arquivos gravados por versoes antigas estao em ANSI.
Function LerCaminho(caminhoDoArquivo)
    Dim formato, leitor, linha
    formato = FORMATO_ANSI
    If ComecaComMarcaUnicode(caminhoDoArquivo) Then formato = FORMATO_UNICODE

    Set leitor = arquivos.OpenTextFile(caminhoDoArquivo, PARA_LEITURA, False, formato)
    linha = ""
    If Not leitor.AtEndOfStream Then linha = leitor.ReadLine
    leitor.Close

    LerCaminho = Trim(linha)
End Function

Function ComecaComMarcaUnicode(caminhoDoArquivo)
    Dim leitor, inicio
    ComecaComMarcaUnicode = False
    If arquivos.GetFile(caminhoDoArquivo).Size < 2 Then Exit Function

    Set leitor = arquivos.OpenTextFile(caminhoDoArquivo, PARA_LEITURA, False, FORMATO_ANSI)
    inicio = leitor.Read(2)
    leitor.Close

    If Len(inicio) = 2 Then
        ComecaComMarcaUnicode = (Asc(Left(inicio, 1)) = 255 And Asc(Right(inicio, 1)) = 254)
    End If
End Function
