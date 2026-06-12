#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    [ -x "$candidate" ] && NODE_BIN="$candidate" && break
  done
fi
if [ -z "$NODE_BIN" ]; then
  echo "node not found. Install Node.js first." >&2
  exit 1
fi

LABEL="com.trackoor.watcher"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/.trackoor"
mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$REPO_DIR/scripts/track-global.mjs</string>
    <string>--watch</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$REPO_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/watcher.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/watcher.log</string>
</dict>
</plist>
PLIST_EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

sleep 2
if launchctl list | grep -q "$LABEL"; then
  echo "Trackoor watcher installed and running."
  echo "It starts at login, restarts if it stops, and logs to $LOG_DIR/watcher.log."
  echo "Privacy boundary: metadata only. No diffs, commit messages, prompts, or transcripts."
else
  echo "Install completed but the agent is not listed yet. Check $LOG_DIR/watcher.log." >&2
fi
