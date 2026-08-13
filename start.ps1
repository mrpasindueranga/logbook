# start.ps1 - build and start the full Logbook Docker stack (app, redis, minio, nginx).
# Postgres stays on the host (see README) - make sure it's running before this.
$ErrorActionPreference = "Stop"

docker compose up -d --build

Write-Host ""
Write-Host "Logbook stack started" -ForegroundColor Green
Write-Host "  App:   http://localhost:3737"
Write-Host "  HTTPS: https://logbook.local (requires nginx/certs - see README's HTTPS section)"
