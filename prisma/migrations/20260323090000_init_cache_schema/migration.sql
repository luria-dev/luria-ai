-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "token_address" TEXT,
    "source_id" TEXT NOT NULL,
    "display_name" TEXT,
    "is_native" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_snapshots" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "data_type" TEXT NOT NULL,
    "time_window" TEXT,
    "source" TEXT NOT NULL,
    "cache_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "degrade_reason" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_accessed_at" TIMESTAMP(3),
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_snapshots" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "normalized_query" TEXT NOT NULL,
    "preferred_chain" TEXT,
    "cache_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "result_count" INTEGER NOT NULL DEFAULT 0,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_accessed_at" TIMESTAMP(3),
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cache_policies" (
    "id" TEXT NOT NULL,
    "data_type" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "task_type" TEXT NOT NULL,
    "ttl_seconds" INTEGER NOT NULL,
    "stale_while_revalidate_seconds" INTEGER NOT NULL DEFAULT 0,
    "max_stale_seconds" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cache_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assets_source_id_key" ON "assets"("source_id");

-- CreateIndex
CREATE INDEX "assets_symbol_chain_idx" ON "assets"("symbol", "chain");

-- CreateIndex
CREATE UNIQUE INDEX "assets_chain_token_address_key" ON "assets"("chain", "token_address");

-- CreateIndex
CREATE INDEX "assets_display_name_idx" ON "assets"("display_name");

-- CreateIndex
CREATE UNIQUE INDEX "data_snapshots_cache_key_key" ON "data_snapshots"("cache_key");

-- CreateIndex
CREATE INDEX "data_snapshots_asset_id_data_type_time_window_idx" ON "data_snapshots"("asset_id", "data_type", "time_window");

-- CreateIndex
CREATE INDEX "data_snapshots_expires_at_idx" ON "data_snapshots"("expires_at");

-- CreateIndex
CREATE INDEX "data_snapshots_data_type_expires_at_idx" ON "data_snapshots"("data_type", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "search_snapshots_cache_key_key" ON "search_snapshots"("cache_key");

-- CreateIndex
CREATE INDEX "search_snapshots_normalized_query_preferred_chain_idx" ON "search_snapshots"("normalized_query", "preferred_chain");

-- CreateIndex
CREATE INDEX "search_snapshots_expires_at_idx" ON "search_snapshots"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "cache_policies_data_type_objective_task_type_key" ON "cache_policies"("data_type", "objective", "task_type");

-- Seed default cache policies
INSERT INTO "cache_policies" (
    "id",
    "data_type",
    "objective",
    "task_type",
    "ttl_seconds",
    "stale_while_revalidate_seconds",
    "max_stale_seconds",
    "enabled",
    "notes",
    "created_at",
    "updated_at"
)
SELECT
    CONCAT('cp-', policy.data_type, '-', objective.objective, '-', task.task_type),
    policy.data_type,
    objective.objective,
    task.task_type,
    policy.ttl_seconds,
    policy.stale_while_revalidate_seconds,
    policy.max_stale_seconds,
    TRUE,
    policy.notes,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    VALUES
        ('fundamentals', 86400, 86400, 604800, 'Project profile cache'),
        ('tokenomics', 86400, 86400, 604800, 'Tokenomics snapshot cache'),
        ('security', 21600, 21600, 86400, 'Security snapshot cache'),
        ('sentiment', 3600, 1800, 7200, 'Sentiment snapshot cache'),
        ('onchain', 1800, 600, 3600, 'Onchain snapshot cache'),
        ('identity_search', 86400, 86400, 604800, 'Identity and candidate search cache')
) AS policy(
    data_type,
    ttl_seconds,
    stale_while_revalidate_seconds,
    max_stale_seconds,
    notes
)
CROSS JOIN (
    VALUES
        ('market_overview'),
        ('risk_check'),
        ('timing_decision'),
        ('news_focus'),
        ('tokenomics_focus')
) AS objective(objective)
CROSS JOIN (
    VALUES
        ('single_asset'),
        ('comparison')
) AS task(task_type);

-- AddForeignKey
ALTER TABLE "data_snapshots" ADD CONSTRAINT "data_snapshots_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
