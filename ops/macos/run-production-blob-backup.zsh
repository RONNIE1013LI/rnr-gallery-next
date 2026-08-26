#!/bin/zsh

set -euo pipefail

project_dir=${RNR_PROJECT_DIR:-${0:A:h:h:h}}
destination=${RNR_BLOB_BACKUP_DESTINATION:-"/Volumes/Data/RNR Gallery Backups"}
lock_root="$HOME/Library/Application Support/RNR Next"
lock_file="$lock_root/production-blob-backup.lock"

notify_failure() {
  /usr/bin/osascript -e 'display notification "The encrypted Production Blob backup did not complete. Check the RNR Next backup error log." with title "R&R Gallery backup failed"' >/dev/null 2>&1 || true
}

trap 'backup_exit_code=$?; if (( backup_exit_code != 0 )); then notify_failure; fi' EXIT

if [[ ! -d /Volumes/Data ]]; then
  print -u2 -- "Production Blob backup failed: authorised Time Capsule share is not mounted."
  exit 1
fi

backup_key=$(security find-generic-password -w -s "RNR Gallery Blob Backup Key" -a "backup-encryption")
blob_token=$(security find-generic-password -w -s "RNR Gallery Production Blob Token" -a "production-source")

cd "$project_dir"
mkdir -p "$lock_root"
chmod 700 "$lock_root"
export RNR_BLOB_BACKUP_DESTINATION="$destination"
export RNR_BLOB_BACKUP_KEY_BASE64="$backup_key"
export BLOB_READ_WRITE_TOKEN="$blob_token"
/usr/bin/lockf -s -t 0 -k "$lock_file" \
  ./node_modules/.bin/tsx scripts/backup-production-blob.ts
