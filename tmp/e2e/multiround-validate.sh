#!/bin/zsh
set -euo pipefail
base='http://127.0.0.1:3014/v1/analyze'
out_dir='tmp/e2e/multiround_20260328'
mkdir -p "$out_dir"

submit_and_wait() {
  local scenario="$1"
  local round="$2"
  local message="$3"
  local window="$4"
  local accepted result id req_status i

  accepted=$(curl -sS "$base" -H 'content-type: application/json' -d "$(jq -nc --arg message "$message" --arg time_window "$window" '{message:$message,time_window:$time_window}')")
  id=$(jq -r '.requestId' <<<"$accepted")
  printf '%s' "$accepted" > "$out_dir/${scenario}_r${round}_accepted.json"

  for i in {1..240}; do
    result=$(curl -sS "$base/$id/result")
    req_status=$(jq -r '.status' <<<"$result")
    printf '%s' "$result" > "$out_dir/${scenario}_r${round}.json"
    if [[ "$req_status" == 'ready' || "$req_status" == 'failed' ]]; then
      break
    fi
    sleep 2
  done

  node - <<'NODE' "$out_dir/${scenario}_r${round}.json" "$scenario" "$round"
const fs = require('fs');
const [file, scenario, round] = process.argv.slice(2);
const raw = fs.readFileSync(file, 'utf8');
const data = JSON.parse(raw);
const payload = data.payload || {};
const ns = payload.nodeStatus || {};
const comparison = payload.comparison || {};
const targetPipelines = Array.isArray(payload.targetPipelines) ? payload.targetPipelines : [];
const summarizeTarget = (t) => ({
  symbol: t?.identity?.symbol ?? null,
  title: t?.report?.title ?? null,
  mentionsOther: (() => {
    const body = String(t?.report?.body ?? '');
    const symbol = t?.identity?.symbol ?? '';
    const others = ['BTC','ETH','SOL'].filter(x => x !== symbol);
    return others.filter(x => body.includes(x));
  })(),
});
const summary = {
  scenario,
  round: Number(round),
  requestId: data.requestId,
  status: data.status,
  phase: payload.phase,
  nodeStatus: {
    intent: ns.intent?.llmStatus ?? null,
    planning: ns.planning?.llmStatus ?? null,
    analysis: ns.analysis?.llmStatus ?? null,
    report: ns.report?.llmStatus ?? null,
  },
  topReportTitle: payload.report?.title ?? null,
  topReportHasBody: Boolean(payload.report?.body),
  comparisonReportTitle: comparison.report?.title ?? null,
  comparisonReportHasBody: Boolean(comparison.report?.body),
  comparisonMetaStatus: comparison.meta?.llmStatus ?? null,
  targetPipelinesLen: targetPipelines.length,
  targets: targetPipelines.map(summarizeTarget),
};
process.stdout.write(JSON.stringify(summary));
NODE
}

rounds=2
for r in $(seq 1 $rounds); do
  echo "RUN single_asset round=$r"
  submit_and_wait 'single_asset' "$r" '分析 BTC 接下来24小时走势，并给出策略建议' '24h' > "$out_dir/single_asset_r${r}_summary.json"
  echo "RUN multi_asset round=$r"
  submit_and_wait 'multi_asset' "$r" '分析 BTC、ETH 接下来24小时走势，并分别给出策略建议' '24h' > "$out_dir/multi_asset_r${r}_summary.json"
  echo "RUN comparison round=$r"
  submit_and_wait 'comparison' "$r" '对比 BTC 和 ETH 接下来7天走势，并给出配置建议' '7d' > "$out_dir/comparison_r${r}_summary.json"
done

jq -s '.' "$out_dir"/*_summary.json > "$out_dir/summary-all.json"
node - <<'NODE' "$out_dir/summary-all.json" "$out_dir/MULTIROUND_E2E_SUMMARY.md"
const fs = require('fs');
const [jsonFile, mdFile] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
const byScenario = new Map();
for (const row of rows) {
  if (!byScenario.has(row.scenario)) byScenario.set(row.scenario, []);
  byScenario.get(row.scenario).push(row);
}
let md = '# Multi-round E2E Summary\n\n';
for (const [scenario, items] of byScenario.entries()) {
  md += `## ${scenario}\n\n`;
  for (const item of items.sort((a,b)=>a.round-b.round)) {
    md += `### round ${item.round}\n`;
    md += `- requestId: \`${item.requestId}\`\n`;
    md += `- status: \`${item.status}\`\n`;
    md += `- phase: \`${item.phase}\`\n`;
    md += `- nodeStatus: intent=\`${item.nodeStatus.intent}\`, planning=\`${item.nodeStatus.planning}\`, analysis=\`${item.nodeStatus.analysis}\`, report=\`${item.nodeStatus.report}\`\n`;
    md += `- topReport: ${item.topReportTitle ? '`' + item.topReportTitle + '`' : 'null'}\n`;
    md += `- comparisonReport: ${item.comparisonReportTitle ? '`' + item.comparisonReportTitle + '`' : 'null'}\n`;
    md += `- targetPipelinesLen: \`${item.targetPipelinesLen}\`\n`;
    if (item.targets.length) {
      for (const t of item.targets) {
        md += `- target ${t.symbol}: title=${t.title ? '`' + t.title + '`' : 'null'}, mentionsOther=${t.mentionsOther.length ? '`' + t.mentionsOther.join(',') + '`' : '`none`'}\n`;
      }
    }
    md += '\n';
  }
}
const reportFallbacks = rows.filter(r => r.nodeStatus.report && r.nodeStatus.report !== 'success' && r.nodeStatus.report !== 'retry_success');
md += '## Summary\n\n';
md += `- total runs: ${rows.length}\n`;
md += `- report non-success runs: ${reportFallbacks.length}\n`;
md += `- comparison runs with targetPipelinesLen=0: ${rows.filter(r => r.scenario === 'comparison' && r.targetPipelinesLen === 0).length}/${rows.filter(r => r.scenario === 'comparison').length}\n`;
md += `- multi_asset runs without cross-mention: ${rows.filter(r => r.scenario === 'multi_asset').every(r => r.targets.every(t => t.mentionsOther.length === 0))}\n`;
fs.writeFileSync(mdFile, md);
NODE

echo "$out_dir"
