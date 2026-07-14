@echo off
chcp 65001 >nul
echo.
echo ╔════════════════════════════════════════════════════╗
echo ║   AtikMeet Server - Portable Auto Setup (Admin)   ║
echo ║   Developer: Atik Shahriar                      ║
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

:: Get current folder path dynamically
set "PROJECT_DIR=%~dp0"
:: Remove trailing backslash if exists
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

echo [Step 1/4] Adding Firewall rules for port 3478...
netsh advfirewall firewall add rule name="AtikMeet Server TCP" dir=in action=allow protocol=TCP localport=3478 >nul 2>&1
netsh advfirewall firewall add rule name="AtikMeet Server UDP" dir=in action=allow protocol=UDP localport=3478 >nul 2>&1
echo [OK] Firewall port 3478 opened successfully!
echo.

echo [Step 2/4] Adding to Windows Startup (auto-start on boot)...
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
copy /y "%PROJECT_DIR%\start-server-silent.vbs" "%STARTUP%\AtikMeet-Server.vbs" >nul 2>&1
echo [OK] Server registered to auto-start!
echo.

echo [Step 3/4] Stopping any existing server...
taskkill /f /fi "WINDOWTITLE eq AtikMeet*" >nul 2>&1
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3478" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
)
echo [OK] Old server stopped.
echo.

echo [Step 4/4] Starting AtikMeet Background Server NOW...
cd /d "%PROJECT_DIR%"
start "" wscript "%PROJECT_DIR%\start-server-silent.vbs"
timeout /t 3 >nul
echo [OK] Server is running in background!
echo.

echo ╔════════════════════════════════════════════════════╗
echo ║                  SETUP COMPLETE!                   ║
echo ║                                                    ║
echo ║  Auto-start: ENABLED (every Windows boot)         ║
echo ║  Firewall:   OPEN (port 3478)                     ║
echo ║                                                    ║
echo ║  Your friends can now connect anytime!             ║
echo ╚════════════════════════════════════════════════════╝
echo.
pause
