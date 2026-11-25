#!/usr/bin/env bash
# Prints free memory %, heavy test/install processes, and how many more
# heavy jobs (a full vitest suite, npm ci, a dev server) fit right now.
# Exit 0 = room for another heavy job, 1 = wait.
# MEM_BUDGET_MEMINFO names the meminfo file (default /proc/meminfo) and MEM_BUDGET_PROCS
# replaces the process list (one command line per line); both are used by tests.
set -u
FLOOR="${MEM_FLOOR_PCT:-20}"      # keep at least this % free
JOB_MB="${MEM_JOB_MB:-3500}"      # rough peak of one heavy job
MEMINFO="${MEM_BUDGET_MEMINFO:-/proc/meminfo}"
PATTERN="vitest|jest|npm ci|npm install|vite( |$)|tsc -b|nx run-many|expo start|metro"
os=$(uname)
if [[ "$os" == "Darwin" ]]; then
  free_pct=$(memory_pressure | awk -F': ' '/free percentage/{gsub("%","",$2); print $2}')
  total_mb=$(( $(sysctl -n hw.memsize) / 1048576 ))
else
  # Git Bash has MemTotal and MemFree but no MemAvailable: fall back to MemFree.
  read -r total_kb avail_kb < <(awk '/^MemTotal:/{t=$2}/^MemAvailable:/{a=$2}/^MemFree:/{f=$2}END{print t+0, (a!="" ? a : f)+0}' "$MEMINFO" 2>/dev/null)
  total_kb=${total_kb:-0}; avail_kb=${avail_kb:-0}
  total_mb=$(( total_kb / 1024 )); free_pct=$(( total_kb > 0 ? avail_kb * 100 / total_kb : 0 ))
fi
# One command line per line. MEM_BUDGET_PROCS replaces the process list (used by tests).
if [[ -n "${MEM_BUDGET_PROCS+x}" ]]; then
  procs="$MEM_BUDGET_PROCS"
else
  case "$os" in
    MINGW*|MSYS*|CYGWIN*)
      # MSYS ps has no -axo and does not list Windows processes: ask PowerShell.
      procs=$(powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process).CommandLine" 2>/dev/null | tr -d '\r') ;;
    *)
      procs=$(ps -axo command= 2>/dev/null) ;;
  esac
fi
# Do not count this script's own grep or the PowerShell query (their command lines hold the pattern).
heavy=$(printf '%s\n' "$procs" | grep -E "$PATTERN" | grep -v -E "grep|Get-CimInstance" | wc -l | tr -d ' ')
heavy=${heavy:-0}
spare_mb=$(( total_mb * (free_pct - FLOOR) / 100 ))
room=$(( spare_mb > 0 ? spare_mb / JOB_MB : 0 ))
echo "free=${free_pct}% total=${total_mb}MB heavy_procs=${heavy} room_for_heavy_jobs=${room} (floor ${FLOOR}%, ~${JOB_MB}MB/job)"
[[ "$room" -gt 0 ]]
