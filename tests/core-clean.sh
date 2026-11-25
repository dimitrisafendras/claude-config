#!/usr/bin/env bash
# The core must be generic: no company, person or project names outside profiles/.
# Prints one line per hit and exits 1 on any hit.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
WORDS='sophea|kiefer|clickup|christos|dimitris|afendras|datagr|europe/athens|iphone 17|/Users/dimitrisafendras'
hits=$(cd "$ROOT" && git ls-files claude mods routines tests install.sh README.md .github .claude-plugin \
  | grep -v -e '^tests/core-clean.sh$' | while read -r f; do [ -f "$f" ] && grep -n -i -E "$WORDS" "$f" | sed "s#^#$f:#"; done)
if [ -n "$hits" ]; then echo "$hits" | cut -c1-200; exit 1; fi
echo "core-clean: no company, person or project names in the core"
