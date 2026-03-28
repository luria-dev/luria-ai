# Luria E2E 验证报告（2026-03-28）

## 本次目标

验证三类链路在真实服务环境中的行为是否符合当前设计：

1. `single_asset`：保留单标的 `report`，且尽量由 LLM 输出 Markdown。
2. `multi_asset`：保留每个标的自己的 `report`，且各自报告不再串味、不再提及其他标的。
3. `comparison`：不再暴露每个标的 `report`，只输出最终 `comparison-report`，并同步挂载到 `payload.report` 与 `payload.comparison.report`。

## 本次代码修复

### 已修复的结构问题

1. `multi_asset` 的每标的报告改为作用域收窄提示，不再把原始多标的查询直接喂给单标的 `report`。
2. `report` prompt 增强：明确禁止在单标的报告里比较或提及其他标的。
3. `comparison-report` prompt 增强：要求 `body` 必须是单个 Markdown 字符串。
4. `comparison` 结果组装修复：
   - `payload.comparison.report` 正确挂载最终对比报告
   - `payload.report` 同步为最终对比报告
   - `payload.targetPipelines = []`

### 已修复的稳定性问题

5. `LlmRuntimeService` 的瞬时错误重试规则补充了 `"This operation was aborted"` / `aborted`。
6. 为该行为新增回归测试，确保 `report` 节点遇到此类中断时会重试，而不是直接 fallback。

## 本地测试结果

已通过：

- `pnpm build`
- `pnpm test -- --runInBand src/modules/workflow/runtime/llm-runtime.service.spec.ts src/modules/workflow/nodes/report-node.service.spec.ts src/core/orchestration/services/comparison.service.spec.ts src/core/orchestration/analyze-orchestrator.service.spec.ts`

## 真实链路验证

### 1. Single Asset

查询：`分析 BTC 接下来24小时走势，并给出策略建议`

#### 轮次 A

- `requestId`: `972fa038-868d-4846-8774-c54edc73e1b7`
- 结果：`intent/planning/analysis = success`，`report = fallback`
- 原因：日志记录 `This operation was aborted`
- 结论：在修复前，`report` 节点存在瞬时中断直接 fallback 的问题。

#### 轮次 B（修复后）

- `requestId`: `74b649fd-7ee7-4b7f-aabf-a0727e009d7f`
- 结果：
  - `intent = success`
  - `planning = success`
  - `analysis = success`
  - `report = success`
- 报告标题：`BTC 未来24小时走势分析：数据不足，建议暂缓方向性操作`
- 报告正文：Markdown 格式，正文开头为 `## 决策摘要`
- 结论：修复后单标的链路已满足“最终报告由 LLM 输出 Markdown”的要求。

### 2. Multi Asset

查询：`分析 BTC、ETH 接下来24小时走势，并分别给出策略建议`

#### 轮次 A

- `requestId`: `469460f1-6c8e-461e-a5d0-9290cb0cc912`
- 结果：
  - `intent/planning/analysis = success`
  - `report = fallback`
  - `targetPipelinesLen = 2`
- 关键观察：
  - BTC 报告只讨论 BTC
  - ETH 报告只讨论 ETH
  - 串味问题已消失
- 结论：结构问题已修复，但当时仍受 `report abort` 影响。

#### 轮次 B（修复后）

- `requestId`: `e3671980-d4da-4dbf-b872-4c4973d2908e`
- 结果：
  - `intent = success`
  - `planning = success`
  - `analysis = success`
  - `report = success`
  - `targetPipelinesLen = 2`
- 报告标题：
  - BTC: `BTC 独立分析报告`
  - ETH: `ETH 独立分析报告：数据不足，暂不形成方向性判断`
- 关键观察：
  - BTC 报告正文只写 BTC
  - ETH 报告正文只写 ETH
  - 每个标的都是 Markdown 报告
- 结论：`multi_asset` 当前已同时满足“每标的独立报告”和“避免交叉污染”。

### 3. Comparison

查询：`对比 BTC 和 ETH 接下来7天走势，并给出配置建议`

- `requestId`: `2717f42a-84b8-4183-9e8c-8c0c9208d052`
- 结果：
  - `intent = success`
  - `planning = success`
  - `analysis = success`
  - `report = success`
- 结构验证：
  - `payload.targetPipelinesLen = 0`
  - `payload.report.title` 存在
  - `payload.comparison.report.title` 存在
  - `payload.report.body` 与 `payload.comparison.report.body` 都是 Markdown 字符串
  - `payload.comparison.meta.llmStatus = success`
- 报告标题：`BTC vs ETH 未来7天对比与配置建议`
- 结论：`comparison-report` 新链路已按目标生效，且未再暴露每标的 `report`。

## 当前结论

### 可以确认已经达成的点

1. `intent` 节点已稳定走真实 `gpt-5.4`，不是 fallback。
2. `planning` / `analysis` 节点已稳定走真实 `qwen3-max`。
3. `single_asset` 与 `multi_asset` 的最终报告现在可以由真实 `gpt-5.4` 成功产出。
4. `comparison` 现在只输出最终对比报告，不再额外暴露每标的 `report`。
5. 所有最终报告正文都已是 Markdown 风格，不再是纯数据堆砌。
6. `multi_asset` 的单标的报告串味问题已经修复。

### 仍然存在的外部风险

1. CoinGecko 数据链路仍频繁超时，导致 `price` / `technical` / `liquidity` 常出现降级。
2. Santiment 交易所流入流出数据受订阅窗口限制，7d / 24h  often 会退回历史窗口。
3. 即便 `report abort` 已加重试，外部 LLM 供应商本身若持续慢或中断，仍可能在极端情况下 fallback。

## 总体判断

当前系统已经达到“结构正确、报告形态正确、主要 LLM 节点可用”的阶段，可以继续往前用。

如果按你的原始要求评估：

- “报告应该更像文字结论而不是干巴巴的数据”：已明显改善。
- “comparison 只要最终报告，不要每个标的 report”：已达成。
- “single/multi 的 report 应该尽量由模型产出且为 Markdown”：已达成，并补了中断重试。
- “系统是否稳定”：核心编排链路已稳定，主要不稳定项已经从内部逻辑问题收敛到外部数据源质量与第三方 API 波动。

