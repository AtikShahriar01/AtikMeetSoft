' AtikMeet Background Server - Silent Starter
' This script runs the Node.js server silently without showing any console window.
' Place this in Windows Startup folder for auto-start.

Set objShell = CreateObject("WScript.Shell")
objShell.CurrentDirectory = "e:\google meet"
objShell.Run """e:\nodejs\node-v22.16.0-win-x64\node.exe"" ""e:\google meet\server-standalone.js""", 0, False
