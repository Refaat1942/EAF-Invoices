#!/usr/bin/env bash
# Build the one-click offline Windows package (deploy/windows + program + Node.js + PostgreSQL).
# Usage: scripts/build-windows-offline.sh [output-dir] [download-cache-dir]
# Needs internet (nodejs.org, github.com, pypi.org) only while building.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/dist}"
CACHE="${2:-$ROOT/.cache/windows-offline}"
NODE_VERSION="${NODE_VERSION:-20.20.2}"
PG_VERSION="${PG_VERSION:-16.14.0}"
NAME="EAF-Invoices-Offline"
STAGE="$OUT/$NAME"

mkdir -p "$CACHE" "$OUT"

fetch() { # url dest
  [ -s "$2" ] || { echo "download $1"; curl -fSL --retry 3 -o "$2.part" "$1" && mv "$2.part" "$2"; }
}
fetch "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-win-x64.zip" "$CACHE/node-$NODE_VERSION.zip"
fetch "https://github.com/theseus-rs/postgresql-binaries/releases/download/$PG_VERSION/postgresql-$PG_VERSION-x86_64-pc-windows-msvc.zip" "$CACHE/pg-$PG_VERSION.zip"
# Microsoft Visual C++ runtime DLLs (redistributable) needed by the PostgreSQL programs.
if ! ls "$CACHE"/msvc_runtime-*.whl >/dev/null 2>&1; then
  pip download --no-deps --only-binary=:all: --platform win_amd64 --python-version 3.12 msvc-runtime -d "$CACHE"
fi

rm -rf "$STAGE"
mkdir -p "$STAGE/app" "$STAGE/runtime"

echo "== program"
git -C "$ROOT" archive HEAD | tar -x -C "$STAGE/app"
rm -rf "$STAGE/app/deploy/windows" "$STAGE/app/.github"
(cd "$STAGE/app" && PUPPETEER_SKIP_DOWNLOAD=1 npm ci --omit=dev --no-audit --no-fund --loglevel=error)

echo "== Node.js $NODE_VERSION"
tmp="$(mktemp -d)"
unzip -q "$CACHE/node-$NODE_VERSION.zip" -d "$tmp"
mv "$tmp/node-v$NODE_VERSION-win-x64" "$STAGE/runtime/node"
rm -rf "$tmp"

echo "== PostgreSQL $PG_VERSION"
tmp="$(mktemp -d)"
unzip -q "$CACHE/pg-$PG_VERSION.zip" -d "$tmp"
pgsrc="$(find "$tmp" -maxdepth 1 -mindepth 1 -type d | head -1)"
mkdir -p "$STAGE/runtime/pgsql"
for d in bin lib share; do mv "$pgsrc/$d" "$STAGE/runtime/pgsql/"; done
cp "$pgsrc"/*license* "$pgsrc/LICENSE" "$STAGE/runtime/pgsql/" 2>/dev/null || true
rm -rf "$tmp"
# Static libraries and test programs are not needed at runtime.
find "$STAGE/runtime/pgsql/lib" -name '*.lib' -delete
rm -f "$STAGE/runtime/pgsql/bin/"libpq_*.exe "$STAGE/runtime/pgsql/bin/"*.lib "$STAGE/runtime/pgsql/bin/"*.pdb
tmp="$(mktemp -d)"
python3 -I -m zipfile -e "$(ls "$CACHE"/msvc_runtime-*.whl | head -1)" "$tmp"
for f in vcruntime140.dll vcruntime140_1.dll msvcp140.dll; do
  cp "$(find "$tmp" -name "$f" | head -1)" "$STAGE/runtime/pgsql/bin/"
done
rm -rf "$tmp"

echo "== Windows scripts"
cp -r "$ROOT/deploy/windows/." "$STAGE/"
# Windows line endings; UTF-8 BOM so Windows PowerShell 5.1 and Notepad read Arabic correctly.
find "$STAGE" -maxdepth 2 \( -name '*.bat' -o -name '*.ps1' -o -name '*.txt' \) -not -path '*/app/*' -not -path '*/runtime/*' | while read -r f; do
  sed -i 's/\r$//; s/$/\r/' "$f"
done
for f in "$STAGE"/tools/*.ps1 "$STAGE/README-AR.txt"; do
  printf '\xEF\xBB\xBF' | cat - "$f" > "$f.bom" && mv "$f.bom" "$f"
done

echo "== zip"
ZIP="$OUT/$NAME-$(date +%Y-%m-%d).zip"
rm -f "$ZIP"
(cd "$OUT" && zip -qr -X "$ZIP" "$NAME")
du -sh "$STAGE" "$ZIP"
echo "built $ZIP"
