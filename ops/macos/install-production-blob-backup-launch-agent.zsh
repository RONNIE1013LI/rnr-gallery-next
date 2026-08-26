#!/bin/zsh

set -euo pipefail

project_dir=${RNR_PROJECT_DIR:-${0:A:h:h:h}}
template="$project_dir/ops/macos/com.rnr.production-blob-backup.plist.template"
launch_agents="$HOME/Library/LaunchAgents"
logs="$HOME/Library/Logs/RNR Next"
target="$launch_agents/com.rnr.production-blob-backup.plist"

if [[ ! -r "$template" ]]; then
  print -u2 -- "LaunchAgent template is missing."
  exit 1
fi

mkdir -p "$launch_agents" "$logs"
chmod 700 "$logs"
escaped_project=${project_dir//&/&amp;}
escaped_project=${escaped_project//</&lt;}
escaped_project=${escaped_project//>/&gt;}
escaped_logs=${logs//&/&amp;}
escaped_logs=${escaped_logs//</&lt;}
escaped_logs=${escaped_logs//>/&gt;}
sed -e "s|__RNR_PROJECT_DIR__|$escaped_project|g" -e "s|__RNR_LOG_DIR__|$escaped_logs|g" "$template" > "$target"
chmod 600 "$target"
plutil -lint "$target" >/dev/null

launchctl bootout "gui/$(id -u)" "$target" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$target"
launchctl enable "gui/$(id -u)/com.rnr.production-blob-backup"
print -r -- "Production Blob backup LaunchAgent installed."

