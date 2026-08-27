#!/bin/zsh

set -euo pipefail

runtime_root=${0:A:h:h}
destination=${RNR_BLOB_BACKUP_DESTINATION:-"/Volumes/Data/RNR Gallery Backups"}
active_release_file="$runtime_root/config/active-release"
lock_file="$runtime_root/state/production-blob-backup.lock"
last_success="$runtime_root/state/last-success.json"
node_path="__RNR_NODE_PATH__"

notify_failure() {
  /usr/bin/osascript -e 'display notification "The encrypted Production Blob backup did not complete. Check the R&R Gallery backup error log." with title "R&R Gallery backup failed"' >/dev/null 2>&1 || true
}

trap 'backup_exit_code=$?; if (( backup_exit_code != 0 )); then notify_failure; fi' EXIT

if ! /sbin/mount | /usr/bin/grep -Eq ' on /Volumes/Data \((afpfs|smbfs),'; then
  print -u2 -- "Production Blob backup failed: authorised Time Capsule share is not mounted."
  exit 1
fi
if [[ ! -r "$active_release_file" ]]; then
  print -u2 -- "Production Blob backup failed: installed runtime release is unavailable."
  exit 1
fi

active_release=$(<"$active_release_file")
if [[ ! "$active_release" =~ '^[0-9a-f]{40}$' ]]; then
  print -u2 -- "Production Blob backup failed: installed runtime release is invalid."
  exit 1
fi
backup_executable="$runtime_root/releases/$active_release/backup-production-blob.cjs"
if [[ ! -r "$backup_executable" || ! -x "$node_path" ]]; then
  print -u2 -- "Production Blob backup failed: installed runtime executable is unavailable."
  exit 1
fi

backup_key=$(/usr/bin/security find-generic-password -w -s "RNR Gallery Blob Backup Key" -a "backup-encryption")
blob_token=$(/usr/bin/security find-generic-password -w -s "RNR Gallery Production Blob Token" -a "production-source")

mkdir -p "$runtime_root/state"
chmod 700 "$runtime_root/state"
export RNR_BLOB_BACKUP_DESTINATION="$destination"
export RNR_BLOB_BACKUP_KEY_BASE64="$backup_key"
export RNR_BLOB_BACKUP_LOCK_PATH="$lock_file"
export BLOB_READ_WRITE_TOKEN="$blob_token"

result=$(/usr/bin/lockf -s -t 0 -k "$lock_file" "$node_path" "$backup_executable")
print -r -- "$result"
status_temp="$runtime_root/state/.last-success.$$.tmp"
print -r -- "$result" > "$status_temp"
chmod 600 "$status_temp"
mv -f "$status_temp" "$last_success"
