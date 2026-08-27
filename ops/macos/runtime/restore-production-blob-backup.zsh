#!/bin/zsh

set -euo pipefail

runtime_root=${0:A:h:h}
active_release_file="$runtime_root/config/active-release"
node_path="__RNR_NODE_PATH__"

if [[ ! -r "$active_release_file" ]]; then
  print -u2 -- "Production Blob restore failed: installed runtime release is unavailable."
  exit 1
fi
active_release=$(<"$active_release_file")
if [[ ! "$active_release" =~ '^[0-9a-f]{40}$' ]]; then
  print -u2 -- "Production Blob restore failed: installed runtime release is invalid."
  exit 1
fi
restore_executable="$runtime_root/releases/$active_release/restore-production-blob-backup.cjs"
if [[ ! -r "$restore_executable" || ! -x "$node_path" ]]; then
  print -u2 -- "Production Blob restore failed: installed runtime executable is unavailable."
  exit 1
fi

export RNR_BLOB_BACKUP_KEY_BASE64=$(/usr/bin/security find-generic-password -w -s "RNR Gallery Blob Backup Key" -a "backup-encryption")
exec "$node_path" "$restore_executable"
