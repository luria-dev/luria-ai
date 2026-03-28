# 多场景多轮测试报告

- 生成时间: 2026-03-28 16:26:39
- 后端地址: `http://127.0.0.1:3014`
- 轮次: 每个场景 `3` 轮
- 原始结果: `SCENARIO_MULTIROUND_TEST_RAW.json`

## 总结

- `single_asset`: `3/3` 轮完成；问题概览: R1:none | R2:report_not_success | R3:none
- `multi_asset`: `3/3` 轮完成；问题概览: R1:BTC_report_not_success,ETH_report_not_success,ETH_report_cross_target:BTC | R2:BTC_report_cross_target:ETH,ETH_report_cross_target:BTC | R3:BTC_report_cross_target:ETH,ETH_report_cross_target:BTC
- `comparison`: `3/3` 轮完成；问题概览: R1:comparison_should_not_have_target_pipelines,comparison_report_not_success,comparison_report_body_missing | R2:comparison_should_not_have_target_pipelines,comparison_report_not_success,comparison_report_body_missing | R3:comparison_should_not_have_target_pipelines,comparison_report_not_success,comparison_report_body_missing

## 逐场景详情

### single_asset

#### Round 1

- requestId: `4015f56c-5bad-4285-99bc-bfa6a8f495b3`
- status: `ready`
- elapsedSec: `121.0`
- note: Pipeline completed by worker with LangGraph orchestration.
- topNodeStatus:
  - `intent`: `success` / `gpt-5.4` / attempts=`1` / schemaCorrection=`False`
  - `planning`: `success` / `qwen3-max` / attempts=`1` / schemaCorrection=`False`
  - `analysis`: `success` / `qwen3-max` / attempts=`1` / schemaCorrection=`False`
  - `report`: `success` / `gpt-5.4` / attempts=`1` / schemaCorrection=`False`
- reportTitle: BTC未来24小时走势分析：数据不足，暂不建议方向性交易
- analysisSummary: 当前BTC分析受限于关键数据缺失，虽网络安全性无虞且项目基本面稳固，但无法确认短期价格动能或支撑阻力位。链上显示轻微卖出压力，但缺乏价格与流动性上下文，不足以形成交易依据。
- issues: `none`

#### Round 2

- requestId: `5bcf05c7-5d44-4262-9125-005928cd92d0`
- status: `ready`
- elapsedSec: `166.9`
- note: Pipeline completed by worker with LangGraph orchestration.
- topNodeStatus:
  - `intent`: `success` / `gpt-5.4` / attempts=`1` / schemaCorrection=`False`
  - `planning`: `success` / `qwen3-max` / attempts=`1` / schemaCorrection=`False`
  - `analysis`: `success` / `qwen3-max` / attempts=`1` / schemaCorrection=`False`
  - `report`: `fallback` / `gpt-5.4` / attempts=`1` / schemaCorrection=`False`
- reportTitle: BTC 分析报告 - 数据不足
- analysisSummary: 尽管比特币基础协议安全且可交易，但关键市场数据（价格、技术面、流动性）严重缺失，叠加链上显示交易所净流出带来的短期卖出压力，当前无法形成可靠的24小时走势判断。建议等待核心数据恢复后再做决策。
- issues: `report_not_success`

#### Round 3

- requestId: `da888061-1f5f-4aca-a320-1b003d7e2968`
- status: `ready`
- elapsedSec: `109.3`
- note: Pipeline completed by worker with LangGraph orchestration.
- topNodeStatus:
  - `intent`: `success` / `gpt-5.4` / attempts=`1` / schemaCorrection=`False`
  - `planning`: `success` / `qwen3-max` / attempts=`1` / schemaCorrection=`False`
  - `analysis`: `success` / `qwen3-max` / attempts=`1` / schemaCorrection=`False`
  - `report`: `success` / `gpt-5.4` / attempts=`1` / schemaCorrection=`False`
- reportTitle: BTC未来24小时走势分析：数据不足，维持观望
- analysisSummary: 尽管比特币基础协议安全且仍在活跃运行，但关键的实时市场数据（价格、成交量、技术指标、流动性）严重缺失，导致无法对接下来24小时的价格走势做出有把握的方向性判断。链上数据显示交易所净流入带来卖出压力，但缺乏价格上下文难以验证其影响程度。
- issues: `none`

### multi_asset

#### Round 1

