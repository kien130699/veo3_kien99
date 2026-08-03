$Edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$Profile = "C:\temp\edge-debug-9223"
if (-not (Test-Path $Edge)) { throw "Edge not found: $Edge" }
Start-Process -FilePath $Edge -ArgumentList @(
  "--remote-debugging-address=127.0.0.1",
  "--remote-debugging-port=9223",
  "--user-data-dir=$Profile",
  "--new-window",
  "--flag-switches-begin",
  "--flag-switches-end",
  "https://labs.google/fx/tools/flow"
)
