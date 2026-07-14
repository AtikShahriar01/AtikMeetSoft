' AtikMeet Background Server - Dynamic Silent Starter
' Resolves paths dynamically relative to the script location.

Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' Get the directory path of the current VBScript file
scriptPath = objFSO.GetParentFolderName(WScript.ScriptFullName)
objShell.CurrentDirectory = scriptPath

' Run server-standalone.js silently using the system's global node executable
' (To use a local portable node, place it inside a "node" folder and change "node" below to ".\node\node.exe")
objShell.Run "cmd.exe /c node server-standalone.js", 0, False
