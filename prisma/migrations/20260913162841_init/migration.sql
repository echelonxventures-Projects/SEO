-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('PASSWORD_RESET', 'EMAIL_VERIFICATION');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'TRIALING', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TaxRateKind" AS ENUM ('GST_INTRA', 'GST_INTER', 'FLAT', 'TDS', 'NONE');

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('SERVICE', 'INDUSTRY', 'LEAD_SOURCE', 'EXPENSE_TYPE', 'CAMPAIGN_CHANNEL', 'PROJECT_TYPE');

-- CreateEnum
CREATE TYPE "DocKind" AS ENUM ('QUOTE', 'INVOICE', 'PAYMENT');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "NoteEntityType" AS ENUM ('CLIENT', 'LEAD', 'PROJECT', 'TASK', 'INVOICE', 'QUOTE', 'CAMPAIGN', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('HOUR', 'PIECE', 'MONTH', 'PROJECT', 'RETAINER');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "InvoicePartyKind" AS ENUM ('CLIENT', 'TENANT');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID');

-- CreateEnum
CREATE TYPE "InvoiceLineSourceType" AS ENUM ('MANUAL', 'QUOTE', 'TIME', 'EXPENSE', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'UPI', 'CARD', 'NETBANKING', 'WALLET', 'CASH', 'CHEQUE', 'GATEWAY', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PlanInterval" AS ENUM ('MONTH', 'QUARTER', 'YEAR');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "FeatureCode" AS ENUM ('RANK_TRACKING', 'SITE_AUDIT', 'BACKLINK_INDEX', 'CAMPAIGN_METRICS', 'TIME_TRACKING', 'EXPENSE_TRACKING', 'QUOTES', 'INVOICING', 'ONLINE_COLLECT', 'REPORT_BUILDER', 'API_ACCESS', 'WHITE_LABEL');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BillingCycleStatus" AS ENUM ('PENDING', 'INVOICED', 'PAID', 'FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "GatewayMode" AS ENUM ('SANDBOX', 'LIVE');

-- CreateEnum
CREATE TYPE "GatewayScope" AS ENUM ('PLATFORM', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED_DUPLICATE', 'IGNORED_UNKNOWN');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('DESKTOP', 'MOBILE');

-- CreateEnum
CREATE TYPE "SnapshotSource" AS ENUM ('MANUAL', 'CSV_IMPORT', 'PROVIDER', 'DEMO');

-- CreateEnum
CREATE TYPE "BacklinkStatus" AS ENUM ('LIVE', 'LOST', 'BROKEN', 'REMOVED');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'ERROR', 'WARNING', 'NOTICE', 'PASS');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'LIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReportModule" AS ENUM ('REVENUE', 'CLIENTS', 'SEO_RANKINGS', 'CAMPAIGNS', 'TIMESHEETS', 'TEAM');

-- CreateEnum
CREATE TYPE "ReportSchedule" AS ENUM ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "emailVerifiedAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfSecret" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpToken" (
    "id" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "subject" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "roleCode" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "acceptedById" TEXT,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "OrgStatus" NOT NULL DEFAULT 'TRIALING',
    "defaultCurrencyCode" TEXT NOT NULL DEFAULT 'INR',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "gstin" TEXT,
    "taxIdType" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "logoUrl" TEXT,
    "billingEmail" TEXT,
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rank" INTEGER NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Currency" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "minorUnits" INTEGER NOT NULL DEFAULT 2,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TaxRateKind" NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "gstCategory" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "parentGroupTaxRateId" TEXT,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "kind" "CategoryKind" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "meta" JSONB,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineStage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "winProbabilityBps" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL,
    "isTerminalWon" BOOLEAN NOT NULL DEFAULT false,
    "isTerminalLost" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" "DocKind" NOT NULL,
    "pattern" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "padding" INTEGER NOT NULL DEFAULT 4,
    "nextValue" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoLocation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "googleId" TEXT,
    "countryCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "GeoLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "industryId" TEXT,
    "website" TEXT,
    "gstin" TEXT,
    "taxExempt" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "billingEmail" TEXT,
    "currencyCode" TEXT NOT NULL,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 15,
    "addressLine1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "designation" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entityType" "NoteEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "sourceId" TEXT,
    "stageId" TEXT NOT NULL,
    "budgetMinor" BIGINT,
    "currencyCode" TEXT NOT NULL,
    "message" TEXT,
    "assignedToId" TEXT,
    "convertedClientId" TEXT,
    "lostReason" TEXT,
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNING',
    "typeId" TEXT,
    "ownerId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "budgetMinor" BIGINT,
    "currencyCode" TEXT NOT NULL,
    "hourlyRateMinor" BIGINT,
    "retainerMonthlyMinor" BIGINT,
    "domainUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleRefId" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "assigneeId" TEXT,
    "dueDate" TIMESTAMP(3),
    "estimatedMinutes" INTEGER,
    "completedAt" TIMESTAMP(3),
    "serviceItemId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "rateMinor" BIGINT,
    "invoiceLineId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clientId" TEXT,
    "categoryId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "invoiceLineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "categoryId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" "UnitType" NOT NULL DEFAULT 'PIECE',
    "priceMinor" BIGINT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "taxRateId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "currencyCode" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "discountMinor" BIGINT NOT NULL DEFAULT 0,
    "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
    "taxMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "terms" TEXT,
    "notes" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "convertedInvoiceId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLineItem" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "serviceItemId" TEXT,
    "description" TEXT NOT NULL,
    "qtyHundredths" INTEGER NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,
    "discountBps" INTEGER NOT NULL DEFAULT 0,
    "taxRateId" TEXT,
    "taxBps" INTEGER NOT NULL DEFAULT 0,
    "lineTotalMinor" BIGINT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuoteLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "partyKind" "InvoicePartyKind" NOT NULL DEFAULT 'CLIENT',
    "clientId" TEXT,
    "tenantId" TEXT,
    "subscriptionId" TEXT,
    "number" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "currencyCode" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "discountMinor" BIGINT NOT NULL DEFAULT 0,
    "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
    "taxMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "paidMinor" BIGINT NOT NULL DEFAULT 0,
    "taxBreakdown" JSONB,
    "notes" TEXT,
    "terms" TEXT,
    "quoteId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "checkoutToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLineItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "serviceItemId" TEXT,
    "sourceType" "InvoiceLineSourceType" NOT NULL DEFAULT 'MANUAL',
    "sourceQuoteLineId" TEXT,
    "description" TEXT NOT NULL,
    "qtyHundredths" INTEGER NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,
    "discountBps" INTEGER NOT NULL DEFAULT 0,
    "taxRateId" TEXT,
    "taxBps" INTEGER NOT NULL DEFAULT 0,
    "lineTotalMinor" BIGINT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "clientId" TEXT,
    "number" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'COMPLETED',
    "amountMinor" BIGINT NOT NULL,
    "refundedMinor" BIGINT NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "gatewayConfigId" TEXT,
    "gatewayPaymentRef" TEXT,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "gatewayRefundRef" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceMinor" BIGINT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "interval" "PlanInterval" NOT NULL,
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "maxSeats" INTEGER NOT NULL,
    "maxClients" INTEGER NOT NULL,
    "maxProjects" INTEGER NOT NULL,
    "maxKeywords" INTEGER NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanFeature" (
    "planId" TEXT NOT NULL,
    "featureCode" "FeatureCode" NOT NULL,
    "limitValue" BIGINT,

    CONSTRAINT "PlanFeature_pkey" PRIMARY KEY ("planId","featureCode")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "seats" INTEGER NOT NULL DEFAULT 1,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "trialEndsAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingCycle" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "BillingCycleStatus" NOT NULL DEFAULT 'PENDING',
    "invoiceId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatewayConfig" (
    "id" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "scope" "GatewayScope" NOT NULL,
    "orgId" TEXT,
    "mode" "GatewayMode" NOT NULL DEFAULT 'SANDBOX',
    "label" TEXT NOT NULL,
    "credentialEnc" JSONB NOT NULL,
    "webhookSecretEnc" JSONB,
    "publicMeta" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GatewayConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "gatewayConfigId" TEXT,
    "providerCode" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signature" TEXT,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Keyword" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "locationId" TEXT,
    "device" "DeviceType" NOT NULL DEFAULT 'DESKTOP',
    "targetUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Keyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectKeyword" (
    "projectId" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectKeyword_pkey" PRIMARY KEY ("projectId","keywordId")
);

-- CreateTable
CREATE TABLE "RankSnapshot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "projectId" TEXT,
    "capturedOn" TIMESTAMP(3) NOT NULL,
    "position" INTEGER NOT NULL,
    "trackedUrl" TEXT,
    "source" "SnapshotSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Backlink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "anchorText" TEXT,
    "dofollow" BOOLEAN NOT NULL DEFAULT true,
    "domainAuthority" INTEGER,
    "status" "BacklinkStatus" NOT NULL DEFAULT 'LIVE',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMP(3),
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Backlink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteAudit" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "url" TEXT NOT NULL,
    "status" "AuditStatus" NOT NULL DEFAULT 'QUEUED',
    "score" INTEGER,
    "passedCount" INTEGER NOT NULL DEFAULT 0,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "summary" JSONB,
    "requestedById" TEXT NOT NULL,

    CONSTRAINT "SiteAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteAuditIssue" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "checkCode" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "message" TEXT NOT NULL,
    "detail" JSONB,

    CONSTRAINT "SiteAuditIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "clientId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "budgetMinor" BIGINT,
    "currencyCode" TEXT NOT NULL,
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignMetric" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "costMinor" BIGINT NOT NULL DEFAULT 0,
    "conversions" BIGINT NOT NULL DEFAULT 0,
    "revenueMinor" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "module" "ReportModule" NOT NULL,
    "definition" JSONB NOT NULL,
    "schedule" "ReportSchedule" NOT NULL DEFAULT 'NONE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportRun" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triggeredByUserId" TEXT NOT NULL,
    "resultSummary" JSONB NOT NULL,

    CONSTRAINT "ReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" "NoteEntityType",
    "entityId" TEXT,
    "meta" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "id" TEXT NOT NULL,
    "bucketKey" TEXT NOT NULL,
    "tokens" DOUBLE PRECISION NOT NULL,
    "maxTokens" DOUBLE PRECISION NOT NULL,
    "refillPerSec" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "valueType" TEXT NOT NULL DEFAULT 'json',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_emailNormalized_key" ON "User"("emailNormalized");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OtpToken_codeHash_key" ON "OtpToken"("codeHash");

-- CreateIndex
CREATE INDEX "OtpToken_purpose_subject_idx" ON "OtpToken"("purpose", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_status_idx" ON "Invitation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_orgId_emailNormalized_roleCode_key" ON "Invitation"("orgId", "emailNormalized", "roleCode");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_orgId_idx" ON "ApiKey"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_status_idx" ON "Organization"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE INDEX "Role_rank_idx" ON "Role"("rank");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE INDEX "Permission_module_idx" ON "Permission"("module");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_orgId_userId_key" ON "Membership"("orgId", "userId");

-- CreateIndex
CREATE INDEX "Currency_active_idx" ON "Currency"("active");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRate_orgId_code_key" ON "TaxRate"("orgId", "code");

-- CreateIndex
CREATE INDEX "Category_kind_active_idx" ON "Category"("kind", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Category_orgId_kind_code_key" ON "Category"("orgId", "kind", "code");

-- CreateIndex
CREATE INDEX "PipelineStage_orgId_sortOrder_idx" ON "PipelineStage"("orgId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_orgId_code_key" ON "PipelineStage"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSequence_orgId_kind_key" ON "DocumentSequence"("orgId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "GeoLocation_orgId_name_key" ON "GeoLocation"("orgId", "name");

-- CreateIndex
CREATE INDEX "Client_orgId_status_idx" ON "Client"("orgId", "status");

-- CreateIndex
CREATE INDEX "Client_orgId_ownerId_idx" ON "Client"("orgId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_orgId_name_key" ON "Client"("orgId", "name");

-- CreateIndex
CREATE INDEX "Contact_clientId_idx" ON "Contact"("clientId");

-- CreateIndex
CREATE INDEX "Note_orgId_entityType_entityId_idx" ON "Note"("orgId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "Lead_orgId_stageId_idx" ON "Lead"("orgId", "stageId");

-- CreateIndex
CREATE INDEX "Lead_orgId_createdAt_idx" ON "Lead"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "Project_orgId_status_idx" ON "Project"("orgId", "status");

-- CreateIndex
CREATE INDEX "Project_clientId_idx" ON "Project"("clientId");

-- CreateIndex
CREATE INDEX "Task_projectId_status_idx" ON "Task"("projectId", "status");

-- CreateIndex
CREATE INDEX "Task_orgId_assigneeId_status_idx" ON "Task"("orgId", "assigneeId", "status");

-- CreateIndex
CREATE INDEX "TimeEntry_orgId_projectId_idx" ON "TimeEntry"("orgId", "projectId");

-- CreateIndex
CREATE INDEX "TimeEntry_orgId_userId_date_idx" ON "TimeEntry"("orgId", "userId", "date");

-- CreateIndex
CREATE INDEX "TimeEntry_invoiceLineId_idx" ON "TimeEntry"("invoiceLineId");

-- CreateIndex
CREATE INDEX "Expense_orgId_projectId_idx" ON "Expense"("orgId", "projectId");

-- CreateIndex
CREATE INDEX "Expense_invoiceLineId_idx" ON "Expense"("invoiceLineId");

-- CreateIndex
CREATE INDEX "ServiceItem_orgId_active_idx" ON "ServiceItem"("orgId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceItem_orgId_code_key" ON "ServiceItem"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_convertedInvoiceId_key" ON "Quote"("convertedInvoiceId");

-- CreateIndex
CREATE INDEX "Quote_orgId_status_idx" ON "Quote"("orgId", "status");

-- CreateIndex
CREATE INDEX "Quote_clientId_idx" ON "Quote"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_orgId_number_key" ON "Quote"("orgId", "number");

-- CreateIndex
CREATE INDEX "QuoteLineItem_quoteId_idx" ON "QuoteLineItem"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_checkoutToken_key" ON "Invoice"("checkoutToken");

-- CreateIndex
CREATE INDEX "Invoice_orgId_status_dueDate_idx" ON "Invoice"("orgId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "Invoice_clientId_idx" ON "Invoice"("clientId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_status_idx" ON "Invoice"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Invoice_partyKind_status_idx" ON "Invoice"("partyKind", "status");

-- CreateIndex
CREATE INDEX "Invoice_subscriptionId_idx" ON "Invoice"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_orgId_number_key" ON "Invoice"("orgId", "number");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_invoiceId_idx" ON "InvoiceLineItem"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_orgId_paidAt_idx" ON "Payment"("orgId", "paidAt");

-- CreateIndex
CREATE INDEX "Payment_gatewayPaymentRef_idx" ON "Payment"("gatewayPaymentRef");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_orgId_number_key" ON "Payment"("orgId", "number");

-- CreateIndex
CREATE INDEX "Refund_paymentId_idx" ON "Refund"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE INDEX "Plan_status_sortOrder_idx" ON "Plan"("status", "sortOrder");

-- CreateIndex
CREATE INDEX "Subscription_orgId_status_idx" ON "Subscription"("orgId", "status");

-- CreateIndex
CREATE INDEX "Subscription_status_currentPeriodEnd_idx" ON "Subscription"("status", "currentPeriodEnd");

-- CreateIndex
CREATE INDEX "BillingCycle_status_idx" ON "BillingCycle"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCycle_subscriptionId_periodStart_key" ON "BillingCycle"("subscriptionId", "periodStart");

-- CreateIndex
CREATE INDEX "GatewayConfig_scope_active_idx" ON "GatewayConfig"("scope", "active");

-- CreateIndex
CREATE INDEX "GatewayConfig_orgId_idx" ON "GatewayConfig"("orgId");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_providerCode_externalId_key" ON "WebhookEvent"("providerCode", "externalId");

-- CreateIndex
CREATE INDEX "Keyword_orgId_term_idx" ON "Keyword"("orgId", "term");

-- CreateIndex
CREATE INDEX "RankSnapshot_orgId_capturedOn_idx" ON "RankSnapshot"("orgId", "capturedOn");

-- CreateIndex
CREATE UNIQUE INDEX "RankSnapshot_keywordId_capturedOn_key" ON "RankSnapshot"("keywordId", "capturedOn");

-- CreateIndex
CREATE INDEX "Backlink_orgId_status_idx" ON "Backlink"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Backlink_orgId_sourceUrl_targetUrl_key" ON "Backlink"("orgId", "sourceUrl", "targetUrl");

-- CreateIndex
CREATE INDEX "SiteAudit_orgId_startedAt_idx" ON "SiteAudit"("orgId", "startedAt");

-- CreateIndex
CREATE INDEX "SiteAuditIssue_auditId_severity_idx" ON "SiteAuditIssue"("auditId", "severity");

-- CreateIndex
CREATE INDEX "Campaign_orgId_status_idx" ON "Campaign"("orgId", "status");

-- CreateIndex
CREATE INDEX "Campaign_clientId_idx" ON "Campaign"("clientId");

-- CreateIndex
CREATE INDEX "CampaignMetric_orgId_date_idx" ON "CampaignMetric"("orgId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMetric_campaignId_date_key" ON "CampaignMetric"("campaignId", "date");

-- CreateIndex
CREATE INDEX "Report_orgId_module_idx" ON "Report"("orgId", "module");

-- CreateIndex
CREATE INDEX "ReportRun_reportId_ranAt_idx" ON "ReportRun"("reportId", "ranAt");

-- CreateIndex
CREATE INDEX "ActivityLog_orgId_createdAt_idx" ON "ActivityLog"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_orgId_entityType_entityId_idx" ON "ActivityLog"("orgId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "ActivityLog_action_idx" ON "ActivityLog"("action");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitBucket_bucketKey_key" ON "RateLimitBucket"("bucketKey");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_defaultCurrencyCode_fkey" FOREIGN KEY ("defaultCurrencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_parentGroupTaxRateId_fkey" FOREIGN KEY ("parentGroupTaxRateId") REFERENCES "TaxRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSequence" ADD CONSTRAINT "DocumentSequence_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeoLocation" ADD CONSTRAINT "GeoLocation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PipelineStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_convertedClientId_fkey" FOREIGN KEY ("convertedClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_roleRefId_fkey" FOREIGN KEY ("roleRefId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "ServiceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "InvoiceLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "InvoiceLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceItem" ADD CONSTRAINT "ServiceItem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceItem" ADD CONSTRAINT "ServiceItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceItem" ADD CONSTRAINT "ServiceItem_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceItem" ADD CONSTRAINT "ServiceItem_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "TaxRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_convertedInvoiceId_fkey" FOREIGN KEY ("convertedInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "ServiceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLineItem" ADD CONSTRAINT "QuoteLineItem_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "TaxRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "ServiceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_sourceQuoteLineId_fkey" FOREIGN KEY ("sourceQuoteLineId") REFERENCES "QuoteLineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "TaxRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_gatewayConfigId_fkey" FOREIGN KEY ("gatewayConfigId") REFERENCES "GatewayConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanFeature" ADD CONSTRAINT "PlanFeature_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingCycle" ADD CONSTRAINT "BillingCycle_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayConfig" ADD CONSTRAINT "GatewayConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Keyword" ADD CONSTRAINT "Keyword_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Keyword" ADD CONSTRAINT "Keyword_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "GeoLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectKeyword" ADD CONSTRAINT "ProjectKeyword_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectKeyword" ADD CONSTRAINT "ProjectKeyword_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankSnapshot" ADD CONSTRAINT "RankSnapshot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankSnapshot" ADD CONSTRAINT "RankSnapshot_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankSnapshot" ADD CONSTRAINT "RankSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backlink" ADD CONSTRAINT "Backlink_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteAudit" ADD CONSTRAINT "SiteAudit_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteAudit" ADD CONSTRAINT "SiteAudit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteAudit" ADD CONSTRAINT "SiteAudit_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteAuditIssue" ADD CONSTRAINT "SiteAuditIssue_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "SiteAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMetric" ADD CONSTRAINT "CampaignMetric_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMetric" ADD CONSTRAINT "CampaignMetric_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRun" ADD CONSTRAINT "ReportRun_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportRun" ADD CONSTRAINT "ReportRun_triggeredByUserId_fkey" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
