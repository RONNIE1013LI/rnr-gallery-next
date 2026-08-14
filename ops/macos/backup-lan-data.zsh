#!/bin/zsh

set -euo pipefail

env_file=${RNR_NEXT_ENV_FILE:-"$HOME/Library/Application Support/RNR Next/.env.lan"}
project_dir=${RNR_PROJECT_DIR:-${0:A:h:h:h}}
backup_root=${RNR_BACKUP_ROOT:-"$HOME/Library/Application Support/RNR Next/backups"}
docker_bin=${RNR_DOCKER_BIN:-/usr/local/bin/docker}
postgres_image=${RNR_POSTGRES_IMAGE:-postgres:16-alpine}
timestamp=${RNR_BACKUP_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}

if [[ ! -r "$env_file" ]]; then
  print -u2 -- "R&R Next environment file is missing or unreadable: $env_file"
  exit 1
fi

set -a
source "$env_file"
set +a

if [[ -z ${DATABASE_URL:-} ]]; then
  print -u2 -- "DATABASE_URL is required for backup."
  exit 1
fi

gallery_dir=${GALLERY_STORAGE_DIR:-"$project_dir/.data/gallery"}
private_upload_dir=${RNR_PRIVATE_UPLOAD_DIR:-"$project_dir/.data/private-uploads"}
final_dir="$backup_root/$timestamp"

if [[ -e "$final_dir" ]]; then
  print -u2 -- "Backup destination already exists: $final_dir"
  exit 1
fi

if ! "$docker_bin" info >/dev/null 2>&1; then
  print -u2 -- "Docker is required to create and verify the PostgreSQL backup."
  exit 1
fi

mkdir -p "$backup_root"
chmod 700 "$backup_root"
staging_dir=$(mktemp -d "$backup_root/.rnr-backup.XXXXXX")
cleanup() {
  [[ -n ${staging_dir:-} && -d "$staging_dir" ]] && rm -rf -- "$staging_dir"
}
trap cleanup EXIT

container_database_url=${DATABASE_URL/127.0.0.1/host.docker.internal}
container_database_url=${container_database_url/localhost/host.docker.internal}

DATABASE_URL="$container_database_url" "$docker_bin" run --rm \
  -e DATABASE_URL "$postgres_image" sh -ec \
  'exec pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-privileges' \
  > "$staging_dir/database.dump"

"$docker_bin" run --rm -i "$postgres_image" pg_restore --list \
  < "$staging_dir/database.dump" >/dev/null

if [[ -d "$gallery_dir" ]]; then
  tar -czf "$staging_dir/gallery.tar.gz" -C "$gallery_dir" .
else
  tar -czf "$staging_dir/gallery.tar.gz" -T /dev/null
fi

if [[ -d "$private_upload_dir" ]]; then
  tar -czf "$staging_dir/private-uploads.tar.gz" -C "$private_upload_dir" .
else
  tar -czf "$staging_dir/private-uploads.tar.gz" -T /dev/null
fi

tar -tzf "$staging_dir/gallery.tar.gz" >/dev/null
tar -tzf "$staging_dir/private-uploads.tar.gz" >/dev/null

(
  cd "$staging_dir"
  shasum -a 256 database.dump gallery.tar.gz private-uploads.tar.gz > SHA256SUMS
  shasum -a 256 -c SHA256SUMS >/dev/null
)

print -r -- "format=1" > "$staging_dir/manifest.txt"
print -r -- "created_at=$timestamp" >> "$staging_dir/manifest.txt"
print -r -- "database=database.dump" >> "$staging_dir/manifest.txt"
print -r -- "gallery=gallery.tar.gz" >> "$staging_dir/manifest.txt"
print -r -- "private_uploads=private-uploads.tar.gz" >> "$staging_dir/manifest.txt"
chmod 600 "$staging_dir"/*

mv "$staging_dir" "$final_dir"
staging_dir=""
print -r -- "$final_dir"
