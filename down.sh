#!/bin/bash
# Script pour arrêter le projet
# Usage: ./down.sh [options]
# Exemples:
#   ./down.sh                    # Arrête les services
#   ./down.sh -v                 # Arrête + supprime les volumes
#   ./down.sh --volumes --rmi all  # Reset complet

set -e

echo "🛑 Stopping WhatsApp Automation System"

# Exécuter docker-compose down
docker-compose down "$@"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Services stopped successfully!"
else
    echo ""
    echo "❌ Failed to stop services"
    exit 1
fi

