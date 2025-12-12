#!/bin/bash
# Helper script to create a snapshot of an emulator's WhatsApp data

set -e

CONTAINER_ID=${1}
SESSION_ID=${2:-$(date +%s)}
SNAPSHOT_FORMAT=${SNAPSHOT_FORMAT:-tar.gz}
STORAGE_PATH=${STORAGE_PATH:-./data/snapshots}

if [ -z "$CONTAINER_ID" ]; then
  echo "Usage: $0 <container_id> [session_id]"
  exit 1
fi

echo "Creating snapshot for container ${CONTAINER_ID}..."

# Create storage directory
mkdir -p "${STORAGE_PATH}"

SNAPSHOT_NAME="snapshot-${SESSION_ID}-$(date +%s).${SNAPSHOT_FORMAT}"
SNAPSHOT_PATH="${STORAGE_PATH}/${SNAPSHOT_NAME}"
TEMP_DIR="${STORAGE_PATH}/temp-${SESSION_ID}"

# Copy WhatsApp data from container
echo "Copying data from container..."
docker cp "${CONTAINER_ID}:/data/local/tmp/whatsapp" "${TEMP_DIR}" || {
  echo "Warning: Failed to copy from /data/local/tmp/whatsapp, trying alternative path..."
  docker cp "${CONTAINER_ID}:/sdcard/WhatsApp" "${TEMP_DIR}" || {
    echo "Error: Could not find WhatsApp data in container"
    exit 1
  }
}

# Compress
echo "Compressing snapshot..."
tar -czf "${SNAPSHOT_PATH}" -C "${STORAGE_PATH}" "$(basename ${TEMP_DIR})"

# Cleanup
rm -rf "${TEMP_DIR}"

echo ""
echo "Snapshot created successfully!"
echo "Path: ${SNAPSHOT_PATH}"
echo "Size: $(du -h ${SNAPSHOT_PATH} | cut -f1)"






