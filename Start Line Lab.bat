@echo off
REM Windows: double-click to launch Cascadia Line Lab
cd /d "%~dp0"
set PORT=5173
where node >nul 2>nul
if %errorlevel%==0 (
  start "" "http://localhost:%PORT%"
  echo Cascadia Line Lab running at http://localhost:%PORT% - close this window to stop.
  node server.js
  goto :eof
)
where py >nul 2>nul
if %errorlevel%==0 (
  start "" "http://localhost:%PORT%"
  echo Cascadia Line Lab running at http://localhost:%PORT% ^(Python^) - close this window to stop.
  py -m http.server %PORT% --bind 127.0.0.1
  goto :eof
)
echo Node.js isn't installed. Get the LTS version from https://nodejs.org, then double-click this file again.
start "" "https://nodejs.org"
pause
