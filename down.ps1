# Script pour arrêter le projet
# Usage: .\down.ps1 [options]
# Exemples:
#   .\down.ps1                    # Arrête les services
#   .\down.ps1 -v                 # Arrête + supprime les volumes
#   .\down.ps1 --volumes --rmi all  # Reset complet

$ErrorActionPreference = "Stop"

Write-Host "🛑 Stopping WhatsApp Automation System" -ForegroundColor Yellow

# Construire les arguments
$downArgs = @("down") + $args

# Exécuter docker-compose down
& docker-compose $downArgs

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Services stopped successfully!" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "Failed to stop services (exit code $LASTEXITCODE)" -ForegroundColor Red
    exit $LASTEXITCODE
}

