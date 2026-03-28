#!/bin/zsh
set -euo pipefail
base='http://127.0.0.1:3014/v1/analyze'

run_case() {
  local name="$1"
  local message="$2"
  local window="$3"
  local out="tmp/e2e/${name}.json"
  echo "=== ${name} ==="
  curl -sS "$base" \
    -H 'content-type: application/json' \
    -d "$(jq -nc --arg message "$message" --arg time_window "$window" '{message:$message,time_window:$time_window}')" \
    > "$out"
  echo "$out"
  jq '{status, phase: .payload.phase, requestId, intentType: .payload.intent.taskType, note: .payload.note, nodeStatus: .payload.nodeStatus, topReport: {title: .payload.report.title, hasBody: (.payload.report.body != null and .payload.report.body != "")}, comparison: {hasComparison: (.payload.comparison != null), hasComparisonReport: (.payload.comparison.report.body != null and .payload.comparison.report.body != ""), targetPipelinesLen: (.payload.targetPipelines | length?)}}' "$out"
  echo
}

run_case single_asset '分析 BTC 接下来24小时走势，并给出策略建议' '24h'
run_case multi_asset '分析 BTC、ETH 接下来24小时走势，并分别给出策略建议' '24h'
run_case comparison '对比 BTC 和 ETH 接下来7天走势，并给出配置建议' '7d'
