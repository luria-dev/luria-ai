import { Injectable } from '@nestjs/common';
import {
  IntentOutput,
  PlanOutput,
  PlanResponseMode,
  PlanSearchDepth,
  PlanTaskDisposition,
  planOutputSchema,
  PlanRequirement,
  WorkflowNodeExecutionMeta,
} from '../../../data/contracts/workflow-contracts';
import type { AnalyzeIdentity } from '../../../data/contracts/analyze-contracts';
import { LlmRuntimeService } from '../runtime/llm-runtime.service';
import { buildPlanningPrompts } from '../prompts';
import type { PlanningPromptContext } from '../prompts';

type BuildPlanInput = {
  intent: IntentOutput;
  identity: AnalyzeIdentity;
};

@Injectable()
export class PlanningNodeService {
  constructor(private readonly llmRuntime: LlmRuntimeService) {}

  async build(input: BuildPlanInput): Promise<PlanOutput> {
    const result = await this.buildWithMeta(input);
    return result.plan;
  }

  async buildWithMeta(input: BuildPlanInput): Promise<{
    plan: PlanOutput;
    meta: WorkflowNodeExecutionMeta;
  }> {
    const fallback = this.buildDeterministicPlan(input.intent);
    const context: PlanningPromptContext = {
      query: input.intent.userQuery,
      language: input.intent.language,
      taskType: input.intent.taskType,
      objective: input.intent.objective,
      sentimentBias: input.intent.sentimentBias,
      timeWindow: input.intent.timeWindow,
      entities: input.intent.entities,
      focusAreas: input.intent.focusAreas,
      constraints: input.intent.constraints,
      target: {
        symbol: input.identity.symbol,
        chain: input.identity.chain,
        tokenAddress: input.identity.tokenAddress,
      },
      allowedDataTypes: [
        'price',
        'news',
        'tokenomics',
        'fundamentals',
        'technical',
        'onchain',
        'security',
        'liquidity',
        'sentiment',
      ],
      priorityRule: {
        high: 'required for hard constraints and core objective',
        medium: 'important for confidence and cross-validation',
        low: 'optional enrichment only',
      },
      hardConstraints: [
        'security and liquidity must be included for tradability risk controls',
        'price should always be included',
        'sentiment should always be included for market context',
      ],
      sourceCatalog: {
        price: ['coingecko'],
        technical: ['coingecko'],
        liquidity: ['geckoterminal'],
        security: ['goplus'],
        onchain: ['santiment'],
        tokenomics: ['tokenomist'],
        fundamentals: ['rootdata'],
        news: ['coindesk'],
        sentiment: ['santiment'],
      },
    };
    const prompts = buildPlanningPrompts(context);

    const result = await this.llmRuntime.generateStructuredWithMeta({
      nodeName: 'planning',
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      schema: planOutputSchema,
      fallback: () => fallback,
    });
    return {
      plan: result.data,
      meta: result.meta,
    };
  }

  private buildDeterministicPlan(intent: IntentOutput): PlanOutput {
    const taskDisposition = this.inferTaskDisposition(intent);
    const responseMode = this.inferResponseMode(intent);
    const primaryIntent = this.inferPrimaryIntent(intent, responseMode);
    const subTasks = this.inferSubTasks(intent, responseMode);

    return {
      taskDisposition,
      primaryIntent,
      subTasks,
      responseMode,
      requirements: this.buildFallbackRequirements(taskDisposition, responseMode),
      analysisQuestions: this.buildFallbackAnalysisQuestions(
        subTasks,
        responseMode,
      ),
      openResearch: this.buildOpenResearchPlan(
        intent,
        responseMode,
        taskDisposition,
        subTasks,
      ),
    };
  }

  private buildOpenResearchPlan(
    intent: IntentOutput,
    responseMode: PlanResponseMode,
    taskDisposition: PlanTaskDisposition,
    subTasks: string[],
  ): PlanOutput['openResearch'] {
    const normalizedQuery = intent.userQuery.toLowerCase();
    const symbol = intent.entities[0] ?? 'the target asset';
    const shouldSearch = taskDisposition === 'analyze';
    const depth = this.inferSearchDepth(intent, responseMode, subTasks);
    const topics = [
      `current public materials about ${symbol}`,
      ...subTasks.map((task) => `${symbol} ${task}`),
    ];

    if (
      normalizedQuery.includes('l2') ||
      normalizedQuery.includes('layer 2') ||
      normalizedQuery.includes('二层')
    ) {
      topics.push(`layer 2 progress around ${symbol}`);
    }

    return {
      enabled: shouldSearch,
      depth,
      priority: depth === 'heavy' ? 'high' : 'medium',
      reason: shouldSearch
        ? 'Open research is enabled by default for analysis tasks so the system can use current public materials, not only internal structured modules.'
        : 'This request should not enter the normal analysis workflow, so open research is not required.',
      topics: [...new Set(topics)].slice(0, depth === 'heavy' ? 6 : 4),
      goals: shouldSearch
        ? [
            'Answer the user explicit sub-questions with current public evidence.',
            'Use external evidence to confirm, challenge, or sharpen the report conclusion.',
            responseMode === 'act'
              ? 'Check whether near-term public information changes the execution frame.'
              : 'Improve freshness, context, and readability for non-specialist readers.',
          ]
        : ['Decide the safest non-analysis response for the user request.'],
      preferredSources: shouldSearch
        ? this.buildPreferredResearchSources(intent, normalizedQuery)
        : [],
      mustUseInReport: shouldSearch,
    };
  }

