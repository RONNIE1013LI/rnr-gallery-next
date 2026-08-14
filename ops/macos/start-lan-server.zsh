#!/bin/zsh

set -euo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

env_file=${RNR_NEXT_ENV_FILE:-"$HOME/Library/Application Support/RNR Next/.env.lan"}
project_dir=${RNR_PROJECT_DIR:-${0:A:h:h:h}}
docker_bin=${RNR_DOCKER_BIN:-/usr/local/bin/docker}
npm_bin=${RNR_NPM_BIN:-/usr/local/bin/npm}
open_bin=${RNR_OPEN_BIN:-/usr/bin/open}
container_name=${RNR_POSTGRES_CONTAINER:-rnr-next-payment-test}
warm_routes_script=${RNR_WARM_ROUTES_SCRIPT:-${0:A:h}/warm-lan-routes.zsh}

if [[ ! -r "$env_file" ]]; then
  print -u2 -- "R&R Next environment file is missing or unreadable: $env_file"
  exit 1
fi

if [[ ! -f "$project_dir/package.json" ]]; then
  print -u2 -- "R&R Next project was not found: $project_dir"
  exit 1
fi

set -a
source "$env_file"
set +a

if ! "$docker_bin" info >/dev/null 2>&1; then
  "$open_bin" -gj -a Docker

  docker_ready=false
  for _ in {1..180}; do
    if "$docker_bin" info >/dev/null 2>&1; then
      docker_ready=true
      break
    fi
    sleep 1
  done

  if [[ "$docker_ready" != true ]]; then
    print -u2 -- "Docker Desktop did not become ready within 180 seconds."
    exit 1
  fi
fi

if [[ "$("$docker_bin" inspect -f '{{.State.Running}}' "$container_name" 2>/dev/null || true)" != true ]]; then
  "$docker_bin" start "$container_name" >/dev/null
fi

postgres_ready=false
for _ in {1..90}; do
  if "$docker_bin" exec "$container_name" pg_isready -U rnr_test -d rnr_test >/dev/null 2>&1; then
    postgres_ready=true
    break
  fi
  sleep 1
done

if [[ "$postgres_ready" != true ]]; then
  print -u2 -- "PostgreSQL did not become ready within 90 seconds."
  exit 1
fi

cd "$project_dir"
"$npm_bin" run db:migrate
if [[ "${RNR_SKIP_ROUTE_WARMUP:-false}" != true && -x "$warm_routes_script" ]]; then
  RNR_WARM_BASE_URL="${RNR_WARM_BASE_URL:-http://127.0.0.1:3000}" \
    "$warm_routes_script" &
fi
exec "$npm_bin" run dev -- --webpack --hostname 0.0.0.0 --port 3000
