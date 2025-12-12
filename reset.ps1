# Script pour reset complet du projet
# Supprime tout : conteneurs, volumes, images, et redémarre

$ErrorActionPreference = "Stop"

Write-Host "⚠️  RESET COMPLET DU PROJET" -ForegroundColor Red
Write-Host "Ceci va supprimer:" -ForegroundColor Yellow
Write-Host "  - Tous les conteneurs" -ForegroundColor Yellow
Write-Host "  - Tous les volumes (base de données incluse)" -ForegroundColor Yellow
Write-Host "  - Toutes les images Docker" -ForegroundColor Yellow
Write-Host ""

$confirmation = Read-Host "Êtes-vous sûr ? (oui/non)"
if ($confirmation -ne "oui") {
    Write-Host "❌ Reset annulé" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Suppression de tous les conteneurs, volumes et images..." -ForegroundColor Cyan
docker-compose down --volumes --rmi all

if ($LASTEXITCODE -ne 0) {
    Write-Host "Erreur lors du down" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Reset termine!" -ForegroundColor Green
Write-Host "Pour redemarrer : .\up.ps1 --build" -ForegroundColor Yellow

