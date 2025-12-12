#!/bin/bash
# Script pour démarrer le projet avec cache busting automatique
# Usage: ./up.sh [options docker-compose]
# Exemples:
#   ./up.sh                    # Démarre tous les services
#   ./up.sh -d                 # Démarre en mode détaché
#   ./up.sh --build            # Force le rebuild
#   ./up.sh -d --build         # Rebuild + mode détaché

set -e

# Générer un cache bust unique (timestamp)
export CACHE_BUST=$(date +%s)

echo "🚀 Starting WhatsApp Automation System"
echo "📦 CACHE_BUST=$CACHE_BUST (ensures code changes are included)"

# Si aucun argument n'est fourni, ajouter -d par défaut
if [ $# -eq 0 ]; then
    echo "💡 No arguments provided, starting in detached mode (-d)"
    set -- "-d"
fi

# Exécuter docker-compose up
echo "🔨 Executing: docker-compose up $@"
docker-compose up "$@"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Services started successfully!"
    echo "📊 View logs: docker-compose logs -f"
    echo "🌐 Frontend: http://localhost:5173"
    echo "🔧 API: http://localhost:3000"
    echo "🛑 Stop: docker-compose down"
else
    echo ""
    echo "❌ Failed to start services"
    exit 1
fi

