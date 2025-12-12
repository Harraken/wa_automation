# Script PowerShell pour démarrer un proxy websockify pour un conteneur émulateur
param(
    [Parameter(Mandatory=$true)]
    [string]$EmulatorContainer,
    
    [Parameter(Mandatory=$true)]
    [int]$VncPort
)

Write-Host "🔧 Démarrage du proxy websockify pour le conteneur: $EmulatorContainer"
Write-Host "📡 Port VNC exposé sur l'hôte: $VncPort"

# Nom du conteneur websockify
$WebsockifyContainer = "websockify-$EmulatorContainer"

# Vérifier si un conteneur websockify existe déjà pour cet émulateur
$existing = docker ps -a --filter "name=$WebsockifyContainer" --format "{{.Names}}"
if ($existing) {
    Write-Host "🗑️  Suppression de l'ancien conteneur websockify..."
    docker rm -f $WebsockifyContainer | Out-Null
}

# Démarrer le conteneur websockify
Write-Host "🚀 Démarrage du conteneur websockify..."
docker run -d `
    --name $WebsockifyContainer `
    --network wa-provisioner-network `
    -p "${VncPort}:6080" `
    ghcr.io/novnc/websockify:latest `
    --web /usr/share/novnc `
    6080 `
    "${EmulatorContainer}:5900"

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Proxy websockify démarré avec succès !"
    Write-Host "🌐 Accès: http://localhost:$VncPort/vnc.html"
} else {
    Write-Host "❌ Erreur lors du démarrage du proxy websockify"
    exit 1
}


