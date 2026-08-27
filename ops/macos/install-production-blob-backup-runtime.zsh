#!/bin/zsh

set -euo pipefail

project_dir=${RNR_PROJECT_DIR:-${0:A:h:h:h}}
runtime_root=${RNR_BACKUP_RUNTIME_ROOT:-"$HOME/Library/Application Support/RNR Gallery/Backup"}
launch_agents=${RNR_BACKUP_LAUNCH_AGENTS_DIR:-"$HOME/Library/LaunchAgents"}
install_only=${RNR_BACKUP_INSTALL_ONLY:-0}
template="$project_dir/ops/macos/com.rnr.production-blob-backup.plist.template"
runtime_templates="$project_dir/ops/macos/runtime"
target="$launch_agents/com.rnr.production-blob-backup.plist"
node_path=$(command -v node)
esbuild="$project_dir/node_modules/.bin/esbuild"
source_commit=$(git -C "$project_dir" rev-parse HEAD)

if [[ ! "$source_commit" =~ '^[0-9a-f]{40}$' ]]; then
  print -u2 -- "Backup runtime install failed: source commit is invalid."
  exit 1
fi
if [[ ! -x "$node_path" || ! -x "$esbuild" || ! -r "$template" ]]; then
  print -u2 -- "Backup runtime install failed: verified source tooling is unavailable."
  exit 1
fi

release_dir="$runtime_root/releases/$source_commit"
staging="$runtime_root/.install-${source_commit}-$$"
trap 'rm -rf -- "$staging"' EXIT
mkdir -p "$staging/release" "$runtime_root/bin" "$runtime_root/config" "$runtime_root/logs" "$runtime_root/releases" "$runtime_root/state" "$launch_agents"
chmod 700 "$runtime_root" "$runtime_root/bin" "$runtime_root/config" "$runtime_root/logs" "$runtime_root/releases" "$runtime_root/state"

"$esbuild" "$project_dir/scripts/backup-production-blob.ts" \
  --bundle --platform=node --format=cjs --target=node20 \
  --outfile="$staging/release/backup-production-blob.cjs" >/dev/null
"$esbuild" "$project_dir/scripts/restore-production-blob-backup.ts" \
  --bundle --platform=node --format=cjs --target=node20 \
  --outfile="$staging/release/restore-production-blob-backup.cjs" >/dev/null
chmod 500 "$staging/release/backup-production-blob.cjs" "$staging/release/restore-production-blob-backup.cjs"
"$node_path" "$staging/release/backup-production-blob.cjs" --self-test >/dev/null
"$node_path" "$staging/release/restore-production-blob-backup.cjs" --self-test >/dev/null

if [[ ! -d "$release_dir" ]]; then
  mv "$staging/release" "$release_dir"
fi

install_runtime_script() {
  local source_file=$1
  local target_file=$2
  local temporary="$target_file.$$.tmp"
  sed -e "s|__RNR_NODE_PATH__|$node_path|g" "$source_file" > "$temporary"
  chmod 500 "$temporary"
  mv -f "$temporary" "$target_file"
}
install_runtime_script "$runtime_templates/run-production-blob-backup.zsh" "$runtime_root/bin/run-backup.zsh"
install_runtime_script "$runtime_templates/restore-production-blob-backup.zsh" "$runtime_root/bin/restore-backup.zsh"
install_runtime_script "$runtime_templates/status-production-blob-backup.zsh" "$runtime_root/bin/status.zsh"

active_temp="$runtime_root/config/.active-release.$$.tmp"
print -r -- "$source_commit" > "$active_temp"
chmod 600 "$active_temp"
mv -f "$active_temp" "$runtime_root/config/active-release"

metadata_temp="$runtime_root/config/.install.$$.tmp"
SOURCE_COMMIT="$source_commit" "$node_path" -e '
  const fs = require("fs");
  fs.writeFileSync(process.argv[1], JSON.stringify({
    format: 1,
    sourceCommit: process.env.SOURCE_COMMIT,
    installedAt: new Date().toISOString(),
  }) + "\n", { mode: 0o600 });
' "$metadata_temp"
mv -f "$metadata_temp" "$runtime_root/config/install.json"

escaped_runtime=${runtime_root//&/&amp;}
escaped_runtime=${escaped_runtime//</&lt;}
escaped_runtime=${escaped_runtime//>/&gt;}
plist_temp="$target.$$.tmp"
sed -e "s|__RNR_RUNTIME_ROOT__|$escaped_runtime|g" "$template" > "$plist_temp"
chmod 600 "$plist_temp"
plutil -lint "$plist_temp" >/dev/null
mv -f "$plist_temp" "$target"

if [[ "$install_only" != "1" ]]; then
  launchctl bootout "gui/$(id -u)" "$target" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$target"
  launchctl enable "gui/$(id -u)/com.rnr.production-blob-backup"
fi
print -r -- "Production Blob backup runtime installed at $runtime_root"
