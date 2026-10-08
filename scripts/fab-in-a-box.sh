#!/usr/bin/env bash
# Fab in a box: fetch and build GemBench (the SECS/GEM equipment simulator), then run eight simulated
# tools and a MES host that drives FabTwin's live mode on ws://localhost:8787.
#
#   scripts/fab-in-a-box.sh                       clone the local GemBench checkout, build it, run
#   GEMBENCH_REPO=<git url or local path> scripts/fab-in-a-box.sh
#   GEMBENCH_REPO=<url or path> GEMBENCH_REF=main scripts/fab-in-a-box.sh
#   GEMBENCH_DIR=/path/to/built/gembench scripts/fab-in-a-box.sh     use a checkout you already built
#   DURATION=300 scripts/fab-in-a-box.sh         stop after five minutes
#
# GEMBENCH_REPO defaults to ../gembench when that is a git checkout. The script clones it into
# $FABBOX_WORK (default $TMPDIR/fabtwin-gembench) and builds there, so it never writes into your checkout.
#
# Needs the .NET 10 SDK, git, Node 22 and `npm ci` done in this repo. Nothing is installed globally.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
work="${FABBOX_WORK:-${TMPDIR:-/tmp}/fabtwin-gembench}"

command -v dotnet >/dev/null || { echo "The .NET 10 SDK is required (dotnet not found)." >&2; exit 2; }

if [ -z "${GEMBENCH_DIR:-}" ]; then
  repo="${GEMBENCH_REPO:-}"
  if [ -z "$repo" ] && [ -d "$here/../gembench/.git" ]; then repo="$(cd "$here/../gembench" && pwd)"; fi
  if [ -z "$repo" ]; then
    echo "No GemBench checkout found at $here/../gembench." >&2
    echo "Set GEMBENCH_REPO to a GemBench git URL or local path, or GEMBENCH_DIR to a built checkout." >&2
    exit 2
  fi
  echo "GemBench source: $repo"
  if [ ! -d "$work/.git" ]; then
    git clone --quiet "$repo" "$work"
  else
    git -C "$work" pull --quiet --ff-only || true
  fi
  [ -n "${GEMBENCH_REF:-}" ] && git -C "$work" checkout --quiet "$GEMBENCH_REF"
  export GEMBENCH_DIR="$work"
fi
echo "GemBench commit: $(git -C "$GEMBENCH_DIR" rev-parse --short HEAD) at $GEMBENCH_DIR"

if [ ! -f "$GEMBENCH_DIR/src/GemBench.Cli/bin/Release/net10.0/gembench.dll" ]; then
  dotnet build -c Release --nologo -v quiet "$GEMBENCH_DIR"
fi

cd "$here"
exec npx tsx scripts/fab-in-a-box.ts
