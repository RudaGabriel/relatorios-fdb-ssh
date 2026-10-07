' =============================================================================
' bootstrap.vbs                                                        v1.1.0
' Autor: Ruda Gabriel
' -----------------------------------------------------------------------------
' Aguarda ate 30 min (120 x 15s) pelo launcher.vbs e o executa.
'
' POR QUE ESTE ARQUIVO EXISTE COMO ARQUIVO (e nao e' mais gerado):
' Ate a v1.10.2, instalar-na-inicializacao.bat GERAVA este script linha a linha
' com "echo" dentro de um bloco redirecionado. Isso exige escapar ( ) & < > com
' ^ e conviver com as regras de expansao do cmd -- e falhou de tres formas
' diferentes em producao:
'   1. um ")" sem escape fechava o bloco antes da hora e o arquivo saia pela
'      metade (o resto virava comando executado na tela);
'   2. gravado com [Text.Encoding]::UTF8, ganhava BOM e o wscript recusava
'      com "Caractere invalido, Linha 1, Caract. 1" (800A0408);
'   3. escapes vazando produziam "Erro de sintaxe" na linha 6 (800A03EA).
' Copiar um arquivo pronto nao tem escape, nao tem expansao e nao tem encoding
' a definir -- e' a operacao mais simples que resolve o problema, e elimina a
' classe inteira de falhas de uma vez.
'
' O caminho do launcher NAO fica embutido aqui (era ele que exigia geracao
' dinamica). Vem de "launcher.path", um arquivo texto de UMA linha gravado ao
' lado deste, que o instalador escreve com um unico "echo" sem escape nenhum.
'
' (Historico completo das versoes: CHANGELOG.md no repositorio.)
' CHANGELOG 1.1.0 - 2026-10-07 22:30 - launcher.path lido em UTF-8.
'   O instalador roda com "chcp 65001" e grava o arquivo em UTF-8; aqui ele era
'   lido como ANSI, e um caminho com acento (C:\Relatorios com acento, perfil
'   "Joao" com til) nunca era encontrado: o servidor nao subia no logon. Le em
'   UTF-8 (ADODB.Stream) e, se o arquivo nao existir assim, tenta tambem a
'   leitura antiga (ANSI) - cobre launcher.path gravado por versoes anteriores.
' =============================================================================

Option Explicit

Dim fso, sh, pastaAtual, arqPath, vbsPath, maxT, n

On Error Resume Next
Set fso = CreateObject("Scripting.FileSystemObject")
If Err.Number <> 0 Then WScript.Quit 1
Set sh = CreateObject("WScript.Shell")
If Err.Number <> 0 Then WScript.Quit 1
On Error Goto 0

' Le o caminho do launcher a partir de launcher.path (mesma pasta deste script).
pastaAtual = fso.GetParentFolderName(WScript.ScriptFullName)
arqPath = fso.BuildPath(pastaAtual, "launcher.path")

If Not fso.FileExists(arqPath) Then WScript.Quit 2

Dim vbsPathAnsi, vbsPathUtf8, st, txt
On Error Resume Next
vbsPathAnsi = Trim(fso.OpenTextFile(arqPath, 1).ReadLine)
If Err.Number <> 0 Then vbsPathAnsi = ""
Err.Clear
Set st = CreateObject("ADODB.Stream")
If Err.Number = 0 Then
    st.Type = 2
    st.Charset = "utf-8"
    st.Open
    st.LoadFromFile arqPath
    txt = st.ReadText
    st.Close
    If Err.Number = 0 Then
        txt = Replace(txt, ChrW(&HFEFF), "")
        If InStr(txt, vbCr) > 0 Then txt = Left(txt, InStr(txt, vbCr) - 1)
        If InStr(txt, vbLf) > 0 Then txt = Left(txt, InStr(txt, vbLf) - 1)
        vbsPathUtf8 = Trim(txt)
    End If
End If
Err.Clear
On Error Goto 0

If Len(vbsPathUtf8) = 0 And Len(vbsPathAnsi) = 0 Then WScript.Quit 3
If Len(vbsPathUtf8) = 0 Then vbsPathUtf8 = vbsPathAnsi
If Len(vbsPathAnsi) = 0 Then vbsPathAnsi = vbsPathUtf8

' Aguarda o launcher aparecer. A pasta pode ser de rede e ainda nao estar
' montada no momento do logon, por isso a espera longa.
maxT = 120
n = 0
Do While n < maxT
    vbsPath = ""
    If fso.FileExists(vbsPathUtf8) Then
        vbsPath = vbsPathUtf8
    ElseIf fso.FileExists(vbsPathAnsi) Then
        vbsPath = vbsPathAnsi
    End If
    If Len(vbsPath) > 0 Then
        sh.Run "wscript.exe " & Chr(34) & vbsPath & Chr(34), 0, False
        WScript.Quit 0
    End If
    n = n + 1
    WScript.Sleep 15000
Loop

' Esgotou o tempo sem encontrar o launcher.
WScript.Quit 5
