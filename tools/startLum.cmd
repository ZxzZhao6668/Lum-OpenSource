@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0startLum.ps1" %*
exit /b %errorlevel%
