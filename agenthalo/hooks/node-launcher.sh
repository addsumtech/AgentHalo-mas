#!/bin/sh
# AgentHalo (Mac App Store build) hook launcher.
#
# The sandboxed app cannot see where Node.js is installed, so hook commands
# start this script instead of a node path. It runs outside the sandbox with
# the calling tool's environment, finds node the same way the app does in
# unsandboxed builds, and hands the hook over. If no node is found it exits 0
# so the tool keeps working without AgentHalo updates.

# Tells the hook it runs for the store build (see applySourceBundleId in
# shared-process.js).
AGENTHALO_STORE_HOOK=1
export AGENTHALO_STORE_HOOK

run_node() {
  if [ -n "$1" ] && [ -x "$1" ]; then
    node_bin="$1"
    shift
    exec "$node_bin" "$@"
  fi
}

newest_in() {
  # $1: directory holding one folder per version, $2: path inside it.
  [ -d "$1" ] || return 0
  latest=""
  for dir in "$1"/*/; do
    [ -x "$dir$2" ] && latest="$dir$2"
  done
  [ -n "$latest" ] && printf '%s\n' "$latest"
}

run_node "$(command -v node 2>/dev/null)" "$@"
for candidate in \
  /opt/homebrew/bin/node \
  /usr/local/bin/node \
  "$HOME/.volta/bin/node" \
  "$HOME/.local/bin/node" \
  "$HOME/.nvm/current/bin/node" \
  "$(newest_in "$HOME/.nvm/versions/node" bin/node)" \
  "$(newest_in "$HOME/.fnm/node-versions" installation/bin/node)" \
  "$(newest_in "$HOME/.local/share/fnm/node-versions" installation/bin/node)" \
  "$(newest_in "$HOME/.asdf/installs/nodejs" bin/node)" \
  "$HOME/.asdf/shims/node" \
  "$HOME/.mise/shims/node" \
  "$HOME/.local/share/mise/shims/node" \
  /usr/bin/node
do
  run_node "$candidate" "$@"
done

echo "AgentHalo: Node.js was not found; this hook did nothing." >&2
exit 0
