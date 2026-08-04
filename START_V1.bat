@echo off
cd /d "%~dp0"
start "Edge CDP 9223" cmd /c "scripts\start_edge_9223.bat"
timeout /t 3 /nobreak >nul
call run_windows.bat
