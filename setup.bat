@echo off
REM ═══════════════════════════════════════════════════════
REM  Neutron Launcher — Windows Setup Script
REM ═══════════════════════════════════════════════════════

echo.
echo  ██████╗ ██╗   ██╗██╗    ██╗ ██████╗ 
echo  ██╔══██╗╚██╗ ██╔╝██║    ██║██╔═══██╗
echo  ██████╔╝ ╚████╔╝ ██║ █╗ ██║██║   ██║
echo  ██╔══██╗  ╚██╔╝  ██║███╗██║██║   ██║
echo  ██║  ██║   ██║   ╚███╔███╔╝╚██████╔╝
echo  ╚═╝  ╚═╝   ╚═╝    ╚══╝╚══╝  ╚═════╝ 
echo.
echo  Neutron Launcher v1.0 — Setup
echo  ─────────────────────────────────────
echo.

REM Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo         Download from: https://nodejs.org/
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo [OK] Node.js %NODE_VER% found

REM Check npm
where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm not found. Reinstall Node.js.
    pause
    exit /b 1
)
echo [OK] npm found

REM Install dependencies
echo.
echo [*] Installing Node.js dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
)
echo [OK] Dependencies installed

REM Check Python (optional)
where python >nul 2>&1
if %ERRORLEVEL% equ 0 (
    for /f "tokens=*" %%i in ('python --version') do set PY_VER=%%i
    echo [OK] %PY_VER% found ^(Python backend available^)
    echo [*] Installing Python dependencies...
    python -m pip install -r backend\requirements.txt --quiet
    echo [OK] Python backend ready
) else (
    echo [WARN] Python not found — Python backend unavailable ^(launcher still works^)
)

REM Create assets directory
if not exist "assets" mkdir assets
echo [OK] Assets directory ready

echo.
echo ═══════════════════════════════════════
echo  Setup complete! Run: npm start
echo ═══════════════════════════════════════
echo.
pause
