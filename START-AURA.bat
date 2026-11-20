@echo off
title AURA
cd /d "%~dp0"

echo ============================================================
echo                    Starting AURA...
echo ============================================================
echo.

REM --- Build the web app once (first run only) -----------------------------
if not exist "frontend\dist\index.html" (
  echo First-time setup: building the app ^(about 1 minute^)...
  pushd frontend
  call npm install
  call npm run build
  popd
  echo.
)

REM --- Find this PC's Wi-Fi address ---------------------------------------
set "LANIP="
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  if not defined LANIP set "LANIP=%%a"
)
set "LANIP=%LANIP: =%"

REM --- Start the server in its own window (simple, reliable) ---------------
start "AURA Server" "%~dp0run-server.bat"
echo Starting server... please wait.
timeout /t 9 /nobreak >nul

REM --- Open the kiosk + portal on THIS PC ---------------------------------
start http://localhost:8000/display
start http://localhost:8000/faculty

cls
echo ============================================================
echo                    AURA is running
echo ============================================================
echo.
echo   ON THIS PC (already opened in your browser):
echo      Kiosk screen :  http://localhost:8000/display
echo      Face avatar  :  http://localhost:8000/face
echo      Instructor   :  http://localhost:8000/faculty
echo      Admin        :  http://localhost:8000/admin
echo.
echo   ON A PHONE (same Wi-Fi as this PC):
echo.
echo        http://%LANIP%:8000/faculty
echo.
echo      ^(Type that into the phone's browser. Add to Home screen
echo       to use it like an app.^)
echo.
echo ============================================================
echo   Keep this window open while using AURA.
echo   To stop AURA: close this window and the "AURA Server" window.
echo ============================================================
echo.
pause