  private inferTaskDisposition(intent: IntentOutput): PlanTaskDisposition {
    const query = intent.userQuery.toLowerCase();
    if (
      this.matchesAnyKeyword(query, [
        'ignore previous',
        'hack',
        'steal',
        'attack',
        'bypass',
        '漏洞利用',
        '攻击',
        '盗取',
      ])
    ) {
      return 'refuse';
    }

    if (
      this.matchesAnyKeyword(query, [
        '写邮件',
        '翻译',
        '改文案',
        '写诗',
        '讲笑话',
        'translate',
        'rewrite this',
        'write an email',
      ])
    ) {
      return 'non_analysis';
    }

    if (
      intent.entities.length === 0 &&
      !this.matchesAnyKeyword(query, [
        'btc',
        'eth',
        'sol',
        '比特币',
        '以太坊',
        'solana',
      ])
    ) {
      return 'clarify';
    }

    return 'analyze';
  }

  private inferResponseMode(intent: IntentOutput): PlanResponseMode {
    const query = intent.userQuery.toLowerCase();
    const actKeywords = [
      'buy',
      'sell',
      'entry',
      'exit',
      'support',
      'resistance',
      'take profit',
      'stop loss',
      'timing',
      'how to trade',
      '怎么买',
      '怎么卖',
      '怎么做',
      '进场',
      '出场',
      '支撑',
      '阻力',
      '止盈',
      '止损',
      '仓位',
      '操作',
      '时机',
    ];
    if (
      intent.objective === 'timing_decision' ||
      actKeywords.some((keyword) => query.includes(keyword))
    ) {
      return 'act';
    }

    const assessKeywords = [
      'invest',
      'investment',
      'worth',
      'should i buy',
      'risk',
      'thesis',
      'valuation',
      '适合投资',
      '值得投资',
      '投资价值',
      '核心驱动',
      '最大风险',
      '怎么看',
      '值不值得',
    ];
    if (
      intent.objective === 'risk_check' ||
      assessKeywords.some((keyword) => query.includes(keyword))
    ) {
      return 'assess';
    }

    return 'explain';
  }

  private inferPrimaryIntent(
    intent: IntentOutput,
    responseMode: PlanResponseMode,
  ): string {
    const symbol = intent.entities[0] ?? 'the target asset';
    return responseMode === 'act'
      ? `The user wants an execution-oriented answer about ${symbol}.`
      : responseMode === 'assess'
        ? `The user wants an investment judgment about ${symbol}, with reasons and risks.`
        : `The user wants to understand what is happening around ${symbol} and why it matters.`;
  }

  private inferSubTasks(
    intent: IntentOutput,
    responseMode: PlanResponseMode,
  ): string[] {
    const query = intent.userQuery.toLowerCase();
    const symbol = intent.entities[0] ?? 'the target asset';
    const tasks: string[] = [];

    if (
      query.includes('最近') ||
      query.includes('最新') ||
      query.includes('动向') ||
      query.includes('进展') ||
      query.includes('recent') ||
      query.includes('latest')
    ) {
      tasks.push(`what changed recently around ${symbol}`);
    }

    if (
      query.includes('l2') ||
      query.includes('layer 2') ||
      query.includes('二层')
    ) {
      tasks.push(`how real the layer-2 or ecosystem progress around ${symbol} is`);
    }

    if (
      query.includes('核心驱动') ||
      query.includes('driver') ||
      query.includes('drivers') ||
      query.includes('why') ||
      query.includes('为什么') ||
      query.includes('原因')
    ) {
      tasks.push(`what is driving the current move in ${symbol}`);
    }

    if (
      query.includes('最大风险') ||
      query.includes('risk') ||
      query.includes('risks') ||
      query.includes('风险')
    ) {
      tasks.push(`what the biggest current risk is for ${symbol}`);
    }

    if (
      query.includes('适合投资') ||
      query.includes('值不值得') ||
      query.includes('investment') ||
      query.includes('invest')
    ) {
      tasks.push(`whether ${symbol} looks investable right now and why`);
    }

    if (
      query.includes('基本面') ||
      query.includes('fundamental') ||
      query.includes('fundamentals') ||
      query.includes('情绪') ||
      query.includes('sentiment')
    ) {
      tasks.push(`whether the move in ${symbol} is more fundamentals-driven or sentiment-driven`);
    }

    const defaults =
      responseMode === 'explain'
        ? [
            `what changed recently around ${symbol}`,
            `what is still uncertain or easy to overread`,
          ]
        : responseMode === 'assess'
          ? [
              `what supports paying attention to ${symbol} right now`,
              `how to interpret the current investment case without turning it into a trade call`,
            ]
          : [
              `what matters for acting on ${symbol} right now`,
              'which conditions must be confirmed before taking action',
            ];

    return [...new Set([...tasks, ...defaults])].slice(0, 5);
  }

