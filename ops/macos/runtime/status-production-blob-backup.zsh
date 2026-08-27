#!/bin/zsh

set -euo pipefail

runtime_root=${0:A:h:h}
last_success="$runtime_root/state/last-success.json"
error_log="$runtime_root/logs/production-blob-backup.error.log"
node_path="__RNR_NODE_PATH__"

if /sbin/mount | /usr/bin/grep -Eq ' on /Volumes/Data \((afpfs|smbfs),'; then
  destination_status="AVAILABLE"
else
  destination_status="UNAVAILABLE"
fi

print -r -- "Backup destination: $destination_status"
print -r -- "Next scheduled run: daily 05:20"
if [[ -r "$last_success" ]]; then
  "$node_path" -e '
    const fs = require("fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    console.log(`Last successful backup: ${value.runId ?? "UNKNOWN"}`);
    console.log(`Objects backed up: ${value.objects ?? "UNKNOWN"}`);
    console.log(`Objects reused: ${value.reused ?? "UNKNOWN"}`);
  ' "$last_success"
else
  print -r -- "Last successful backup: NONE RECORDED BY INSTALLED RUNTIME"
  print -r -- "Objects backed up: UNKNOWN"
fi
if [[ -s "$error_log" ]]; then
  print -r -- "Last error: $(/usr/bin/tail -n 1 "$error_log")"
else
  print -r -- "Last error: NONE"
fi
