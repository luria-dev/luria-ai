#!/bin/zsh
set -euo pipefail
base='http://127.0.0.1:3014/v1/analyze'
mkdir -p tmp/e2e

submit() {
  local name="$1"
  local message="$2"
  local window="$3"
  local req out id req_status i
  req=$(curl -sS "$base" -H 'content-type: application/json' -d "$(jq -nc --arg message "$message" --arg time_window "$window" '{message:$message,time_window:$time_window}')")
  echo "$req" > "tmp/e2e/${name}.accepted.json"
  id=$(jq -r '.requestId' <<<"$req")
  if [[ -z "$id" || "$id" == "null" ]]; then
    echo "submit failed for $name"
    cat "tmp/e2e/${name}.accepted.json"
    exit 1
  fi
  echo "[$name] requestId=$id"
  for i in {1..180}; do
    out=$(curl -sS "$base/$id/result")
    status_tmp=$(jq -r '.status // empty' <<<"$out")
    echo "$out" > "tmp/e2e/${name}.json"
    if [[ "$status_tmp" == "ready" || "$status_tmp" == "failed" ]]; then
      break
    fi
    sleep 2
  done
  jq '{status, phase: .payload.phase, requestId, nodeStatus: .payload.nodeStatus, topReport: {title: .payload.report.title, bodyHead: (.payload.report.body | tostring | .[0:220])}, comparison: {targetPipelinesLen: (.payload.targetPipelines | length?), reportTitle: .payload.comparison.report.title, reportBodyHead: (.payload.comparison.report.body | tostring | .[0:220])}}' "tmp/e2e/${name}.json"
}

submit single_asset '分析 BTC 接下来24小时走势，并给出策略建议' '24h'
submit multi_asset '分析 BTC、ETH 接下来24小时走势，并分别给出策略建议' '24h'
submit comparison '对比 BTC 和 ETH 接下来7天走势，并给出配置建议' '7d'
