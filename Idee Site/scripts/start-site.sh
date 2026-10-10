#!/usr/bin/env bash
set -euo pipefail

site_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
exec python3 -m http.server "${PORT:-8000}" --bind 127.0.0.1 --directory "$site_root"
