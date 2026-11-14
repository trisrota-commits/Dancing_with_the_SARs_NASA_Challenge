@echo off
cd /d "%~dp0"
rem The server opens the browser itself, on the port it really got.
where py >nul 2>nul
if not errorlevel 1 (
  py tools\serve.py
  goto :eof
)
where python >nul 2>nul
if not errorlevel 1 (
  python tools\serve.py
  goto :eof
)
echo.
echo Python was not found. Install it from https://www.python.org/downloads/
echo and tick "Add python.exe to PATH" in the installer, then run this file again.
pause
