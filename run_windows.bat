@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  py -3.11 -m venv .venv
  if errorlevel 1 py -3 -m venv .venv
)
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt
where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo.
  echo CANH BAO: Chua tim thay ffmpeg trong PATH.
  echo Cai FFmpeg va them thu muc bin vao PATH truoc khi ghep video.
  echo.
)
python run.py
endlocal
