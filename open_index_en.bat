@echo off
title Orthodontic Design Software Launcher
echo.
echo ========================================
echo   Orthodontic Design Software Launcher
echo ========================================
echo.
echo Starting up, please wait...

REM Change to script directory
cd /d "%~dp0"
echo [INFO] Current directory: %CD%

REM Check if index.html exists
if not exist "index.html" (
    echo [ERROR] index.html not found!
    echo Current directory: %CD%
    echo Please ensure the script is in the same directory as index.html
    echo.
    echo Directory contents:
    dir /b
    echo.
    echo Press any key to exit...
    pause >nul
    exit /b 1
)

REM Check if src directory exists
if not exist "src" (
    echo [WARNING] src directory not found!
    echo Please ensure src directory exists and contains main.js file.
    echo.
    pause
)

REM Check Node.js installation
echo [CHECK] Detecting Node.js environment...
node --version >nul 2>&1
if %errorlevel% equ 0 (
    echo [SUCCESS] Node.js environment detected
    echo [START] Using Node.js to start local server
    echo [URL] http://localhost:8000
    echo [TIP] Press Ctrl+C to stop server
    echo.
    echo Starting server, please wait...
    echo If no response for a long time, please check network connection...
    echo.
    echo Press any key to start server...
    pause >nul
    echo Installing http-server package, please wait...
    npx http-server -p 8000 -o --cors --gzip
    echo.
    echo Server stopped
    echo Press any key to exit...
    pause >nul
) else (
    echo [ERROR] Node.js not found!
    echo.
    echo Please install Node.js:
    echo.
    echo [DOWNLOAD] Node.js:
    echo   Download: https://nodejs.org/
    echo   Restart this script after installation
    echo.
    echo [ALTERNATIVE] VS Code Live Server extension:
    echo   Install Live Server extension in VS Code
    echo   Right-click index.html and select "Open with Live Server"
    echo.
    echo Press any key to exit...
    pause >nul
    exit /b 1
)
