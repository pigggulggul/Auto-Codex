@echo off
setlocal
cd /d "%~dp0"
title Auto Codex Local

if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%APPDATA%\npm" set "PATH=%APPDATA%\npm;%PATH%"

echo [Auto Codex] Releasing any previous local bridge or Vite process...
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0tools\release-local-ports.ps1"
if errorlevel 1 (
  echo [Auto Codex] Could not release local ports 4780/4781.
  pause
  exit /b 1
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
