# Script to build Docker images with cache busting
# This ensures that code changes are ALWAYS picked up

$ErrorActionPreference = "Stop"

# Generate a unique cache bust value (timestamp)
$CACHE_BUST = [int][double]::Parse((Get-Date -UFormat %s))

Write-Host "🔨 Building Docker images with CACHE_BUST=$CACHE_BUST" -ForegroundColor Cyan
Write-Host "📦 This ensures all code changes are included" -ForegroundColor Cyan

# Build all services with the cache bust argument
$buildArgs = @("build", "--build-arg", "CACHE_BUST=$CACHE_BUST") + $args
& docker-compose $buildArgs

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Build complete! All code changes have been included." -ForegroundColor Green
    Write-Host "💡 To start services: docker-compose up -d" -ForegroundColor Yellow
} else {
    Write-Host "❌ Build failed with exit code $LASTEXITCODE" -ForegroundColor Red
    exit $LASTEXITCODE
}

