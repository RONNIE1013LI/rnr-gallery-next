#!/bin/zsh

set -euo pipefail

script_dir=${0:A:h}
script_path="$script_dir/start-lan-server.zsh"
test_root=$(mktemp -d "${TMPDIR:-/tmp}/rnr-next-lan-test.XXXXXX")
trap 'rm -rf "$test_root"' EXIT

command_log="$test_root/commands.log"
env_file="$test_root/.env.lan"
project_dir="$test_root/project"
mkdir -p "$project_dir"
print -r -- '{}' > "$project_dir/package.json"

cat > "$env_file" <<'EOF'
DATABASE_URL=postgresql://example
BETTER_AUTH_URL=http://192.168.4.199:3000
BETTER_AUTH_SECRET=test-secret
PAYMENT_RETURN_BASE_URL=http://192.168.4.199:3000
ENABLE_LOCAL_TEST_SHIPPING=true
ENABLE_LOCAL_TEST_PAYMENTS=true
EOF

cat > "$test_root/docker" <<'EOF'
#!/bin/zsh
print -r -- "docker $*" >> "$RNR_TEST_COMMAND_LOG"
case "$1" in
  info) exit 0 ;;
  inspect) print -r -- false ;;
  start) exit 0 ;;
  exec) exit 0 ;;
esac
exit 1
EOF

cat > "$test_root/npm" <<'EOF'
#!/bin/zsh
print -r -- "path $PATH" >> "$RNR_TEST_COMMAND_LOG"
print -r -- "npm $*" >> "$RNR_TEST_COMMAND_LOG"
EOF

cat > "$test_root/open" <<'EOF'
#!/bin/zsh
print -r -- "open $*" >> "$RNR_TEST_COMMAND_LOG"
EOF

cat > "$test_root/warm-routes" <<'EOF'
#!/bin/zsh
print -r -- "warm-routes $*" >> "$RNR_TEST_COMMAND_LOG"
EOF

chmod +x "$test_root/docker" "$test_root/npm" "$test_root/open" "$test_root/warm-routes"

RNR_TEST_COMMAND_LOG="$command_log" \
RNR_NEXT_ENV_FILE="$env_file" \
RNR_PROJECT_DIR="$project_dir" \
RNR_DOCKER_BIN="$test_root/docker" \
RNR_NPM_BIN="$test_root/npm" \
RNR_OPEN_BIN="$test_root/open" \
RNR_WARM_ROUTES_SCRIPT="$test_root/warm-routes" \
zsh "$script_path"

for _ in {1..20}; do
  grep -Fxq "warm-routes " "$command_log" && break
  sleep 0.05
done

grep -Fxq "docker start rnr-next-payment-test" "$command_log"
grep -Fxq "docker exec rnr-next-payment-test pg_isready -U rnr_test -d rnr_test" "$command_log"
grep -Fxq "npm run db:migrate" "$command_log"
grep -Fxq "npm run dev -- --webpack --hostname 0.0.0.0 --port 3000" "$command_log"
grep -Fxq "path /usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" "$command_log"
grep -Fxq "warm-routes " "$command_log"
if grep -Eq -- "--turbo(pack)?([[:space:]]|$)" "$command_log"; then
  print -u2 -- "LAN review service must not expose Turbopack hot-reload chunks."
  exit 1
fi

migrate_line=$(grep -Fn "npm run db:migrate" "$command_log" | cut -d: -f1)
dev_line=$(grep -Fn "npm run dev -- --webpack --hostname 0.0.0.0 --port 3000" "$command_log" | cut -d: -f1)
if (( migrate_line >= dev_line )); then
  print -u2 -- "Database migrations must complete before the LAN server starts."
  exit 1
fi

print -r -- "PASS: LAN startup orchestration"
