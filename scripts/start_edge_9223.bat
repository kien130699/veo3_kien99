@echo off
set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
set "PROFILE=C:\temp\edge-debug-9223"
if not exist "%EDGE%" (
  echo Khong tim thay Edge: %EDGE%
  pause
  exit /b 1
)
start "Edge CDP 9223" "%EDGE%" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9223 --user-data-dir="%PROFILE%" --new-window --flag-switches-begin --flag-switches-end https://labs.google/fx/tools/flow
