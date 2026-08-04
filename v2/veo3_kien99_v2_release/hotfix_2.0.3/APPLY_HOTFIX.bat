@echo off
cd /d "%~dp0"
py -3 APPLY_HOTFIX.py || python APPLY_HOTFIX.py
pause