- requestId: `e6f703b5-454e-4c61-8da6-3af6e937d443`
- status: `ready`
- elapsedSec: `160.7`
- note: Multi-target pipeline completed with per-token execution (no comparison requested).
- topNodeStatus:
  - `intent`: `success` / `gpt-5.4` / attempts=`1` / schemaCorrection=`False`
  - `planning`: `success` / `qwen3-max` / attempts=`1` / schemaCorrection=`False`
  - `analysis`: `success` / `qwen3-max` / attempts=`1` / schemaCorrection=`False`
  - `report`: `fallback` / `gpt-5.4` / attempts=`1` / schemaCorrection=`False`
- reportTitle: 多标的篮子分析
- analysisSummary: 在关键数据（价格、技术面、流动性）大面积缺失的情况下，尽管安全性和基础项目状态无虞，但无法对BTC和ETH未来24小时走势做出有效策略建议。当前链上净流入虽提示短期抛压，但缺乏价格上下文与确认信号，应暂停方向性操作直至数据恢复。
- targetPipelines: `2`
  - `BTC` reportTitle: BTC 分析报告 - 数据不足
  - `BTC` foreignSymbols: `none`
  - `BTC` nodeStatus: intent=`success` analysis=`success` report=`fallback`
  - `ETH` reportTitle: ETH 分析报告 - 数据不足
  - `ETH` foreignSymbols: `BTC`
  - `ETH` nodeStatus: intent=`success` analysis=`success` report=`fallback`
- issues: `BTC_report_not_success, ETH_report_not_success, ETH_report_cross_target:BTC`

#### Round 2

- requestId: `8b08f4e2-a394-4eae-9854-1fc3a7d3d557`
- status: `ready`
- elapsedSec: `121.1`
- note: Multi-target pipeline completed with per-token execution (no comparison requested).
- topNodeStatus:
  - `intent`: `success` / `gpt-5.4` / attempts=`1` / schemaCorrection=`False`
  - `planning`: `success` / `qwen3-max` / attempts=`1` / schemaCorrection=`False`
  - `analysis`: `success` / `qwen3-max` / attempts=`1` / schemaCorrection=`False`
  - `report`: `success` / `gpt-5.4` / attempts=`1` / schemaCorrection=`False`
- reportTitle: 多标的篮子分析
- analysisSummary: 在关键市场数据（价格、技术面、流动性）大面积缺失的情况下，尽管安全性和基础项目状态无虞，但无法对BTC和ETH未来24小时走势做出有效判断。当前链上净流入虽显示潜在卖压，但缺乏价格位置与市场结构验证，不足以支撑方向性策略。
- targetPipelines: `2`
  - `BTC` reportTitle: BTC、ETH未来24小时走势研判：数据不足，暂不建议做方向性押注
  - `BTC` foreignSymbols: `ETH`
  - `BTC` nodeStatus: intent=`success` analysis=`success` report=`success`
  - `ETH` reportTitle: BTC/ETH未来24小时研判：证据不足，暂不提供方向性押注
  - `ETH` foreignSymbols: `BTC`
  - `ETH` nodeStatus: intent=`success` analysis=`success` report=`success`
- issues: `BTC_report_cross_target:ETH, ETH_report_cross_target:BTC`

#### Round 3

- requestId: `028a9e82-9d08-4b59-92c1-4251d3783b2f`
- status: `ready`
- elapsedSec: `112.0`
- note: Multi-target pipeline completed with per-token execution (no comparison requested).
- topNodeStatus:
  - `intent`: `success` / `gpt-5.4` / attempts=`1` / schemaCorrection=`False`
  - `planning`: `success` / `qwen3-max` / attempts=`1` / schemaCorrection=`False`
  - `analysis`: `success` / `qwen3-max` / attempts=`1` / schemaCorrection=`False`
  - `report`: `success` / `gpt-5.4` / attempts=`1` / schemaCorrection=`False`
- reportTitle: 多标的篮子分析
- analysisSummary: 当前数据严重降级，虽无重大安全威胁，但关键价格与流动性信息缺失，叠加链上出现大额净流出，不足以支撑任何方向性交易决策。建议等待数据恢复后再行动。
- targetPipelines: `2`
  - `BTC` reportTitle: BTC/ETH未来24小时研判：证据不足，暂不做方向性押注
  - `BTC` foreignSymbols: `ETH`
  - `BTC` nodeStatus: intent=`success` analysis=`success` report=`success`
  - `ETH` reportTitle: BTC/ETH未来24小时走势研判：数据不足，维持观望
  - `ETH` foreignSymbols: `BTC`
  - `ETH` nodeStatus: intent=`success` analysis=`success` report=`success`
