@echo off
chcp 65001 >nul
echo.
echo ╔════════════════════════════════════════════════════╗
echo ║     AtikMeet Server - One-Time Auto Setup         ║
echo ║     Developer: Atik Shahriar                      ║
echo ╚════════════════════════════════════════════════════╝
echo.

:: Check admin rights
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Administrator permission needed!
    echo.
    echo Please RIGHT-CLICK this file and select "Run as Administrator"
    echo.
    pause
    exit /b 1
)

echo [Step 1/4] Adding Firewall rules for port 3478...
netsh advfirewall firewall add rule name="AtikMeet Server TCP" dir=in action=allow protocol=TCP localport=3478 >nul 2>&1
netsh advfirewall firewall add rule name="AtikMeet Server UDP" dir=in action=allow protocol=UDP localport=3478 >nul 2>&1
echo [OK] Firewall port 3478 opened successfully!
echo.

echo [Step 2/4] Adding to Windows Startup (auto-start on boot)...
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
copy /y "e:\google meet\start-server-silent.vbs" "%STARTUP%\AtikMeet-Server.vbs" >nul 2>&1
echo [OK] Server will auto-start when Windows boots!
echo.

echo [Step 3/4] Stopping any existing server...
taskkill /f /fi "WINDOWTITLE eq AtikMeet*" >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3478" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
)
echo [OK] Old server stopped.
echo.

echo [Step 4/4] Starting AtikMeet Background Server NOW...
cd /d "e:\google meet"
start "" wscript "e:\google meet\start-server-silent.vbs"
timeout /t 3 >nul
echo [OK] Server is running in background!
echo.

echo ╔════════════════════════════════════════════════════╗
echo ║                  SETUP COMPLETE!                   ║
echo ║                                                    ║
echo ║  Server is running at: http://192.168.0.101:3478  ║
echo ║  Auto-start: ENABLED (every Windows boot)         ║
echo ║  Firewall:   OPEN (port 3478)                     ║
echo ║                                                    ║
echo ║  Your friends can now connect anytime!             ║
echo ╚════════════════════════════════════════════════════╝
echo.
pause
