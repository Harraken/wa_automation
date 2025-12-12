# Script pour fixer le VNC dans le conteneur
param(
    [string]$ContainerName = $args[0]
)

if (-not $ContainerName) {
    Write-Host "Usage: .\scripts\fix-vnc.ps1 <container-name>"
    Write-Host "Exemple: .\scripts\fix-vnc.ps1 wa-emulator-cmhb54f050000a21sqmk9jjki"
    exit 1
}

Write-Host "🔧 Tentative de réparation du VNC pour le conteneur: $ContainerName"

# Entrer dans le conteneur et démarrer noVNC manuellement
Write-Host "📦 Accès au conteneur..."
docker exec -it $ContainerName bash -c "
    # Vérifier si noVNC est installé
    if command -v websockify &> /dev/null; then
        echo '✅ websockify trouvé'
        # Trouver le port VNC (généralement 5900)
        VNC_PORT=5900
        if [ -f /root/.vnc/*.pid ]; then
            echo '✅ VNC server trouvé'
        else
            echo '⚠️ VNC server non trouvé, tentative de démarrage...'
        fi
        
        # Démarrer noVNC sur le port 6080
        echo '🚀 Démarrage de noVNC sur le port 6080...'
        nohup websockify --web=/usr/share/novnc/ 6080 localhost:5900 > /tmp/novnc.log 2>&1 &
        echo '✅ noVNC démarré'
        echo '📋 Logs disponibles dans /tmp/novnc.log'
    else
        echo '❌ websockify non trouvé, installation en cours...'
        apt-get update && apt-get install -y novnc websockify
        websockify --web=/usr/share/novnc/ 6080 localhost:5900 &
    fi
"

Write-Host ""
Write-Host "✅ VNC devrait maintenant être accessible"
Write-Host "🌐 Essayez d'ouvrir: http://localhost:5901/vnc.html"
Write-Host ""
Write-Host "Pour vérifier les logs du conteneur:"
Write-Host "  docker logs $ContainerName --tail=50"


