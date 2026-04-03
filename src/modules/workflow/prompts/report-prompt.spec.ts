import { buildReportPrompts, type ReportPromptContext } from './report-prompt';

describe('buildReportPrompts', () => {
  it('includes stronger data-density and coverage instructions', () => {
    const context: ReportPromptContext = {
      language: 'zh',
      query: 'BNB价格和交易所业务之间的关系有多强？',
      taskType: 'single_asset',
      objective: 'relationship_analysis',
      sentimentBias: 'unknown',
      entities: ['BNB'],
      focusAreas: ['price_action', 'project_fundamentals', 'news_events'],
      conversationHistoryRaw: null,
      planning: {
        taskDisposition: 'analyze',
        primaryIntent: 'Explain the relationship between BNB and Binance business.',
        subTasks: ['define the relationship', 'evaluate evidence strength'],
        responseMode: 'explain',
        requiredModules: [],
        analysisQuestions: ['What is the relationship?', 'How strong is it?'],
        openResearch: {
          enabled: true,
          depth: 'deep',
          priority: 'high',
          reason: 'Need public evidence.',
          topics: ['Binance buybacks', 'BNB utility'],
          goals: ['Validate value capture'],
          preferredSources: ['binance.com'],
          mustUseInReport: true,
        },
      },
      target: {
        symbol: 'BNB',
        chain: 'bsc',
        tokenAddress: '',
      },
      market: {
        priceUsd: 585.17,
        change24hPct: -2.15,
        change7dPct: -7.25,
        change30dPct: -11.4,
        volume24hUsd: 1110000000,
        marketCapRank: 5,
        marketCapUsd: 85700000000,
        fdvUsd: 85700000000,
        circulatingSupply: 145000000,
        maxSupply: 200000000,
      },
      recentEvidence: {
        news: [
          {
            title: 'Binance expands institutional access',
            source: 'CoinDesk',
            publishedAt: '2026-04-03',
            category: 'project',
            relevanceScore: 0.82,
            url: 'https://example.com/news',
          },
        ],
        openResearch: {
          enabled: true,
          depth: 'deep',
          mustUseInReport: true,
          goals: ['Validate value capture'],
          topics: ['Binance buybacks'],
          takeaways: ['Quarterly buyback remains the key mechanism'],
          items: [
            {
              title: 'BNB auto-burn update',
              source: 'Binance',
              topic: 'buybacks',
              snippet: 'Latest burn disclosed',
              url: 'https://example.com/research',
            },
          ],
        },
      },
      signals: {
        technical: 'bearish',
        technicalDetails: {
          rsi: { value: 27.4, signal: 'bearish' },
          macd: { value: -12.32, signal: 'bearish', histogram: -4.11 },
          ma: {
            ma7: 603,
            ma25: 618,
            ma99: 640,
            signal: 'bearish',
          },
          boll: {
            upper: 640,
            middle: 612,
            lower: 584,
            signal: 'bearish',
          },
          atr: 21.5,
          swingHigh: 668,
          swingLow: 571,
        },
        onchain: 'neutral',
        onchainDetails: {
          inflowUsd: 120000000,
          outflowUsd: 145000000,
          netflowUsd: -25000000,
          exchangeCount: 2,
        },
        sentiment: 'neutral',
        sentimentDetails: {
          socialVolume: 3,
          sentimentScore: 0,
          sentimentPositive: 18.2,
          sentimentNegative: 17.9,
          devActivity: 9,
        },
        securityRisk: 'low',
        liquidityUsd: 1190000000,
        liquidityDetails: {
          volume24hUsd: 1110000000,
          liquidityDrop1hPct: null,
          priceImpact1kPct: 0.04,
          rugpullRiskSignal: 'low',
          topVenues: [
            {
              venueType: 'cex_market',
              venueName: 'Binance',
              pairLabel: 'BNB/USDT',
              quoteToken: 'USDT',
              liquidityUsd: 163000000,
              volume24hUsd: 163000000,
              priceImpact1kPct: 0.04,
              marketSharePct: 14.8,
              sourceId: 'binance',
            },
          ],
          venueCount: 3,
        },
        inflationRate: 1.2,
        projectName: 'BNB',
        projectOneLiner: 'Exchange-linked utility token',
        fundamentalsTags: ['CeFi', 'Exchange', 'BNB Chain'],
      },
      fundamentals: {
        description: 'BNB links exchange utility, BSC gas usage, and platform incentive mechanisms.',
        establishmentDate: '2017',
        totalFundingUsd: 2000000000,
        rtScore: 91.3,
        tvlScore: 71.4,
        investorCount: 2,
        topInvestors: ['Vertex Ventures', 'DST Global'],
        investorDetails: [
          { name: 'Vertex Ventures', type: 'VC' },
          { name: 'DST Global', type: 'VC' },
        ],
        teamHighlights: [
          { name: 'Richard Teng', position: 'CEO' },
          { name: 'Yi He', position: 'Co-Founder' },
        ],
        fundraisingCount: 1,
        latestRound: {
          round: 'Strategic',
          amountUsd: 2000000000,
          publishedAt: '2017-07-14',
          investors: ['Vertex Ventures'],
        },
        recentRounds: [
          {
            round: 'Strategic',
            amountUsd: 2000000000,
            valuationUsd: null,
            publishedAt: '2017-07-14',
            investors: ['Vertex Ventures'],
          },
        ],
        ecosystemCount: 3,
        ecosystemHighlights: ['BSC gas', 'Launchpool', 'Fee discount'],
        ecosystemBreakdown: {
          ecosystems: ['BNB Chain'],
          onMainNet: ['BSC gas'],
          onTestNet: [],
          planToLaunch: ['Launchpool'],
        },
        socialFollowers: 15800000,
        hotIndexScore: 64.2,
        socialLinks: ['https://x.com/binance'],
      },
      decision: {
        verdict: 'HOLD',
        confidence: 0.67,
        reason: 'Mechanism is strong but recent validation is weak.',
        buyZone: null,
        sellZone: null,
        evidence: ['Auto-burn links supply to exchange economics'],
        hardBlocks: [],
        tradingStrategy: undefined,
      },
      insights: {
        summary: 'Mechanism exists, evidence is mixed.',
        keyObservations: [],
        riskHighlights: [],
        opportunityHighlights: [],
      },
      alerts: {
        level: 'info',
        riskState: 'normal',
        redCount: 0,
        yellowCount: 0,
        topItems: [],
      },
      anomalies: {
        priceVolatility: null,
        socialActivity: null,
        onchainFlow: null,
        riskEscalation: null,
      },
      tokenomics: {
        allocation: {
          teamPct: 40,
          investorPct: 60,
          communityPct: 0,
          foundationPct: 0,
        },
        vestingSchedule: [
          {
            bucket: 'Team',
            start: '2017-07-14',
            cliffMonths: 12,
            unlockFrequency: 'monthly',
            end: '2020-07-14',
          },
        ],
        sourceUsed: ['tokenomist'],
        evidenceFields: ['allocation', 'burns', 'fundraising'],
        evidenceSources: ['tokenomist'],
        evidenceInsufficient: false,
        burns: {
          totalBurnAmount: 64250000,
          recentBurnCount: 3,
          latestBurnDate: '2026-03-30',
          burnSummary: 'Auto-burn remains active',
          recentBurns: [
            {
              burnEventLabel: 'BEP-95',
              burnType: 'PROGRAMMATIC',
              burnDate: '2026-03-30',
              amount: 2.12,
            },
          ],
        },
        buybacks: {
          totalBuybackAmount: null,
          recentBuybackCount: 0,
          latestBuybackDate: null,
          buybackSummary: null,
          recentBuybacks: [],
        },
        fundraising: {
          totalRaised: 2000000000,
          roundCount: 1,
          latestRoundDate: '2017-07-14',
          fundraisingSummary: 'Strategic raise completed',
          recentRounds: [
            {
              roundName: 'Strategic',
              fundingDate: '2017-07-14',
              amountRaised: 2000000000,
              currency: 'USD',
              valuation: null,
              investors: ['Vertex Ventures'],
            },
          ],
        },
      },
    };

    const prompts = buildReportPrompts(context);

    expect(prompts.systemPrompt).toContain('## Data Density');
    expect(prompts.systemPrompt).toContain('## Minimum Metric Surfacing Guide');
    expect(prompts.systemPrompt).toContain('include a compact verdict box');
    expect(prompts.userPrompt).toContain('## Structured Data Coverage Hints');
    expect(prompts.userPrompt).toContain('BNB/USDT');
    expect(prompts.userPrompt).toContain('Vertex Ventures');
    expect(prompts.userPrompt).toContain('Richard Teng');
    expect(prompts.userPrompt).toContain('BEP-95');
    expect(prompts.userPrompt).toContain('### 投资方明细');
    expect(prompts.userPrompt).toContain('### 销毁事件样本');
    expect(prompts.userPrompt).toContain('30天涨跌');
    expect(prompts.userPrompt).toContain('链上净流向');
    expect(prompts.userPrompt).toContain('Do not give every module equal space. Let the strongest evidence take the most room');
    expect(prompts.systemPrompt).toContain('The order above is guidance, not a rigid template');
    expect(prompts.systemPrompt).toContain('## Paragraph Design');
    expect(prompts.systemPrompt).toContain('Prefer fewer, fuller paragraphs over many 1-2 sentence fragments');
    expect(prompts.systemPrompt).toContain('## Data Explanation');
    expect(prompts.systemPrompt).toContain('## Evidence-to-Prose Rules');
    expect(prompts.systemPrompt).toContain('## Anti-Abstraction Examples');
    expect(prompts.systemPrompt).toContain('## Final Pass');
    expect(prompts.systemPrompt).toContain('## Markdown Validity');
    expect(prompts.systemPrompt).toContain('## Markdown Example');
    expect(prompts.systemPrompt).toContain('"executiveSummary" must be a single plain string paragraph');
    expect(prompts.systemPrompt).toContain('## Readability Layout');
    expect(prompts.systemPrompt).toContain('The opening Markdown skeleton is mandatory');
    expect(prompts.systemPrompt).toContain('Do not start the body directly with "##" or "###"');
    expect(prompts.systemPrompt).toContain(
      'Never start a table with a separator row like "|---|---|"',
    );
    expect(prompts.systemPrompt).toContain(
      'must be split into multiple "###" sub-sections, usually one sub-section per explicit question',
    );
    expect(prompts.systemPrompt).toContain(
      'do not use inline bold question sentences as substitutes for sub-headings',
    );
    expect(prompts.userPrompt).toContain('Keep the Markdown visually breathable');
    expect(prompts.userPrompt).toContain('prefer concrete numbers and named facts over generic summaries');
    expect(prompts.userPrompt).toContain(
      'the first explanatory paragraph should usually reference 2 or more concrete rows',
    );
    expect(prompts.userPrompt).toContain(
      'expand them in prose instead of compressing them into labels like "机构背书" or "生态支撑"',
    );
    expect(prompts.userPrompt).toContain('Keep the Markdown structurally valid and stable across runs');
    expect(prompts.userPrompt).toContain('> **结论速览**');
    expect(prompts.userPrompt).toContain(
      'Do not answer multiple explicit questions using only inline bold prompts such as "**问题？**"',
    );
    expect(prompts.userPrompt).toContain(
      'Inside each Core Answer sub-section, prefer one paragraph for the direct answer and one paragraph for the evidence-based explanation',
    );
    expect(prompts.userPrompt).toContain(
      'If a relationship-style report is generated, it still must start with the required title + verdict + core-answer shell',
    );
  });
});