  private buildPreferredResearchSources(
    intent: IntentOutput,
    normalizedQuery: string,
  ): string[] {
    const symbol = (intent.entities[0] ?? '').toLowerCase();
    const sources = ['coindesk.com', 'rootdata.com'];

    if (symbol === 'eth' || normalizedQuery.includes('l2')) {
      sources.push('blog.ethereum.org', 'ethereum.org', 'l2beat.com');
    }
    if (symbol === 'btc') {
      sources.push('bitcoin.org');
    }
    if (symbol === 'sol') {
      sources.push('solana.com');
    }
    if (
      normalizedQuery.includes('fundraising') ||
      normalizedQuery.includes('融资') ||
      normalizedQuery.includes('基本面')
    ) {
      sources.push('theblock.co');
    }

    return [...new Set(sources)].slice(0, 5);
  }

  private buildFallbackRequirements(
    taskDisposition: PlanTaskDisposition,
    responseMode: PlanResponseMode,
  ): PlanRequirement[] {
    if (taskDisposition !== 'analyze') {
      return [
        {
          dataType: 'news',
          required: false,
          priority: 'low',
          sourceHint: ['coindesk'],
          reason: 'No structured market fetch is needed before clarifying or declining the request.',
        },
      ];
    }

    if (responseMode === 'act') {
      return [
        {
          dataType: 'price',
          required: true,
          priority: 'high',
          sourceHint: ['coingecko'],
          reason: 'Price context is necessary for action-oriented questions.',
        },
        {
          dataType: 'technical',
          required: true,
          priority: 'high',
          sourceHint: ['coingecko'],
          reason: 'Execution questions need market structure and timing context.',
        },
        {
          dataType: 'onchain',
          required: true,
          priority: 'medium',
          sourceHint: ['santiment'],
          reason: 'On-chain data helps confirm whether the move has participation behind it.',
        },
        {
          dataType: 'security',
          required: true,
          priority: 'high',
          sourceHint: ['goplus'],
          reason: 'Risk guardrails must still apply before action.',
        },
      ];
    }

    if (responseMode === 'assess') {
      return [
        {
          dataType: 'price',
          required: true,
          priority: 'medium',
          sourceHint: ['coingecko'],
          reason: 'Price gives current context but should not dominate the investment judgment.',
        },
        {
          dataType: 'fundamentals',
          required: true,
          priority: 'high',
          sourceHint: ['rootdata'],
          reason: 'Investment questions need project and ecosystem context.',
        },
        {
          dataType: 'tokenomics',
          required: true,
          priority: 'medium',
          sourceHint: ['tokenomist'],
          reason: 'Supply-side structure can change the investment case.',
        },
        {
          dataType: 'security',
          required: true,
          priority: 'medium',
          sourceHint: ['goplus'],
          reason: 'Security issues can invalidate the thesis.',
        },
      ];
    }

    return [
      {
        dataType: 'price',
        required: true,
        priority: 'medium',
        sourceHint: ['coingecko'],
        reason: 'Price gives simple market context for an explanatory answer.',
      },
      {
        dataType: 'news',
        required: true,
        priority: 'high',
        sourceHint: ['coindesk'],
        reason: 'Recent changes usually need current public information.',
      },
      {
        dataType: 'fundamentals',
        required: true,
        priority: 'medium',
        sourceHint: ['rootdata'],
        reason: 'Explanatory answers need product and ecosystem context.',
      },
      {
        dataType: 'sentiment',
        required: true,
        priority: 'medium',
        sourceHint: ['santiment'],
        reason: 'Sentiment helps judge whether the move is narrative-heavy.',
      },
    ];
  }

  private buildFallbackAnalysisQuestions(
    subTasks: string[],
    responseMode: PlanResponseMode,
  ): string[] {
    const questions = subTasks.map((task) =>
      task.endsWith('?') ? task : `${task}?`,
    );

    const defaultQuestion =
      responseMode === 'act'
        ? 'What conditions must be confirmed before acting?'
        : responseMode === 'assess'
          ? 'What could make this investment view wrong?'
          : 'What is still uncertain or easy to overread?';

    return [...new Set([...questions, defaultQuestion])].slice(0, 5);
  }

  private inferSearchDepth(
    intent: IntentOutput,
    responseMode: PlanResponseMode,
    subTasks: string[],
  ): PlanSearchDepth {
    const query = intent.userQuery.toLowerCase();
    if (
      subTasks.length >= 3 ||
      responseMode === 'assess' ||
      this.matchesAnyKeyword(query, [
        'l2',
        'layer 2',
        '最近',
        '最新',
        '核心驱动',
        '最大风险',
        '为什么',
      ])
    ) {
      return 'heavy';
    }

    return responseMode === 'act' ? 'standard' : 'heavy';
  }

  private matchesAnyKeyword(query: string, keywords: string[]): boolean {
    const normalizedQuery = query.toLowerCase();
    return keywords.some((keyword) => normalizedQuery.includes(keyword));
  }
}
