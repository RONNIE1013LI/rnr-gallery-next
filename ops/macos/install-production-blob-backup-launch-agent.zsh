#!/bin/zsh

set -euo pipefail

project_dir=${RNR_PROJECT_DIR:-${0:A:h:h:h}}
exec /bin/zsh "$project_dir/ops/macos/install-production-blob-backup-runtime.zsh"
