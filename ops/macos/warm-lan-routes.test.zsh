#!/bin/zsh

set -euo pipefail

script_dir=${0:A:h}
script_path="$script_dir/warm-lan-routes.zsh"
test_root=$(mktemp -d "${TMPDIR:-/tmp}/rnr-next-warm-test.XXXXXX")
trap 'rm -rf "$test_root"' EXIT

command_log="$test_root/requests.log"

cat > "$test_root/curl" <<'EOF'
#!/bin/zsh
print -r -- "$*" >> "$RNR_TEST_COMMAND_LOG"
exit 0
EOF
chmod +x "$test_root/curl"

RNR_TEST_COMMAND_LOG="$command_log" \
RNR_CURL_BIN="$test_root/curl" \
RNR_WARM_BASE_URL="http://127.0.0.1:3000" \
zsh "$script_path"

grep -Fq -- "http://127.0.0.1:3000/" "$command_log"
grep -Fq -- "http://127.0.0.1:3000/shop" "$command_log"
grep -Fq -- "http://127.0.0.1:3000/design-gallery" "$command_log"
grep -Fq -- "http://127.0.0.1:3000/products/digital-oil-painting-canvas/configure" "$command_log"
grep -Fq -- "http://127.0.0.1:3000/gallery-images/warmup" "$command_log"
grep -Fq -- "http://127.0.0.1:3000/checkout" "$command_log"
grep -Eq -- "http://127\\.0\\.0\\.1:3000/account$" "$command_log"

print -r -- "PASS: LAN route warmup"
