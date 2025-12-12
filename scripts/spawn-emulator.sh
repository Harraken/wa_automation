#!/bin/bash
# Helper script to spawn an emulator container locally for testing

set -e

SESSION_ID=${1:-test-session}
PHONE_NUMBER=${2:-+491234567890}
AGENT_TOKEN=${3:-test-token}
LINK_TO_WEB=${4:-false}

EMULATOR_IMAGE=${EMULATOR_IMAGE:-budtmo/docker-android-x86-9.0}
DOCKER_NETWORK=${DOCKER_NETWORK:-wa-provisioner-network}

# Find available ports
VNC_PORT=$((5900 + RANDOM % 100))
APPIUM_PORT=$((4723 + RANDOM % 100))
ADB_PORT=$((5555 + RANDOM % 100))

CONTAINER_NAME="wa-session-${SESSION_ID}"

echo "Spawning emulator container..."
echo "Session ID: ${SESSION_ID}"
echo "Phone: ${PHONE_NUMBER}"
echo "VNC Port: ${VNC_PORT}"
echo "Appium Port: ${APPIUM_PORT}"

docker run -d \
  --name "${CONTAINER_NAME}" \
  --network "${DOCKER_NETWORK}" \
  -p "${VNC_PORT}:5900" \
  -p "${APPIUM_PORT}:4723" \
  -p "${ADB_PORT}:5555" \
  -e SESSION_ID="${SESSION_ID}" \
  -e PHONE_NUMBER="${PHONE_NUMBER}" \
  -e AGENT_TOKEN="${AGENT_TOKEN}" \
  -e BACKEND_URL="http://api:3000" \
  -e LINK_TO_WEB="${LINK_TO_WEB}" \
  --privileged \
  "${EMULATOR_IMAGE}"

CONTAINER_ID=$(docker ps -qf "name=${CONTAINER_NAME}")

echo ""
echo "Container spawned successfully!"
echo "Container ID: ${CONTAINER_ID}"
echo "Container Name: ${CONTAINER_NAME}"
echo "VNC Stream: vnc://localhost:${VNC_PORT}"
echo ""
echo "To view logs: docker logs -f ${CONTAINER_NAME}"
echo "To stop: docker stop ${CONTAINER_NAME} && docker rm ${CONTAINER_NAME}"






