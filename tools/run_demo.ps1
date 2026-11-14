# Start the DivyaDrishti bridge for a demo: fresh database with the synthetic
# cases, listening on all interfaces so a phone on the same Wi-Fi can reach it.
# Usage (from the repo root):
#   powershell -ExecutionPolicy Bypass -File tools\run_demo.ps1            # same Wi-Fi
#   powershell -ExecutionPolicy Bypass -File tools\run_demo.ps1 -Tunnel    # + Cloudflare quick tunnel (HTTPS for the phone)
# The tunnel needs cloudflared once:  winget install --id Cloudflare.cloudflared
param([int]$Port = 8000, [switch]$Tunnel)
$root = Split-Path $PSScriptRoot -Parent
$env:DD_DB = Join-Path $env:TEMP ("divyadrishti-demo-{0}.db" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL' -and $_.IPAddress -notmatch '^169\.' } |
  Select-Object -First 1).IPAddress
Write-Host ""
Write-Host "  Laptop (portal):  http://localhost:$Port/portal.html"
Write-Host "  Phone, same Wi-Fi: http://${ip}:$Port   (mic/camera need HTTPS: use -Tunnel or the Chrome flag, see docs/PHONE_DEMO_SETUP.md)"
Write-Host "  Lensometry target: http://localhost:$Port/lensometer-target.html (open full screen on the laptop)"
Write-Host "  Database:          $env:DD_DB"
Write-Host ""
Set-Location $root
if ($Tunnel) {
  $cf = Get-Command cloudflared -ErrorAction SilentlyContinue
  if (-not $cf) {
    Write-Host "  cloudflared is not installed. Install it once with: winget install --id Cloudflare.cloudflared" -ForegroundColor Yellow
  } else {
    # The quick tunnel prints an https://....trycloudflare.com address: open that on the phone.
    Start-Process -FilePath $cf.Source -ArgumentList @('tunnel', '--url', "http://localhost:$Port") -NoNewWindow
    Write-Host "  Cloudflare quick tunnel starting: look for the https://....trycloudflare.com line below and open it on the phone." -ForegroundColor Green
  }
}
& "$root\.venv\Scripts\python.exe" -m uvicorn server.app:app --host 0.0.0.0 --port $Port
