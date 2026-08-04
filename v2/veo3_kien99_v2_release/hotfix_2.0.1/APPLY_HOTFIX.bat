@echo off
setlocal
cd /d "%~dp0"
set "TARGET=..\veo3_kien99_v2"
if not "%~1"=="" set "TARGET=%~1"
if not exist "%TARGET%\app\main.py" (
  echo KHONG TIM THAY THU MUC V2: %TARGET%
  echo Dung: APPLY_HOTFIX.bat "D:\duong-dan\veo3_kien99_v2"
  exit /b 1
)
xcopy /E /I /Y "app" "%TARGET%\app" >nul
xcopy /E /I /Y "tests" "%TARGET%\tests" >nul
echo Da cap nhat V2.0.1 vao: %TARGET%
echo Hay tat server cu, chay lai run_windows.bat va mo http://127.0.0.1:8766
endlocal
