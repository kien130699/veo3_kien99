@echo off
setlocal
cd /d "%~dp0"
py -3 APPLY_HOTFIX.py
if errorlevel 1 python APPLY_HOTFIX.py
pause
