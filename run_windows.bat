@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
  set PYTHON=py -3
) else (
  set PYTHON=python
)

if not exist ".venv\Scripts\python.exe" (
  echo [V1] Tao moi truong Python...
  %PYTHON% -m venv .venv || goto :error
)

call ".venv\Scripts\activate.bat" || goto :error
python -m pip install --upgrade pip >nul
python -m pip install -r requirements.txt || goto :error

echo.
echo [V1] Server: http://127.0.0.1:8765
echo [V1] Edge CDP: http://127.0.0.1:9223
echo.
start "" "http://127.0.0.1:8765"
python run.py
goto :eof

:error
echo.
echo Khoi dong that bai. Xem loi phia tren.
pause
exit /b 1
