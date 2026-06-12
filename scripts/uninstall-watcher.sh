#!/bin/bash
set -euo pipefail

LABEL="com.trackoor.watcher"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "Trackoor watcher uninstalled. The audit trail and state in ~/.trackoor were left in place."
