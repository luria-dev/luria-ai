import { Injectable } from '@nestjs/common';
import {
  IntentOutput,
  PlanOutput,
  planOutputSchema,
  PlanRequirement,
} from '../../core/contracts/workflow-contracts';
import type { AnalyzeIdentity } from '../../core/contracts/analyze-contracts';
import { LlmRuntimeService } from './llm-runtime.service';

type BuildPlanInput = {
  intent: IntentOutput;
  identity: AnalyzeIdentity;
};

@Injectable()
export class PlanningNodeService {
  constructor(private readonly llmRuntime: LlmRuntimeService) {}

  async build(input: BuildPlanInput): Promise<PlanOutput> {
    const fallback = this.buildDeterministicPlan(input.intent);
    const context = {
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
      allowedDataTypes: ['price', 'news', 'tokenomics', 'technical', 'onchain', 'security', 'liquidity'],
      priorityRule: {
        high: 'required for hard constraints and core objective',
        medium: 'important for confidence and cross-validation',
        low: 'optional enrichment only',
      },
      hardConstraints: [
        'security and liquidity must be included for tradability risk controls',
        'price should always be included',
      ],
    };

    return this.llmRuntime.generateStructured({
      nodeName: 'planning',
      systemPrompt:
        [
          'You are a planning node for a crypto analysis system.',
          'Return strict JSON only. No markdown, no prose, no code fences.',
          'Select a minimal but sufficient evidence plan for the intent.',
          'Do not invent unsupported data types.',
        ].join(' '),
      userPrompt: [
        'Build plan JSON using this context:',
        JSON.stringify(context),
        'Output requirements[] and analysisQuestions[] only.',
      ].join('\n'),
      schema: planOutputSchema,
      fallback: () => fallback,
    });
  }

  private buildDeterministicPlan(intent: IntentOutput): PlanOutput {
    const requirements = new Map<PlanRequirement['dataType'], PlanRequirement>();

    const upsert = (requirement: PlanRequirement) => {
      requirements.set(requirement.dataType, requirement);
    };

    upsert({
      dataType: 'price',
      required: true,
      priority: 'high',
      sourceHint: ['dexscreener', 'coingecko'],
      reason: 'Base price context is required for any market judgment.',
    });
    upsert({
      dataType: 'security',
      required: true,
      priority: 'high',
      sourceHint: ['goplus'],
      reason: 'Security redlines are hard constraints for strategy.',
    });
    upsert({
      dataType: 'liquidity',
      required: true,
      priority: 'high',
      sourceHint: ['dexscreener'],
      reason: 'Liquidity quality gates tradability and slippage risk.',
    });

    if (intent.objective === 'news_focus' || intent.focusAreas.includes('news_events')) {
      upsert({
        dataType: 'news',
        required: true,
        priority: 'high',
        sourceHint: ['cryptopanic', 'surf'],
        reason: 'Requested intent focuses on latest events and announcements.',
      });
    }

    if (intent.objective === 'tokenomics_focus' || intent.focusAreas.includes('tokenomics')) {
      upsert({
        dataType: 'tokenomics',
        required: true,
        priority: 'high',
        sourceHint: ['messari', 'coingecko', 'tokenomist'],
        reason: 'Tokenomics evidence is required for supply/unlock risk.',
      });
    } else {
      upsert({
        dataType: 'tokenomics',
        required: true,
        priority: 'medium',
        sourceHint: ['messari', 'coingecko', 'tokenomist'],
        reason: 'Tokenomics evidence stabilizes confidence in final verdict.',
      });
    }

    if (intent.objective === 'timing_decision' || intent.focusAreas.includes('technical_indicators')) {
      upsert({
        dataType: 'technical',
        required: true,
        priority: 'high',
        sourceHint: ['coingecko'],
        reason: 'Entry/exit intent requires technical indicator confirmation.',
      });
      upsert({
        dataType: 'onchain',
        required: true,
        priority: 'high',
        sourceHint: ['coinglass', 'santiment'],
        reason: 'Capital flow confirms buy/sell pressure for timing decisions.',
      });
    } else {
      upsert({
        dataType: 'technical',
        required: true,
        priority: 'medium',
        sourceHint: ['coingecko'],
        reason: 'Technical signal provides directional context.',
      });
      upsert({
        dataType: 'onchain',
        required: true,
        priority: 'medium',
        sourceHint: ['coinglass', 'santiment'],
        reason: 'Onchain flow supports pressure confirmation.',
      });
    }

    const analysisQuestions = [
      'What are the dominant bullish and bearish signals in this window?',
      'Do risk constraints invalidate aggressive long positions?',
      'How much degraded data affects decision confidence?',
    ];
    if (intent.taskType === 'comparison' && intent.entities.length >= 2) {
      analysisQuestions.push(
        `For comparison, which target has better risk-adjusted profile among: ${intent.entities.join(', ')}?`,
      );
    }

    return {
      requirements: [...requirements.values()],
      analysisQuestions,
    };
  }
}
