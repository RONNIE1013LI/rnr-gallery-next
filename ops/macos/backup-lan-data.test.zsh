#!/bin/zsh

set -euo pipefail

script_dir=${0:A:h}
script_path="$script_dir/backup-lan-data.zsh"
test_root=$(mktemp -d "${TMPDIR:-/tmp}/rnr-next-backup-test.XXXXXX")
trap 'rm -rf "$test_root"' EXIT

env_file="$test_root/.env.lan"
backup_root="$test_root/backups"
gallery_dir="$test_root/gallery"
private_dir="$test_root/private"
command_log="$test_root/docker.log"
mkdir -p "$gallery_dir" "$private_dir"
print -r -- "gallery" > "$gallery_dir/design.webp"
print -r -- "private" > "$private_dir/upload.bin"

print -r -- 'DATABASE_URL=postgresql://backup_user:private-password@127.0.0.1:55443/rnr_test' > "$env_file"
print -r -- "GALLERY_STORAGE_DIR=\"$gallery_dir\"" >> "$env_file"
print -r -- "RNR_PRIVATE_UPLOAD_DIR=\"$private_dir\"" >> "$env_file"

cat > "$test_root/docker" <<'EOF'
#!/bin/zsh
print -r -- "$*" >> "$RNR_TEST_COMMAND_LOG"
case "$1" in
  info) exit 0 ;;
  run)
    if [[ "$*" == *"pg_dump"* ]]; then
      print -r -- "FAKE CUSTOM DATABASE DUMP"
      exit 0
    fi
    if [[ "$*" == *"pg_restore"* ]]; then
      cat >/dev/null
      exit 0
    fi
    ;;
esac
exit 1
EOF
chmod +x "$test_root/docker"

RNR_TEST_COMMAND_LOG="$command_log" \
RNR_NEXT_ENV_FILE="$env_file" \
RNR_PROJECT_DIR="$test_root/project" \
RNR_BACKUP_ROOT="$backup_root" \
RNR_BACKUP_TIMESTAMP="20260805T010203Z" \
RNR_DOCKER_BIN="$test_root/docker" \
zsh "$script_path" >/dev/null

backup_dir="$backup_root/20260805T010203Z"
test -s "$backup_dir/database.dump"
test -s "$backup_dir/gallery.tar.gz"
test -s "$backup_dir/private-uploads.tar.gz"
test -s "$backup_dir/SHA256SUMS"
test -s "$backup_dir/manifest.txt"
(cd "$backup_dir" && shasum -a 256 -c SHA256SUMS >/dev/null)
tar -tzf "$backup_dir/gallery.tar.gz" | grep -Fq './design.webp'
tar -tzf "$backup_dir/private-uploads.tar.gz" | grep -Fq './upload.bin'
grep -Fq -- '-e DATABASE_URL postgres:16-alpine sh -ec' "$command_log"
if grep -Fq 'private-password' "$command_log"; then
  print -u2 -- "Database credentials leaked into the Docker command log."
  exit 1
fi

if RNR_TEST_COMMAND_LOG="$command_log" \
  RNR_NEXT_ENV_FILE="$env_file" \
  RNR_BACKUP_ROOT="$backup_root" \
  RNR_BACKUP_TIMESTAMP="20260805T010203Z" \
  RNR_DOCKER_BIN="$test_root/docker" \
  zsh "$script_path" >/dev/null 2>&1; then
  print -u2 -- "An existing backup destination was overwritten."
  exit 1
fi

print -r -- "PASS: atomic database and asset backup"
