@echo off
title AURA Server  (keep open)
cd /d "%~dp0backend"
call .\venv\Scripts\activate
echo ============================================================
echo   AURA server is starting on port 8000...
echo   Keep THIS window open. Close it to stop AURA.
echo ============================================================
echo.
uvicorn main:app --host 0.0.0.0 --port 8000
echo.
echo *** The server stopped. Read any error above. ***
pause
