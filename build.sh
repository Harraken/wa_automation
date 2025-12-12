#!/bin/bash
# Script to build Docker images with cache busting
# This ensures that code changes are ALWAYS picked up

set -e

# Generate a unique cache bust value (timestamp)
CACHE_BUST=$(date +%s)

echo "🔨 Building Docker images with CACHE_BUST=$CACHE_BUST"
echo "📦 This ensures all code changes are included"

# Build all services with the cache bust argument
docker-compose build \
  --build-arg CACHE_BUST=$CACHE_BUST \
  "$@"

echo "✅ Build complete! All code changes have been included."
echo "💡 To start services: docker-compose up -d"

