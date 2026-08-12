#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.dev-services"
DEPLOY=true
declare -a MANAGED_PIDS=()
declare -a MANAGED_NAMES=()

usage() {
  printf '%s\n' \
    "Usage: pnpm dev:all [--no-deploy]" \
    "" \
    "Starts the Midnight devnet, Reclaim attestor, three notaries, API sidecar," \
    "and Vite UI. By default it builds and deploys a fresh contract, then rotates" \
    "the registry to the running notary keys." \
    "" \
    "  --no-deploy  Reuse packages/contract/deploy-output.json" \
    "  -h, --help   Show this help"
}

while (($# > 0)); do
  case "$1" in
    --no-deploy)
      DEPLOY=false
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

mkdir -p "$RUNTIME_DIR"

log() {
  printf '\n\033[1;36m[devnet-all]\033[0m %s\n' "$*"
}

die() {
  printf '\n\033[1;31m[devnet-all] ERROR:\033[0m %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

tcp_open() {
  timeout 1 bash -c "exec 3<>/dev/tcp/127.0.0.1/$1" >/dev/null 2>&1
}

wait_for_tcp() {
  local name="$1"
  local port="$2"
  local attempts="${3:-60}"
  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if tcp_open "$port"; then
      printf '[devnet-all] %-18s ready on :%s\n' "$name" "$port"
      return 0
    fi
    sleep 2
  done
  return 1
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local attempts="${3:-60}"
  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      printf '[devnet-all] %-18s ready at %s\n' "$name" "$url"
      return 0
    fi
    sleep 2
  done
  return 1
}

show_log_tail() {
  local name="$1"
  local path="$RUNTIME_DIR/$name.log"
  if [[ -f "$path" ]]; then
    printf '\n[devnet-all] Last lines from %s:\n' "$path" >&2
    tail -n 30 "$path" >&2
  fi
}

start_service() {
  local name="$1"
  local port="$2"
  shift 2
  if tcp_open "$port"; then
    printf '[devnet-all] %-18s already running on :%s; reusing it\n' "$name" "$port"
    return 0
  fi
  local log_path="$RUNTIME_DIR/$name.log"
  : >"$log_path"
  setsid "$@" >"$log_path" 2>&1 &
  local pid=$!
  MANAGED_PIDS+=("$pid")
  MANAGED_NAMES+=("$name")
  printf '[devnet-all] %-18s starting (pid %s, log %s)\n' "$name" "$pid" "$log_path"
}

stop_managed_services() {
  local exit_code=$?
  trap - EXIT INT TERM
  if ((${#MANAGED_PIDS[@]} > 0)); then
    log "Stopping locally managed services"
    for ((index = ${#MANAGED_PIDS[@]} - 1; index >= 0; index -= 1)); do
      local pid="${MANAGED_PIDS[$index]}"
      local name="${MANAGED_NAMES[$index]}"
      if kill -0 "$pid" 2>/dev/null; then
        printf '[devnet-all] stopping %s (process group %s)\n' "$name" "$pid"
        kill -TERM -- "-$pid" 2>/dev/null || true
      fi
    done
  fi
  printf '[devnet-all] Docker devnet remains running. Stop it with: pnpm devnet:down\n'
  exit "$exit_code"
}

trap stop_managed_services EXIT INT TERM

require_command docker
require_command pnpm
require_command curl
require_command timeout
require_command setsid

[[ -f "$ROOT_DIR/attestor/.env" ]] || die "attestor/.env is missing"
for index in 1 2 3; do
  [[ -f "$ROOT_DIR/packages/notary/.env.notary-$index" ]] ||
    die "packages/notary/.env.notary-$index is missing"
done
if [[ "$DEPLOY" == false && ! -f "$ROOT_DIR/packages/contract/deploy-output.json" ]]; then
  die "--no-deploy requires packages/contract/deploy-output.json"
fi

cd "$ROOT_DIR"

log "Starting Midnight node, indexer, and proof server"
bash devnet/up.sh
wait_for_http "Midnight node" "http://127.0.0.1:9944/health" 30 ||
  die "Midnight node did not become healthy"
wait_for_tcp "indexer" 8088 60 || die "indexer did not open port 8088"
wait_for_tcp "proof server" 6300 60 || die "proof server did not open port 6300"

log "Starting attestation services"
start_service "attestor" 8001 bash "$ROOT_DIR/attestor/run.sh"
wait_for_tcp "Reclaim attestor" 8001 60 || {
  show_log_tail "attestor"
  die "Reclaim attestor did not open port 8001"
}

notary_ports_up=0
for port in 8101 8102 8103; do
  if tcp_open "$port"; then
    notary_ports_up=$((notary_ports_up + 1))
  fi
done
if ((notary_ports_up == 3)); then
  printf '[devnet-all] %-18s already running on :8101-8103; reusing them\n' "notaries"
elif ((notary_ports_up > 0)); then
  die "only $notary_ports_up of 3 notary ports are available; stop the partial signer set first"
else
  start_service \
    "notaries" \
    8101 \
    pnpm --dir "$ROOT_DIR/packages/notary" run start:instances
fi
for port in 8101 8102 8103; do
  wait_for_http "notary $port" "http://127.0.0.1:$port/pubkey" 30 || {
    show_log_tail "notaries"
    die "notary signer did not become ready on port $port"
  }
done

if [[ "$DEPLOY" == true ]]; then
  if tcp_open 8200; then
    die "port 8200 is already in use; stop the old sidecar before deploying a fresh contract"
  fi
  log "Building the Compact contract and ZK artifacts"
  pnpm --filter @witnessfitness/contract build

  log "Deploying a fresh contract"
  pnpm --filter @witnessfitness/contract exec tsx scripts/deploy.ts

  log "Rotating the registry to the running notary keys"
  pnpm --filter @witnessfitness/contract run rotate-notaries

  sidecar_state="$ROOT_DIR/packages/api/midnight-level-db"
  if [[ -d "$sidecar_state" ]]; then
    archived_state="$RUNTIME_DIR/midnight-level-db.before-$(date +%Y%m%d-%H%M%S)"
    mv "$sidecar_state" "$archived_state"
    printf '[devnet-all] Previous sidecar state archived at %s\n' "$archived_state"
  fi
else
  log "Reusing the existing deployment"
fi

log "Funding the demo wallet (mnemonic-derived seed)"
if ! pnpm --filter @witnessfitness/contract exec tsx scripts/fund-demo-wallet.ts; then
  die "funding the demo wallet failed"
fi

log "Copying deployment artifacts into the UI"
pnpm --filter ui copy-keys

log "Starting API sidecar"
start_service \
  "sidecar" \
  8200 \
  pnpm --dir "$ROOT_DIR/packages/api" run start:sidecar
for ((attempt = 1; attempt <= 120; attempt += 1)); do
  health="$(curl -fsS --max-time 2 http://127.0.0.1:8200/health 2>/dev/null || true)"
  if [[ "$health" =~ \"ready\"[[:space:]]*:[[:space:]]*true ]]; then
    printf '[devnet-all] %-18s ready at %s\n' "API sidecar" "http://127.0.0.1:8200/health"
    break
  fi
  if ((attempt == 120)); then
    show_log_tail "sidecar"
    die "API sidecar did not report ready:true"
  fi
  sleep 2
done

log "Starting the UI"
start_service "ui" 5173 pnpm --dir "$ROOT_DIR/ui" dev
wait_for_http "Vite UI" "http://localhost:5173" 30 || {
  show_log_tail "ui"
  die "Vite UI did not become ready"
}

log "Everything is ready"
printf '%s\n' \
  "  UI             http://localhost:5173" \
  "  API sidecar    http://127.0.0.1:8200/health" \
  "  Attestor       ws://127.0.0.1:8001/ws" \
  "  Notaries       http://127.0.0.1:8101-8103" \
  "  Indexer        http://127.0.0.1:8088" \
  "  Node           http://127.0.0.1:9944" \
  "  Proof server   http://127.0.0.1:6300" \
  "" \
  "Logs: $RUNTIME_DIR/*.log" \
  "Press Ctrl-C to stop attestor, notaries, sidecar, and UI."

while true; do
  for ((index = 0; index < ${#MANAGED_PIDS[@]}; index += 1)); do
    pid="${MANAGED_PIDS[$index]}"
    name="${MANAGED_NAMES[$index]}"
    if ! kill -0 "$pid" 2>/dev/null; then
      show_log_tail "$name"
      die "$name exited unexpectedly"
    fi
  done
  sleep 2
done
