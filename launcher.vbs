Dim sh, fso, dir, ps1, js, wmi, procs, proc
Dim i, maxEspera, intervalo, ps1Ok, jsOk

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir     = fso.GetParentFolderName(WScript.ScriptFullName) & "\"
ps1     = dir & "iniciar-tray.ps1"
js      = dir & "servidor-relatorio.js"

' ---- Aguarda arquivos ficarem acessiveis (rede pode demorar no boot) ----
' Tenta a cada 15 segundos por ate 30 minutos (120 tentativas)
maxEspera = 120
intervalo = 15000
ps1Ok     = False
jsOk      = False

For i = 1 To maxEspera
    On Error Resume Next
    ps1Ok = fso.FileExists(ps1)
    jsOk  = fso.FileExists(js)
    If Err.Number <> 0 Then
        ps1Ok = False
        jsOk  = False
        Err.Clear
    End If
    On Error GoTo 0
    If ps1Ok And jsOk Then Exit For
    WScript.Sleep intervalo
Next

' Apos 30 min tenta mesmo assim (caminho UNC pode ter FileExists impreciso)

' ---- Verificacao de instancia unica via WMI ----
On Error Resume Next
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
If Err.Number = 0 Then
    Set procs = wmi.ExecQuery("SELECT * FROM Win32_Process WHERE Name='powershell.exe'")
    For Each proc In procs
        If InStr(LCase(proc.CommandLine), LCase("iniciar-tray.ps1")) > 0 Then
            WScript.Quit 0
        End If
    Next
End If
On Error GoTo 0

' ---- Inicia o tray (o PS1 tambem aguarda o servidor-relatorio.js internamente) ----
sh.Run "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -NonInteractive -File """ & ps1 & """ --no-browser", 0, False