- issues: `BTC_report_cross_target:ETH, ETH_report_cross_target:BTC`

### comparison

#### Round 1

- requestId: `9f73e2ab-af15-464e-81bb-6d52e2f737b0`
- status: `ready`
- elapsedSec: `127.2`
- note: Multi-target pipeline completed with intent-driven comparison.
- topNodeStatus:
  - `intent`: `success` / `gpt-5.4` / attempts=`1` / schemaCorrection=`False`
  - `planning`: `success` / `qwen3-max` / attempts=`1` / schemaCorrection=`False`
  - `analysis`: `success` / `qwen3-max` / attempts=`1` / schemaCorrection=`False`
  - `report`: `retry_success` / `gpt-5.4` / attempts=`2` / schemaCorrection=`True`
- reportTitle: BTC vs ETH 未来7天对比：暂不判胜负，先保留中性配置
- analysisSummary: 当前数据退化严重，虽无重大安全障碍，但关键市场信号（价格、技术、流动性）缺失，导致无法形成BTC与ETH的相对强弱判断。建议暂缓配置决策，直至核心数据恢复。
- comparison.exists: `True`
- comparison.reportTitle: None
- comparison.meta: `{}`
- issues: `comparison_should_not_have_target_pipelines, comparison_report_not_success, comparison_report_body_missing`

#### Round 2

- requestId: `60014351-a5b8-4363-b507-6c31f4e52fe6`
- status: `ready`
- elapsedSec: `151.5`
- note: Multi-target pipeline completed with intent-driven comparison.
- topNodeStatus:
  - `intent`: `success` / `gpt-5.4` / attempts=`1` / schemaCorrection=`False`
  - `planning`: `success` / `qwen3-max` / attempts=`1` / schemaCorrection=`False`
  - `analysis`: `success` / `qwen3-max` / attempts=`1` / schemaCorrection=`False`
  - `report`: `retry_success` / `gpt-5.4` / attempts=`2` / schemaCorrection=`True`
- reportTitle: BTC 与 ETH 未来 7 天对比：暂无明确胜者，配置以中性观察为主
- analysisSummary: 当前数据质量严重受限，尽管BTC基础安全性和交易可用性未见硬性风险，但关键市场数据（价格、流动性、技术面）缺失使任何方向性配置建议都缺乏依据。在数据恢复前，不宜进行主动仓位调整。
- comparison.exists: `True`
- comparison.reportTitle: None
- comparison.meta: `{}`
- issues: `comparison_should_not_have_target_pipelines, comparison_report_not_success, comparison_report_body_missing`

#### Round 3

- requestId: `09835de0-83c2-4691-bf60-a788192dedb8`
- status: `ready`
- elapsedSec: `139.4`
- note: Multi-target pipeline completed with intent-driven comparison.
- topNodeStatus:
  - `intent`: `success` / `gpt-5.4` / attempts=`1` / schemaCorrection=`False`
  - `planning`: `success` / `qwen3-max` / attempts=`1` / schemaCorrection=`False`
  - `analysis`: `success` / `qwen3-max` / attempts=`1` / schemaCorrection=`False`
  - `report`: `fallback` / `gpt-5.4` / attempts=`1` / schemaCorrection=`False`
- reportTitle: 多标的对比分析报告
- analysisSummary: 当前数据环境严重受限，虽未发现硬性风险（如安全漏洞或极端流动性枯竭），但关键市场信号（价格、技术面、链上细节）大面积缺失，导致无法形成BTC与ETH的相对强弱判断或配置建议。需等待核心数据恢复后再做决策。
- comparison.exists: `True`
- comparison.reportTitle: None
- comparison.meta: `{}`
- issues: `comparison_should_not_have_target_pipelines, comparison_report_not_success, comparison_report_body_missing`

## 结论

- `single_asset`: 当前链路稳定，`intent / planning / analysis / report` 三个 LLM 节点可连续成功执行，最终报告为 Markdown 风格文本。
- `multi_asset`: 节点执行成功，但存在跨标的内容污染，独立报告未完全做到上下文隔离。
- `comparison`: 现有设计基本正确，只走最终对比报告，不生成每个标的的独立 report；但最终 comparison-report 仍存在不稳定，已观测到 schema correction 后空输出并回退。
- 当前系统整体可运行，但若目标是“稳定且符合预期”，优先级最高的问题是：`comparison-report` 稳定性，其次是 `multi_asset` 场景下的跨标的串文。
