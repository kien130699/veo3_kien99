@echo off
setlocal
set "PROFILE=C:\temp\veo3-kien99-v1-edge"
set "EDGE1=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "EDGE2=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if exist "%EDGE1%" set "EDGE=%EDGE1%"
if exist "%EDGE2%" set "EDGE=%EDGE2%"
if not defined EDGE (
  echo Khong tim thay Microsoft Edge.
  pause
  exit /b 1
)

if not exist "%PROFILE%" mkdir "%PROFILE%"
start "" "%EDGE%" --remote-debugging-port=9223 --user-data-dir="%PROFILE%" "https://labs.google/fx/vi/tools/flow?hl=vi"
echo Edge CDP dang mo tai http://127.0.0.1:9223
