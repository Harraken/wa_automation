# Script pour démarrer le projet avec cache busting automatique
# Usage: .\up.ps1 [options docker-compose]
# Exemples:
#   .\up.ps1                    # Démarre tous les services
#   .\up.ps1 -d                 # Démarre en mode détaché
#   .\up.ps1 --build            # Force le rebuild
#   .\up.ps1 -d --build         # Rebuild + mode détaché

$ErrorActionPreference = "Stop"

# Générer un cache bust unique (timestamp)
$CACHE_BUST = [int][double]::Parse((Get-Date -UFormat %s))

Write-Host "🚀 Starting WhatsApp Automation System" -ForegroundColor Cyan
Write-Host "📦 CACHE_BUST=$CACHE_BUST (ensures code changes are included)" -ForegroundColor Yellow

# Définir la variable d'environnement pour cette session
$env:CACHE_BUST = $CACHE_BUST

# Construire les arguments pour docker-compose
$upArgs = @("up") + $args

# Vérifier si --build est déjà présent
$hasBuildFlag = $args -contains "--build" -or $args -contains "-b"

# Si aucun argument n'est fourni, ajouter -d par défaut
if ($args.Count -eq 0) {
    Write-Host "💡 No arguments provided, starting in detached mode (-d)" -ForegroundColor Yellow
    $upArgs += "-d"
}

# Exécuter docker-compose up
Write-Host "🔨 Executing: docker-compose $($upArgs -join ' ')" -ForegroundColor Green
& docker-compose $upArgs

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Services started successfully!" -ForegroundColor Green
    Write-Host "View logs: docker-compose logs -f" -ForegroundColor Yellow
    Write-Host "Frontend: http://localhost:5173" -ForegroundColor Yellow
    Write-Host "API: http://localhost:3000" -ForegroundColor Yellow
    Write-Host "Stop: docker-compose down" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "Failed to start services (exit code $LASTEXITCODE)" -ForegroundColor Red
    exit $LASTEXITCODE
}

