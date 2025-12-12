#!/bin/bash
# Script pour reset complet du projet
# Supprime tout : conteneurs, volumes, images, et redémarre

set -e

echo "⚠️  RESET COMPLET DU PROJET"
echo "Ceci va supprimer:"
echo "  - Tous les conteneurs"
echo "  - Tous les volumes (base de données incluse)"
echo "  - Toutes les images Docker"
echo ""

read -p "Êtes-vous sûr ? (oui/non) " confirmation
if [ "$confirmation" != "oui" ]; then
    echo "❌ Reset annulé"
    exit 0
fi

echo ""
echo "🗑️  Suppression de tous les conteneurs, volumes et images..."
docker-compose down --volumes --rmi all

echo ""
echo "✅ Reset terminé!"
echo "💡 Pour redémarrer : ./up.sh --build"

