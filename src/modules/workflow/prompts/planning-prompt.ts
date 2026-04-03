import type { IntentOutput } from '../../../data/contracts/workflow-contracts';
import type { AnalyzeIdentity } from '../../../data/contracts/analyze-contracts';
import { PromptBundle, stringifyPromptContext } from './prompt-types';

export type PlanningPromptContext = {
  query: string;
  language: IntentOutput['language'];
  taskType: IntentOutput['taskType'];
  objective: IntentOutput['objective'];
  sentimentBias: IntentOutput['sentimentBias'];
  timeWindow: IntentOutput['timeWindow'];
  entities: string[];
  focusAreas: IntentOutput['focusAreas'];
  constraints: string[];
  target: {
    symbol: AnalyzeIdentity['symbol'];
    chain: AnalyzeIdentity['chain'];
    tokenAddress: AnalyzeIdentity['tokenAddress'];
  };
  allowedDataTypes: string[];
  priorityRule: {
    high: string;
    medium: string;
    low: string;
  };
  hardConstraints: string[];
  sourceCatalog: Record<string, string[]>;
};

export function buildPlanningPrompts(
  context: PlanningPromptContext,
): PromptBundle {
  const requiredKeys = [
    'taskDisposition',
    'primaryIntent',
    'subTasks',
    'responseMode',
    'requirements',
    'analysisQuestions',
    'openResearch',
  ];
  const isComparison = context.taskType === 'comparison';
  const modeRules = isComparison
    ? [
        'Comparison mode is active.',
        'Planning must be symmetric so multiple targets remain comparable under the same rubric.',
        'Do not add target-specific data types that would break fairness across candidates.',
      ]
    : ['Single-asset mode is active.'];

  return {
    systemPrompt: [
      'You are a planning node for a crypto analysis system.',
      'Return strict JSON only. No markdown, no prose, no code fences.',
      'Your job is to decide what the user is actually trying to get done and whether this request should enter the analysis workflow at all.',
      'Select a minimal but sufficient evidence plan for the intent only when analysis is appropriate.',
      'First classify the request into taskDisposition: analyze, clarify, non_analysis, or refuse.',
      'analyze = this should proceed into the crypto research workflow.',
      'clarify = the request is too ambiguous to analyze reliably and needs a short clarification.',
      'non_analysis = the user is not really asking for a crypto research report.',
      'refuse = the request should not be handled normally.',
      'First classify the user task into responseMode: explain, assess, or act.',
      'explain = user mainly wants to understand what happened, recent developments, drivers, narrative, or whether a move is fundamentals vs sentiment.',
      'assess = user mainly wants an investment judgment, value assessment, pros/cons, core drivers, and biggest risks without a trade setup.',
      'act = user explicitly wants what to do now, timing, entry, exit, support, resistance, or an execution plan.',
      'Questions about relationship, dependency, linkage, ecosystem tie, business tie, or value-capture transmission should usually stay in explain mode unless the user explicitly asks for an investment verdict or execution.',
      'Provide primaryIntent as one sentence naming the user main job-to-be-done.',
      'Provide subTasks as the concrete sub-questions the report must answer.',
      'Identify every explicit sub-question in the user ask and reflect them in analysisQuestions.',
      'Do not invent unsupported data types.',
      'Use only approved sources from sourceCatalog.',
      'Every requirements item must include dataType, required, priority, sourceHint, and reason.',
      'required must be a boolean.',
      'reason must be a non-empty string.',
      ...modeRules,
    ].join(' '),
    userPrompt: [
      'Build plan JSON using this context:',
      `Required keys: ${requiredKeys.join(', ')}.`,
      stringifyPromptContext(context),
      'Output taskDisposition, primaryIntent, subTasks, responseMode, requirements[], analysisQuestions[], and openResearch only.',
      'taskDisposition must be one of: "analyze", "clarify", "non_analysis", "refuse".',
      'If taskDisposition is not "analyze", still return a valid minimal plan so downstream systems can respond safely.',
      'primaryIntent must be a short sentence describing what the user really wants.',
      'subTasks must list the user explicit asks in plain language.',
      'responseMode must be one of: "explain", "assess", "act".',
      'Each requirement object shape is: {"dataType":"price","required":true,"priority":"high","sourceHint":["coingecko"],"reason":"..."}',
      'Each requirement.sourceHint must be a subset of sourceCatalog[dataType].',
      'analysisQuestions must map to the user’s actual asks, not generic market-analysis placeholders.',
      'If the user asks 2-4 distinct things, analysisQuestions should explicitly cover all of them.',
      'For explain mode, prioritize recent developments, fundamentals, sentiment, and open research. Keep technical or trade-oriented modules secondary unless the question explicitly asks for them.',
      'For relationship or dependency questions, analysisQuestions should explicitly cover: what the relationship is, how the linkage transmits in practice, what evidence verifies it, and what evidence would weaken it.',
      'For assess mode, prioritize market context, fundamentals, tokenomics, key risks, and whether the evidence supports an investable thesis. Do not default to a trading frame.',
      'For act mode, prioritize technical, on-chain, liquidity, security, and concrete execution constraints.',
      'openResearch shape is: {"enabled":true,"depth":"heavy","priority":"high","reason":"...","topics":["..."],"goals":["..."],"preferredSources":["coindesk.com","rootdata.com"],"mustUseInReport":true}',
      'For analyze tasks, openResearch should normally be enabled and should usually use depth = "standard" or "heavy".',
      'Enable openResearch aggressively when the user asks about recent developments, drivers, causes, risks, comparisons between explanations, ecosystem progress, or any answer that benefits from current public materials.',
      'For recent developments, ecosystem progress, driver analysis, risk analysis, or fundamentals-vs-sentiment questions, openResearch should usually be "heavy", not "light".',
      'When openResearch is enabled for those questions, plan it as evidence the final report is expected to actively use, not optional decoration.',
      'When openResearch is enabled, preferredSources should lean toward official project sources plus 2-4 reputable public sources when applicable.',
      isComparison
        ? 'For comparison, analysisQuestions must cover: upside drivers, downside drivers, risk blockers, and data-quality impact for fair cross-target ranking.'
        : 'Questions should prioritize the user objective and execution constraints.',
    ].join('\n'),
  };
}
