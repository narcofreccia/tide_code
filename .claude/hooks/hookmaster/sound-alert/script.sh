#!/usr/bin/env bash
# HookMaster — Sound Alert on Notification
# Event: Notification

set -euo pipefail

# macOS
if command -v afplay &>/dev/null; then
  afplay /System/Library/Sounds/Ping.aiff &
# Linux
elif command -v paplay &>/dev/null; then
  paplay /usr/share/sounds/freedesktop/stereo/message.oga 2>/dev/null &
elif command -v aplay &>/dev/null; then
  aplay /usr/share/sounds/sound-icons/prompt.wav 2>/dev/null &
fi

exit 0
