-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DEPRECATED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "JourneyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "JourneyNodeKind" AS ENUM ('TRIGGER', 'DELAY', 'CONDITION', 'SPLIT', 'MESSAGE', 'ACTION', 'EXIT');

-- CreateEnum
CREATE TYPE "JourneyRunStatus" AS ENUM ('RUNNING', 'WAITING', 'COMPLETED', 'EXITED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'CONCLUDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OptimizationKind" AS ENUM ('BUDGET', 'CHANNEL', 'CREATIVE', 'TIMING', 'AUDIENCE');

-- CreateEnum
CREATE TYPE "BudgetMode" AS ENUM ('FIXED', 'PACING', 'AUTO');

-- CreateEnum
CREATE TYPE "KpiModule" AS ENUM ('CAMPAIGN', 'CHANNEL', 'AUDIENCE', 'CONTENT', 'OFFER', 'OPERATIONS');

-- CreateEnum
CREATE TYPE "KpiUnit" AS ENUM ('CURRENCY', 'COUNT', 'RATIO', 'BPS');

-- CreateEnum
CREATE TYPE "OutcomeKind" AS ENUM ('IMPRESSION', 'CLICK', 'CONVERSION', 'REVENUE', 'REDEMPTION', 'SIGNUP', 'SUBSCRIPTION', 'CHURN', 'CUSTOM');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'REVIEW', 'MANUAL_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'PENDING_SIGNATURE', 'SIGNED', 'ACTIVE', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "HierarchyRelation" AS ENUM ('SUBSIDIARY', 'DIVISION', 'FRANCHISE', 'PARTNER', 'RESELLER');

-- CreateEnum
CREATE TYPE "PreferenceKind" AS ENUM ('CHANNEL', 'TIMEZONE', 'CONTENT_LANGUAGE', 'FREQUENCY', 'TOPIC', 'OPT_OUT');

-- CreateEnum
CREATE TYPE "LookalikeStatus" AS ENUM ('QUEUED', 'RUNNING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "PredictiveKind" AS ENUM ('CHURN', 'CONVERSION', 'LIFETIME_VALUE', 'ENGAGEMENT', 'NEXT_BEST_ACTION');

-- CreateEnum
CREATE TYPE "ContentVersionStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "LocalizationStatus" AS ENUM ('PENDING', 'TRANSLATED', 'REVIEWED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ContentScoreKind" AS ENUM ('READABILITY', 'SEO', 'ENGAGEMENT', 'BRAND_SENTIMENT', 'ACCESSIBILITY');

-- CreateEnum
CREATE TYPE "VoucherKind" AS ENUM ('CASHBACK', 'VOUCHER', 'REWARD', 'GIFT_CARD', 'STORE_CREDIT');

-- CreateEnum
CREATE TYPE "VoucherStatus" AS ENUM ('ISSUED', 'PARTIALLY_REDEEMED', 'REDEEMED', 'EXPIRED', 'VOID');

-- CreateEnum
CREATE TYPE "LoyaltyTxnKind" AS ENUM ('EARN', 'BURN', 'ADJUST', 'EXPIRE');

-- CreateEnum
CREATE TYPE "CommissionKind" AS ENUM ('PERCENT', 'FIXED', 'HYBRID');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('ACCRUED', 'APPROVED', 'PAID', 'REVERSED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('OPEN', 'PROCESSING', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "FraudSignalKind" AS ENUM ('VELOCITY', 'DEVICE_REUSE', 'IP_CLUSTER', 'GEO_MISMATCH', 'REPEATED_CANCELLATION', 'IMPOSSIBLE_TRAVEL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AttributionModelKind" AS ENUM ('LAST_TOUCH', 'FIRST_TOUCH', 'LINEAR', 'POSITION_BASED', 'TIME_DECAY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AttributionTouchKind" AS ENUM ('IMPRESSION', 'CLICK', 'CONVERSION');

-- CreateEnum
CREATE TYPE "AutonomousMode" AS ENUM ('OFF', 'ASSIST', 'AUTO');

-- CreateEnum
CREATE TYPE "KnowledgeKind" AS ENUM ('FAQ', 'PLAYBOOK', 'ARTICLE', 'POLICY', 'RUNBOOK', 'TEMPLATE');

-- CreateEnum
CREATE TYPE "DigitalTwinSubject" AS ENUM ('CLIENT', 'CAMPAIGN', 'AUDIENCE', 'CHANNEL', 'OFFER');

-- CreateEnum
CREATE TYPE "ComplianceFramework" AS ENUM ('GDPR', 'CCPA', 'HIPAA', 'SOC2', 'ISO27001', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ComplianceCheckStatus" AS ENUM ('PASS', 'WARN', 'FAIL', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "PortalKind" AS ENUM ('CLIENT', 'PARTNER', 'AGENCY', 'ADMIN');

-- CreateTable
CREATE TABLE "CampaignTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "description" TEXT,
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "definition" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changeNote" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Journey" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "JourneyStatus" NOT NULL DEFAULT 'DRAFT',
    "triggerEvent" TEXT NOT NULL DEFAULT 'campaign.launched',
    "definition" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Journey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyNode" (
    "id" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "kind" "JourneyNodeKind" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "nextIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JourneyNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyRun" (
    "id" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "currentNodeId" TEXT,
    "status" "JourneyRunStatus" NOT NULL DEFAULT 'RUNNING',
    "context" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JourneyRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleDefinition" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "appliesTo" TEXT NOT NULL DEFAULT 'CAMPAIGN',
    "predicate" JSONB NOT NULL DEFAULT '{}',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionPolicy" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inputs" JSONB NOT NULL DEFAULT '[]',
    "outcome" JSONB NOT NULL DEFAULT '{}',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecisionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT,
    "status" "ExperimentStatus" NOT NULL DEFAULT 'DRAFT',
    "variants" JSONB NOT NULL DEFAULT '[]',
    "metric" TEXT NOT NULL DEFAULT 'conversion',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "winnerVariant" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentAssignment" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "convertedAt" TIMESTAMP(3),
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptimizationRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT,
    "kind" "OptimizationKind" NOT NULL,
    "input" JSONB NOT NULL DEFAULT '{}',
    "recommendation" JSONB NOT NULL DEFAULT '{}',
    "expectedUpliftBps" INTEGER NOT NULL DEFAULT 0,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OptimizationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetPlan" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "mode" "BudgetMode" NOT NULL DEFAULT 'FIXED',
    "totalMinor" BIGINT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "allocations" JSONB NOT NULL DEFAULT '[]',
    "pacingJson" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiDef" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "module" "KpiModule" NOT NULL DEFAULT 'CAMPAIGN',
    "unit" "KpiUnit" NOT NULL DEFAULT 'COUNT',
    "targetValue" BIGINT NOT NULL DEFAULT 0,
    "thresholdValue" BIGINT NOT NULL DEFAULT 0,
    "direction" TEXT NOT NULL DEFAULT 'UP',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiSnapshot" (
    "id" TEXT NOT NULL,
    "kpiId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KpiSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutcomeEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT,
    "subjectKey" TEXT NOT NULL,
    "kind" "OutcomeKind" NOT NULL DEFAULT 'CONVERSION',
    "channelCode" TEXT,
    "valueMinor" BIGINT NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL DEFAULT 'INR',
    "meta" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutcomeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientKyc" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "documents" JSONB NOT NULL DEFAULT '[]',
    "reviewerNote" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientKyc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "valueMinor" BIGINT NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL DEFAULT 'INR',
    "terms" TEXT,
    "signedAt" TIMESTAMP(3),
    "fileUrl" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgHierarchy" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "parentClientId" TEXT NOT NULL,
    "childClientId" TEXT NOT NULL,
    "relation" "HierarchyRelation" NOT NULL DEFAULT 'SUBSIDIARY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgHierarchy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecipientPreference" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "kind" "PreferenceKind" NOT NULL,
    "value" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecipientPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LookalikeJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "seedAudienceId" TEXT NOT NULL,
    "resultAudienceId" TEXT,
    "name" TEXT NOT NULL,
    "sizeRequested" INTEGER NOT NULL DEFAULT 1000,
    "similarityBps" INTEGER NOT NULL DEFAULT 0,
    "status" "LookalikeStatus" NOT NULL DEFAULT 'QUEUED',
    "features" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "LookalikeJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredictiveScore" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT,
    "subjectKey" TEXT NOT NULL,
    "kind" "PredictiveKind" NOT NULL,
    "scoreBps" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT NOT NULL DEFAULT 'heuristic-v1',
    "features" JSONB NOT NULL DEFAULT '{}',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PredictiveScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "status" "ContentVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "changeNote" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentTranslation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "LocalizationStatus" NOT NULL DEFAULT 'PENDING',
    "translatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentScore" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "kind" "ContentScoreKind" NOT NULL,
    "scoreBps" INTEGER NOT NULL DEFAULT 0,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Voucher" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "offerId" TEXT,
    "code" TEXT NOT NULL,
    "kind" "VoucherKind" NOT NULL,
    "valueMinor" BIGINT NOT NULL DEFAULT 0,
    "balanceMinor" BIGINT NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL DEFAULT 'INR',
    "recipientKey" TEXT,
    "status" "VoucherStatus" NOT NULL DEFAULT 'ISSUED',
    "expiresAt" TIMESTAMP(3),
    "meta" JSONB NOT NULL DEFAULT '{}',
    "issuedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyAccount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT,
    "recipientKey" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'BASE',
    "points" INTEGER NOT NULL DEFAULT 0,
    "lifetimePoints" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyTxn" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" "LoyaltyTxnKind" NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyTxn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DynamicPriceRule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "appliesTo" JSONB NOT NULL DEFAULT '{}',
    "formula" JSONB NOT NULL DEFAULT '{}',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DynamicPriceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionRule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "partnerKey" TEXT NOT NULL,
    "kind" "CommissionKind" NOT NULL DEFAULT 'PERCENT',
    "valueBps" INTEGER NOT NULL DEFAULT 0,
    "valueMinor" BIGINT NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ruleId" TEXT,
    "partnerKey" TEXT NOT NULL,
    "invoiceId" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'INR',
    "status" "CommissionStatus" NOT NULL DEFAULT 'ACCRUED',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "partnerKey" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL DEFAULT 'INR',
    "status" "SettlementStatus" NOT NULL DEFAULT 'OPEN',
    "reference" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraudSignal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "kind" "FraudSignalKind" NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FraudSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributionTouch" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT,
    "trackedLinkId" TEXT,
    "subjectKey" TEXT NOT NULL,
    "channelCode" TEXT,
    "kind" "AttributionTouchKind" NOT NULL,
    "valueMinor" BIGINT NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL DEFAULT 'INR',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttributionTouch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributionResult" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT,
    "subjectKey" TEXT NOT NULL,
    "model" "AttributionModelKind" NOT NULL DEFAULT 'LAST_TOUCH',
    "creditBps" JSONB NOT NULL DEFAULT '{}',
    "touchCount" INTEGER NOT NULL DEFAULT 0,
    "revenueMinor" BIGINT NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttributionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Funnel" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Funnel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunnelStep" (
    "id" TEXT NOT NULL,
    "funnelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "predicate" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "FunnelStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunnelSnapshot" (
    "id" TEXT NOT NULL,
    "funnelId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "counts" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FunnelSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversionPrediction" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT,
    "subjectKey" TEXT NOT NULL,
    "scoreBps" INTEGER NOT NULL DEFAULT 0,
    "features" JSONB NOT NULL DEFAULT '{}',
    "model" TEXT NOT NULL DEFAULT 'heuristic-v1',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversionPrediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelOptimization" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT,
    "kind" "OptimizationKind" NOT NULL DEFAULT 'CHANNEL',
    "recommendation" JSONB NOT NULL DEFAULT '{}',
    "expectedUpliftBps" INTEGER NOT NULL DEFAULT 0,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelOptimization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutonomousPolicy" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT,
    "mode" "AutonomousMode" NOT NULL DEFAULT 'ASSIST',
    "budgetRule" JSONB NOT NULL DEFAULT '{}',
    "actionRule" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutonomousPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutonomousAction" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "beforeJson" JSONB NOT NULL DEFAULT '{}',
    "afterJson" JSONB NOT NULL DEFAULT '{}',
    "approvedById" TEXT,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutonomousAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" "KnowledgeKind" NOT NULL DEFAULT 'ARTICLE',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceRef" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchIndexRow" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tokens" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchIndexRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigitalTwinModel" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "subjectType" "DigitalTwinSubject" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "state" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigitalTwinModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompliancePolicy" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "framework" "ComplianceFramework" NOT NULL DEFAULT 'CUSTOM',
    "rules" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompliancePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceCheck" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "status" "ComplianceCheckStatus" NOT NULL DEFAULT 'PASS',
    "findings" JSONB NOT NULL DEFAULT '[]',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalMember" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT,
    "userId" TEXT NOT NULL,
    "kind" "PortalKind" NOT NULL DEFAULT 'CLIENT',
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "invitedById" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalInvite" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT,
    "kind" "PortalKind" NOT NULL DEFAULT 'CLIENT',
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignTemplate_orgId_status_category_idx" ON "CampaignTemplate"("orgId", "status", "category");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignTemplate_orgId_code_key" ON "CampaignTemplate"("orgId", "code");

-- CreateIndex
CREATE INDEX "CampaignVersion_orgId_createdAt_idx" ON "CampaignVersion"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignVersion_campaignId_version_key" ON "CampaignVersion"("campaignId", "version");

-- CreateIndex
CREATE INDEX "Journey_orgId_status_idx" ON "Journey"("orgId", "status");

-- CreateIndex
CREATE INDEX "JourneyNode_journeyId_position_idx" ON "JourneyNode"("journeyId", "position");

-- CreateIndex
CREATE INDEX "JourneyRun_journeyId_status_idx" ON "JourneyRun"("journeyId", "status");

-- CreateIndex
CREATE INDEX "JourneyRun_orgId_subjectKey_idx" ON "JourneyRun"("orgId", "subjectKey");

-- CreateIndex
CREATE INDEX "RuleDefinition_orgId_appliesTo_active_idx" ON "RuleDefinition"("orgId", "appliesTo", "active");

-- CreateIndex
CREATE UNIQUE INDEX "RuleDefinition_orgId_code_key" ON "RuleDefinition"("orgId", "code");

-- CreateIndex
CREATE INDEX "DecisionPolicy_orgId_active_idx" ON "DecisionPolicy"("orgId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionPolicy_orgId_code_key" ON "DecisionPolicy"("orgId", "code");

-- CreateIndex
CREATE INDEX "Experiment_orgId_status_idx" ON "Experiment"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Experiment_orgId_code_key" ON "Experiment"("orgId", "code");

-- CreateIndex
CREATE INDEX "ExperimentAssignment_orgId_variant_idx" ON "ExperimentAssignment"("orgId", "variant");

-- CreateIndex
CREATE UNIQUE INDEX "ExperimentAssignment_experimentId_subjectKey_key" ON "ExperimentAssignment"("experimentId", "subjectKey");

-- CreateIndex
CREATE INDEX "OptimizationRun_orgId_kind_createdAt_idx" ON "OptimizationRun"("orgId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetPlan_campaignId_key" ON "BudgetPlan"("campaignId");

-- CreateIndex
CREATE INDEX "KpiDef_orgId_module_active_idx" ON "KpiDef"("orgId", "module", "active");

-- CreateIndex
CREATE UNIQUE INDEX "KpiDef_orgId_code_key" ON "KpiDef"("orgId", "code");

-- CreateIndex
CREATE INDEX "KpiSnapshot_orgId_date_idx" ON "KpiSnapshot"("orgId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "KpiSnapshot_kpiId_date_key" ON "KpiSnapshot"("kpiId", "date");

-- CreateIndex
CREATE INDEX "OutcomeEvent_orgId_kind_at_idx" ON "OutcomeEvent"("orgId", "kind", "at");

-- CreateIndex
CREATE INDEX "OutcomeEvent_orgId_campaignId_at_idx" ON "OutcomeEvent"("orgId", "campaignId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "ClientKyc_clientId_key" ON "ClientKyc"("clientId");

-- CreateIndex
CREATE INDEX "Contract_orgId_clientId_status_idx" ON "Contract"("orgId", "clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_orgId_code_key" ON "Contract"("orgId", "code");

-- CreateIndex
CREATE INDEX "OrgHierarchy_orgId_parentClientId_idx" ON "OrgHierarchy"("orgId", "parentClientId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgHierarchy_parentClientId_childClientId_key" ON "OrgHierarchy"("parentClientId", "childClientId");

-- CreateIndex
CREATE INDEX "RecipientPreference_orgId_kind_idx" ON "RecipientPreference"("orgId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "RecipientPreference_orgId_subjectKey_kind_key" ON "RecipientPreference"("orgId", "subjectKey", "kind");

-- CreateIndex
CREATE INDEX "LookalikeJob_orgId_status_idx" ON "LookalikeJob"("orgId", "status");

-- CreateIndex
CREATE INDEX "PredictiveScore_orgId_kind_subjectKey_idx" ON "PredictiveScore"("orgId", "kind", "subjectKey");

-- CreateIndex
CREATE INDEX "ContentVersion_orgId_createdAt_idx" ON "ContentVersion"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentVersion_postId_version_key" ON "ContentVersion"("postId", "version");

-- CreateIndex
CREATE INDEX "ContentTranslation_orgId_status_idx" ON "ContentTranslation"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContentTranslation_postId_locale_key" ON "ContentTranslation"("postId", "locale");

-- CreateIndex
CREATE INDEX "ContentScore_orgId_kind_idx" ON "ContentScore"("orgId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ContentScore_postId_kind_key" ON "ContentScore"("postId", "kind");

-- CreateIndex
CREATE INDEX "Voucher_orgId_status_idx" ON "Voucher"("orgId", "status");

-- CreateIndex
CREATE INDEX "Voucher_orgId_recipientKey_idx" ON "Voucher"("orgId", "recipientKey");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_orgId_code_key" ON "Voucher"("orgId", "code");

-- CreateIndex
CREATE INDEX "LoyaltyAccount_orgId_tier_idx" ON "LoyaltyAccount"("orgId", "tier");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyAccount_orgId_recipientKey_key" ON "LoyaltyAccount"("orgId", "recipientKey");

-- CreateIndex
CREATE INDEX "LoyaltyTxn_orgId_at_idx" ON "LoyaltyTxn"("orgId", "at");

-- CreateIndex
CREATE INDEX "DynamicPriceRule_orgId_active_priority_idx" ON "DynamicPriceRule"("orgId", "active", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "DynamicPriceRule_orgId_code_key" ON "DynamicPriceRule"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionRule_orgId_partnerKey_key" ON "CommissionRule"("orgId", "partnerKey");

-- CreateIndex
CREATE INDEX "CommissionEvent_orgId_status_at_idx" ON "CommissionEvent"("orgId", "status", "at");

-- CreateIndex
CREATE INDEX "Settlement_orgId_status_periodEnd_idx" ON "Settlement"("orgId", "status", "periodEnd");

-- CreateIndex
CREATE INDEX "FraudSignal_orgId_kind_at_idx" ON "FraudSignal"("orgId", "kind", "at");

-- CreateIndex
CREATE INDEX "FraudSignal_orgId_subjectKey_idx" ON "FraudSignal"("orgId", "subjectKey");

-- CreateIndex
CREATE INDEX "AttributionTouch_orgId_subjectKey_at_idx" ON "AttributionTouch"("orgId", "subjectKey", "at");

-- CreateIndex
CREATE INDEX "AttributionTouch_orgId_campaignId_kind_at_idx" ON "AttributionTouch"("orgId", "campaignId", "kind", "at");

-- CreateIndex
CREATE INDEX "AttributionResult_orgId_model_computedAt_idx" ON "AttributionResult"("orgId", "model", "computedAt");

-- CreateIndex
CREATE INDEX "FunnelStep_funnelId_position_idx" ON "FunnelStep"("funnelId", "position");

-- CreateIndex
CREATE INDEX "FunnelSnapshot_orgId_date_idx" ON "FunnelSnapshot"("orgId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FunnelSnapshot_funnelId_date_key" ON "FunnelSnapshot"("funnelId", "date");

-- CreateIndex
CREATE INDEX "ConversionPrediction_orgId_campaignId_scoreBps_idx" ON "ConversionPrediction"("orgId", "campaignId", "scoreBps");

-- CreateIndex
CREATE INDEX "ChannelOptimization_orgId_createdAt_idx" ON "ChannelOptimization"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "AutonomousPolicy_orgId_mode_active_idx" ON "AutonomousPolicy"("orgId", "mode", "active");

-- CreateIndex
CREATE INDEX "AutonomousAction_orgId_at_idx" ON "AutonomousAction"("orgId", "at");

-- CreateIndex
CREATE INDEX "KnowledgeItem_orgId_kind_idx" ON "KnowledgeItem"("orgId", "kind");

-- CreateIndex
CREATE INDEX "KnowledgeItem_orgId_tags_idx" ON "KnowledgeItem"("orgId", "tags");

-- CreateIndex
CREATE INDEX "SearchIndexRow_orgId_entityType_idx" ON "SearchIndexRow"("orgId", "entityType");

-- CreateIndex
CREATE INDEX "SearchIndexRow_tokens_idx" ON "SearchIndexRow"("tokens");

-- CreateIndex
CREATE UNIQUE INDEX "SearchIndexRow_orgId_entityType_entityId_key" ON "SearchIndexRow"("orgId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "DigitalTwinModel_orgId_subjectType_subjectId_key" ON "DigitalTwinModel"("orgId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "CompliancePolicy_orgId_framework_active_idx" ON "CompliancePolicy"("orgId", "framework", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CompliancePolicy_orgId_code_key" ON "CompliancePolicy"("orgId", "code");

-- CreateIndex
CREATE INDEX "ComplianceCheck_orgId_subjectType_subjectId_idx" ON "ComplianceCheck"("orgId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "ComplianceCheck_orgId_status_at_idx" ON "ComplianceCheck"("orgId", "status", "at");

-- CreateIndex
CREATE INDEX "PortalMember_orgId_kind_active_idx" ON "PortalMember"("orgId", "kind", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PortalMember_orgId_userId_kind_key" ON "PortalMember"("orgId", "userId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "PortalInvite_token_key" ON "PortalInvite"("token");

-- CreateIndex
CREATE INDEX "PortalInvite_orgId_email_idx" ON "PortalInvite"("orgId", "email");

-- AddForeignKey
ALTER TABLE "CampaignTemplate" ADD CONSTRAINT "CampaignTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignVersion" ADD CONSTRAINT "CampaignVersion_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignVersion" ADD CONSTRAINT "CampaignVersion_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyNode" ADD CONSTRAINT "JourneyNode_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyRun" ADD CONSTRAINT "JourneyRun_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyRun" ADD CONSTRAINT "JourneyRun_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleDefinition" ADD CONSTRAINT "RuleDefinition_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionPolicy" ADD CONSTRAINT "DecisionPolicy_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentAssignment" ADD CONSTRAINT "ExperimentAssignment_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentAssignment" ADD CONSTRAINT "ExperimentAssignment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptimizationRun" ADD CONSTRAINT "OptimizationRun_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptimizationRun" ADD CONSTRAINT "OptimizationRun_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetPlan" ADD CONSTRAINT "BudgetPlan_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetPlan" ADD CONSTRAINT "BudgetPlan_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiDef" ADD CONSTRAINT "KpiDef_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiSnapshot" ADD CONSTRAINT "KpiSnapshot_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "KpiDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiSnapshot" ADD CONSTRAINT "KpiSnapshot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutcomeEvent" ADD CONSTRAINT "OutcomeEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutcomeEvent" ADD CONSTRAINT "OutcomeEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientKyc" ADD CONSTRAINT "ClientKyc_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientKyc" ADD CONSTRAINT "ClientKyc_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgHierarchy" ADD CONSTRAINT "OrgHierarchy_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipientPreference" ADD CONSTRAINT "RecipientPreference_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookalikeJob" ADD CONSTRAINT "LookalikeJob_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LookalikeJob" ADD CONSTRAINT "LookalikeJob_seedAudienceId_fkey" FOREIGN KEY ("seedAudienceId") REFERENCES "Audience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictiveScore" ADD CONSTRAINT "PredictiveScore_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictiveScore" ADD CONSTRAINT "PredictiveScore_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentVersion" ADD CONSTRAINT "ContentVersion_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentVersion" ADD CONSTRAINT "ContentVersion_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ContentPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentTranslation" ADD CONSTRAINT "ContentTranslation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentTranslation" ADD CONSTRAINT "ContentTranslation_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ContentPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentScore" ADD CONSTRAINT "ContentScore_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentScore" ADD CONSTRAINT "ContentScore_postId_fkey" FOREIGN KEY ("postId") REFERENCES "ContentPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTxn" ADD CONSTRAINT "LoyaltyTxn_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LoyaltyAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTxn" ADD CONSTRAINT "LoyaltyTxn_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DynamicPriceRule" ADD CONSTRAINT "DynamicPriceRule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEvent" ADD CONSTRAINT "CommissionEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FraudSignal" ADD CONSTRAINT "FraudSignal_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionTouch" ADD CONSTRAINT "AttributionTouch_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionTouch" ADD CONSTRAINT "AttributionTouch_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionResult" ADD CONSTRAINT "AttributionResult_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionResult" ADD CONSTRAINT "AttributionResult_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Funnel" ADD CONSTRAINT "Funnel_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelStep" ADD CONSTRAINT "FunnelStep_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "Funnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelSnapshot" ADD CONSTRAINT "FunnelSnapshot_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "Funnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelSnapshot" ADD CONSTRAINT "FunnelSnapshot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversionPrediction" ADD CONSTRAINT "ConversionPrediction_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversionPrediction" ADD CONSTRAINT "ConversionPrediction_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelOptimization" ADD CONSTRAINT "ChannelOptimization_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelOptimization" ADD CONSTRAINT "ChannelOptimization_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutonomousPolicy" ADD CONSTRAINT "AutonomousPolicy_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutonomousPolicy" ADD CONSTRAINT "AutonomousPolicy_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutonomousAction" ADD CONSTRAINT "AutonomousAction_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "AutonomousPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutonomousAction" ADD CONSTRAINT "AutonomousAction_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchIndexRow" ADD CONSTRAINT "SearchIndexRow_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalTwinModel" ADD CONSTRAINT "DigitalTwinModel_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompliancePolicy" ADD CONSTRAINT "CompliancePolicy_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceCheck" ADD CONSTRAINT "ComplianceCheck_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalMember" ADD CONSTRAINT "PortalMember_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalInvite" ADD CONSTRAINT "PortalInvite_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
