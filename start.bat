@echo off
cd /d "%~dp0"
echo Dancing with the SARs is starting on http://localhost:8765
echo Keep this window open while you use it. Close it to stop.
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8765"
where py >nul 2>nul
if not errorlevel 1 (
  py -m http.server 8765
  goto :eof
)
where python >nul 2>nul
if not errorlevel 1 (
  python -m http.server 8765
  goto :eof
)
echo.
echo Python was not found. Install it from https://www.python.org/downloads/
echo and tick "Add python.exe to PATH" in the installer, then run this file again.
pause
