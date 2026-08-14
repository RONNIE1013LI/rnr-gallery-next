#!/bin/zsh

set -euo pipefail

curl_bin=${RNR_CURL_BIN:-/usr/bin/curl}
base_url=${RNR_WARM_BASE_URL:-http://127.0.0.1:3000}

server_ready=false
for _ in {1..180}; do
  if "$curl_bin" --fail --silent --output /dev/null --max-time 5 "$base_url/"; then
    server_ready=true
    break
  fi
  sleep 1
done

if [[ "$server_ready" != true ]]; then
  print -u2 -- "R&R Next route warmup could not reach $base_url."
  exit 1
fi

routes=(
  "/"
  "/shop"
  "/canvas"
  "/banners"
  "/design-gallery"
  "/products/digital-oil-painting-canvas/configure"
  "/products/roll-up-banner/configure"
  "/products/custom-themed-wall-banner/configure"
  "/cart"
  "/checkout"
  "/account"
  "/account/sign-in"
  "/how-it-works"
  "/privacy"
  "/terms"
  "/gallery-images/warmup"
)

for route in $routes; do
  "$curl_bin" --silent --show-error --output /dev/null --max-time 30 "$base_url$route" || true
done
