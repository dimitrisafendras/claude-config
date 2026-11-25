#!/usr/bin/env bash
# Prints free memory %, heavy test/install processes, and how many more
# heavy jobs (a full vitest suite, npm ci, a dev server) fit right now.
# Exit 0 = room for another heavy job, 1 = wait.
set -u
FLOOR="${MEM_FLOOR_PCT:-30}"      # keep at least this % free
JOB_MB="${MEM_JOB_MB:-3500}"      # rough peak of one heavy job
if [[ "$(uname)" == "Darwin" ]]; then
  free_pct=$(memory_pressure | awk -F': ' '/free percentage/{gsub("%","",$2); print $2}')
  total_mb=$(( $(sysctl -n hw.memsize) / 1048576 ))
else
  read -r total_kb avail_kb < <(awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}END{print t, a}' /proc/meminfo)
  total_mb=$(( total_kb / 1024 )); free_pct=$(( avail_kb * 100 / total_kb ))
fi
heavy=$(ps -axo command= | grep -E "vitest|jest|npm ci|npm install|vite( |$)|tsc -b|nx run-many|expo start|metro" | grep -v grep | wc -l | tr -d ' ')
spare_mb=$(( total_mb * (free_pct - FLOOR) / 100 ))
room=$(( spare_mb > 0 ? spare_mb / JOB_MB : 0 ))
echo "free=${free_pct}% total=${total_mb}MB heavy_procs=${heavy} room_for_heavy_jobs=${room} (floor ${FLOOR}%, ~${JOB_MB}MB/job)"
[[ "$room" -gt 0 ]]
