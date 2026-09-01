@echo off
setlocal
cd /d "%~dp0"
title Auto Codex Local

if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%APPDATA%\npm" set "PATH=%APPDATA%\npm;%PATH%"

powershell.exe -NoLogo -NoProfile -NonInteractive -Command "try { $health = Invoke-RestMethod 'http://127.0.0.1:4781/healthz' -TimeoutSec 1 } catch { exit 1 }; try { $page = Invoke-WebRequest 'http://127.0.0.1:4781/' -UseBasicParsing -TimeoutSec 1; if ($page.Content -match 'id=[\"'']root[\"'']') { exit 0 } } catch {}; exit 2"
set "AUTO_CODEX_SERVER_STATE=%ERRORLEVEL%"
if "%AUTO_CODEX_SERVER_STATE%"=="0" (
  echo [Auto Codex] The production server is already running. Opening it now.
  explorer.exe "http://127.0.0.1:4781/"
  exit /b 0
)
if "%AUTO_CODEX_SERVER_STATE%"=="2" (
  echo [Auto Codex] The development server is already running. Opening it now.
  explorer.exe "http://127.0.0.1:4780/"
  exit /b 0
)

where node >nul 2>&1
if errorlevel 1 (
  echo [Auto Codex] Node.js 20 or newer is required.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)

set "CODEX_BIN="
for /f "usebackq delims=" %%I in (`powershell.exe -NoLogo -NoProfile -NonInteractive -Command "$binRoot = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'; Get-ChildItem -LiteralPath $binRoot -Filter codex.exe -Recurse -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName"`) do if not defined CODEX_BIN set "CODEX_BIN=%%I"
if not defined CODEX_BIN if exist "%APPDATA%\npm\codex.cmd" set "CODEX_BIN=%APPDATA%\npm\codex.cmd"
if not defined CODEX_BIN (
  for /f "delims=" %%I in ('where codex 2^>nul') do if not defined CODEX_BIN set "CODEX_BIN=%%I"
)
if not defined CODEX_BIN (
  echo [Auto Codex] Codex CLI was not found in PATH.
  echo Install and sign in to Codex CLI, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\react\package.json" (
  echo [Auto Codex] Installing local dependencies...
  call npm install --cache .npm-cache
  if errorlevel 1 (
    echo [Auto Codex] Dependency installation failed.
    pause
    exit /b 1
  )
)

echo [Auto Codex] Starting local bridge and opening the dashboard...
echo Keep this window open while you use Auto Codex.
call npm run launch

if errorlevel 1 (
  echo.
  echo [Auto Codex] The local server stopped with an error.
  pause
  exit /b 1
)
