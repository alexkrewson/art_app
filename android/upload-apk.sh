#!/usr/bin/env bash
# Uploads a completed APK to Google Drive via rclone. Wired into build.gradle
# as a doLast on assembleDebug/assembleRelease — runs automatically after each build.
set -euo pipefail

APK_PATH="$1"
REMOTE="gdrive"
DEST="AndroidBuilds/art/"

if ! command -v rclone >/dev/null 2>&1; then
    echo "upload-apk.sh: rclone not found on PATH, skipping upload" >&2
    exit 0
fi

if ! rclone listremotes 2>/dev/null | grep -q "^${REMOTE}:$"; then
    echo "upload-apk.sh: rclone remote '${REMOTE}' not configured yet (run: rclone config), skipping upload" >&2
    exit 0
fi

echo "upload-apk.sh: uploading $APK_PATH to ${REMOTE}:${DEST}"
rclone copy "$APK_PATH" "${REMOTE}:${DEST}" --progress
