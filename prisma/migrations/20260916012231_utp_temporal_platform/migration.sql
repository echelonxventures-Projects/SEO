-- CreateEnum
CREATE TYPE "TimeSystemKind" AS ENUM ('LINEAR_OFFSET', 'ROTATION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TemporalPatternType" AS ENUM ('TIME', 'DATE', 'DATE_RANGE', 'TIME_RANGE', 'DURATION', 'WINDOW', 'TRIGGER', 'CONSTRAINT', 'DEPENDENCY', 'COMPOSITE');

-- CreateEnum
CREATE TYPE "RecurrenceFreq" AS ENUM ('NONE', 'SECONDLY', 'MINUTELY', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PatternStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DEPRECATED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ExpressionStatus" AS ENUM ('UNVALIDATED', 'VALID', 'INVALID', 'OPTIMIZED');

-- CreateEnum
CREATE TYPE "RangeKind" AS ENUM ('ABSOLUTE', 'RELATIVE', 'ROLLING', 'EVENT_RELATIVE', 'RESOURCE_RELATIVE', 'OPEN_ENDED');

-- CreateEnum
CREATE TYPE "ConstraintType" AS ENUM ('BUSINESS_HOURS', 'WORKING_DAYS', 'HOLIDAY', 'COMPLIANCE', 'RESOURCE', 'CAPACITY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "DependencyType" AS ENUM ('FINISH_TO_START', 'START_TO_START', 'FINISH_TO_FINISH', 'START_TO_FINISH');

-- CreateEnum
CREATE TYPE "DependencyScope" AS ENUM ('EVENT', 'WORKFLOW');

-- CreateEnum
CREATE TYPE "CalendarKind" AS ENUM ('PERSONAL', 'TEAM', 'RESOURCE', 'PROJECT', 'EVENT', 'CAMPAIGN', 'SYSTEM', 'FISCAL', 'MAINTENANCE', 'SHIFT');

-- CreateEnum
CREATE TYPE "CalendarVisibility" AS ENUM ('PRIVATE', 'INTERNAL', 'PUBLIC');

-- CreateEnum
CREATE TYPE "PrincipalType" AS ENUM ('USER', 'TEAM', 'ORGANIZATION', 'PUBLIC');

-- CreateEnum
CREATE TYPE "SharePermission" AS ENUM ('VIEW', 'SUGGEST', 'EDIT', 'MANAGE');

-- CreateEnum
CREATE TYPE "ScheduledEventType" AS ENUM ('SINGLE', 'SERIES_MASTER', 'SERIES_OCCURRENCE');

-- CreateEnum
CREATE TYPE "ScheduledEventStatus" AS ENUM ('TENTATIVE', 'CONFIRMED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "EventAttendeeKind" AS ENUM ('USER', 'CLIENT', 'CONTACT', 'RESOURCE', 'TEAM');

-- CreateEnum
CREATE TYPE "AttendeeResponse" AS ENUM ('NEEDS_ACTION', 'ACCEPTED', 'DECLINED', 'TENTATIVE');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('ROOM', 'EQUIPMENT', 'VEHICLE', 'FACILITY', 'STUDIO', 'MACHINE', 'HUMAN', 'OTHER');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('HELD', 'CONFIRMED', 'RELEASED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AvailabilitySubjectType" AS ENUM ('USER', 'TEAM', 'DEPARTMENT', 'RESOURCE', 'ORGANIZATION', 'CAPACITY');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('WAITLISTED', 'PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('OPEN', 'HELD', 'BOOKED', 'BLOCKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ShiftKind" AS ENUM ('FIXED', 'ROTATING', 'ON_CALL', 'SPLIT', 'FLEXIBLE');

-- CreateEnum
CREATE TYPE "CoverageRole" AS ENUM ('PRIMARY', 'SECONDARY', 'BACKUP', 'FLOAT');

-- CreateEnum
CREATE TYPE "TriggerAnchorType" AS ENUM ('ABSOLUTE', 'RELATIVE', 'EVENT_BEFORE', 'EVENT_AFTER', 'RESOURCE_AVAILABLE', 'CAPACITY_AVAILABLE', 'TEAM_AVAILABLE', 'ASTRONOMICAL', 'PLANETARY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ConsumerType" AS ENUM ('CAMPAIGN', 'WORKFLOW', 'CONTENT', 'CLIENT', 'NOTIFICATION', 'BILLING', 'RESOURCE', 'WORKFORCE', 'MONITORING', 'AI_AGENT', 'AUTOMATION', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "TemporalTriggerStatus" AS ENUM ('ARMED', 'PAUSED', 'EXHAUSTED');

-- CreateEnum
CREATE TYPE "FireOutcome" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'RETRYING', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('PLANNED', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "VersionEntityType" AS ENUM ('CALENDAR', 'PATTERN', 'RULE', 'EVENT', 'RESOURCE', 'APPOINTMENT', 'TRIGGER', 'TIME_SYSTEM', 'LIBRARY_TEMPLATE', 'FISCAL_CALENDAR', 'CONFIGURATION');

-- CreateEnum
CREATE TYPE "HolidayScope" AS ENUM ('GLOBAL', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "FiscalPeriod" AS ENUM ('MONTHLY', 'QUARTERLY', 'WEEKLY_445', 'WEEKLY_13');

-- CreateEnum
CREATE TYPE "LibraryTemplateKind" AS ENUM ('BUSINESS_HOURS', 'TRADING_HOURS', 'OFFICE_HOURS', 'FISCAL_CALENDAR', 'HOLIDAY_CALENDAR', 'MAINTENANCE_WINDOW', 'SHIFT_TEMPLATE', 'INDUSTRY', 'ENTERPRISE');

-- CreateTable
CREATE TABLE "TimeSystem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TimeSystemKind" NOT NULL DEFAULT 'LINEAR_OFFSET',
    "utcOffsetMinutes" INTEGER NOT NULL DEFAULT 0,
    "unitSeconds" INTEGER NOT NULL DEFAULT 86400,
    "epochMicros" BIGINT NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeSystem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemporalPattern" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "TemporalPatternType" NOT NULL DEFAULT 'WINDOW',
    "freq" "RecurrenceFreq" NOT NULL DEFAULT 'NONE',
    "spec" JSONB NOT NULL,
    "dsl" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "timeSystemId" TEXT,
    "status" "PatternStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isLibrary" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemporalPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemporalExpression" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "patternId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ast" JSONB NOT NULL DEFAULT '{}',
    "diagnostics" JSONB NOT NULL DEFAULT '[]',
    "plan" JSONB NOT NULL DEFAULT '{}',
    "status" "ExpressionStatus" NOT NULL DEFAULT 'UNVALIDATED',
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemporalExpression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemporalRange" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "kind" "RangeKind" NOT NULL DEFAULT 'ABSOLUTE',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "startTime" TEXT,
    "endTime" TEXT,
    "relativeDir" TEXT,
    "relativeValue" INTEGER,
    "relativeUnit" TEXT,
    "allDay" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemporalRange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemporalRule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "type" "ConstraintType" NOT NULL,
    "params" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "hard" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isLibrary" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemporalRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemporalDependency" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "scope" "DependencyScope" NOT NULL DEFAULT 'EVENT',
    "fromType" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toType" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "type" "DependencyType" NOT NULL DEFAULT 'FINISH_TO_START',
    "lagValue" INTEGER NOT NULL DEFAULT 0,
    "lagUnit" TEXT NOT NULL DEFAULT 'HOURS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemporalDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Calendar" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "CalendarKind" NOT NULL DEFAULT 'TEAM',
    "visibility" "CalendarVisibility" NOT NULL DEFAULT 'INTERNAL',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "timeSystemId" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "description" TEXT,
    "space" TEXT,
    "patternId" TEXT,
    "ownerUserId" TEXT,
    "retentionDays" INTEGER,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Calendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarShare" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "principalType" "PrincipalType" NOT NULL DEFAULT 'USER',
    "principalId" TEXT NOT NULL,
    "permission" "SharePermission" NOT NULL DEFAULT 'VIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "patternId" TEXT,
    "rootEventId" TEXT,
    "type" "ScheduledEventType" NOT NULL DEFAULT 'SINGLE',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ScheduledEventStatus" NOT NULL DEFAULT 'CONFIRMED',
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "overrides" JSONB NOT NULL DEFAULT '{}',
    "clientRef" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventOccurrence" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "ScheduledEventStatus" NOT NULL DEFAULT 'CONFIRMED',
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "exception" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventAttendee" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" "EventAttendeeKind" NOT NULL DEFAULT 'USER',
    "refId" TEXT,
    "email" TEXT,
    "name" TEXT,
    "response" "AttendeeResponse" NOT NULL DEFAULT 'NEEDS_ACTION',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "calendarId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "ResourceType" NOT NULL DEFAULT 'ROOM',
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "location" TEXT,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "availabilityPatternId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceBooking" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "eventId" TEXT,
    "appointmentId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityProfile" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "calendarId" TEXT,
    "subjectType" "AvailabilitySubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "patternId" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvailabilityProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlackoutWindow" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlackoutWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "eventId" TEXT,
    "occurrenceId" TEXT,
    "resourceId" TEXT,
    "referenceCode" TEXT NOT NULL,
    "attendeeName" TEXT NOT NULL,
    "attendeeEmail" TEXT,
    "attendeePhone" TEXT,
    "attendeeRefId" TEXT,
    "service" TEXT,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'PENDING',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "waitlistPos" INTEGER,
    "checkInAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentSlot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "resourceId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "booked" INTEGER NOT NULL DEFAULT 0,
    "status" "SlotStatus" NOT NULL DEFAULT 'OPEN',
    "holdExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppointmentSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "ShiftKind" NOT NULL DEFAULT 'FIXED',
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "crossDay" BOOLEAN NOT NULL DEFAULT false,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "patternId" TEXT,
    "color" TEXT NOT NULL DEFAULT '#0ea5e9',
    "requiredSkills" TEXT[],
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiftAssignment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "role" "CoverageRole" NOT NULL DEFAULT 'PRIMARY',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiftAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoverageRequirement" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "departmentRef" TEXT,
    "dayOfWeek" INTEGER NOT NULL DEFAULT 0,
    "startTime" TEXT NOT NULL DEFAULT '09:00',
    "endTime" TEXT NOT NULL DEFAULT '17:00',
    "requiredCount" INTEGER NOT NULL DEFAULT 1,
    "skill" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoverageRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemporalTrigger" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "calendarId" TEXT,
    "name" TEXT NOT NULL,
    "anchorType" "TriggerAnchorType" NOT NULL DEFAULT 'ABSOLUTE',
    "anchor" JSONB NOT NULL DEFAULT '{}',
    "consumerType" "ConsumerType" NOT NULL DEFAULT 'WEBHOOK',
    "consumerRef" TEXT,
    "retry" JSONB NOT NULL DEFAULT '{"maxAttempts":3,"backoffSeconds":60}',
    "dsl" TEXT,
    "nextFireAt" TIMESTAMP(3),
    "lastFiredAt" TIMESTAMP(3),
    "maxFires" INTEGER,
    "firedCount" INTEGER NOT NULL DEFAULT 0,
    "status" "TemporalTriggerStatus" NOT NULL DEFAULT 'ARMED',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemporalTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemporalTriggerFire" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "triggerId" TEXT NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "FireOutcome" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "planId" TEXT,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,

    CONSTRAINT "TemporalTriggerFire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionPlan" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "triggerId" TEXT,
    "consumerType" "ConsumerType" NOT NULL DEFAULT 'AUTOMATION',
    "consumerRef" TEXT,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "status" "ExecutionStatus" NOT NULL DEFAULT 'PLANNED',
    "result" JSONB NOT NULL DEFAULT '{}',
    "plannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExecutionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemporalVersion" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entityType" "VersionEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "change" TEXT NOT NULL,
    "summary" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemporalVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemporalEventLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "actorId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "TemporalEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HolidayCalendar" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "scope" "HolidayScope" NOT NULL DEFAULT 'ORGANIZATION',
    "country" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HolidayCalendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "recurringAnnual" BOOLEAN NOT NULL DEFAULT false,
    "workingDayOff" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalCalendar" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "anchorMonth" INTEGER NOT NULL DEFAULT 4,
    "startDay" INTEGER NOT NULL DEFAULT 1,
    "period" "FiscalPeriod" NOT NULL DEFAULT 'MONTHLY',
    "weeksPerQtr" INTEGER NOT NULL DEFAULT 13,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalCalendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "kind" "LibraryTemplateKind" NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "industry" TEXT,
    "template" JSONB NOT NULL,
    "isGlobal" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemporalConfiguration" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "timeSystemCode" TEXT NOT NULL DEFAULT 'UTC',
    "weekStartsOn" INTEGER NOT NULL DEFAULT 1,
    "businessRuleId" TEXT,
    "holidayCalendarId" TEXT,
    "fiscalCalendarId" TEXT,
    "workingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "defaultCapacity" INTEGER NOT NULL DEFAULT 1,
    "retentionDays" INTEGER NOT NULL DEFAULT 0,
    "materializeHorizonDays" INTEGER NOT NULL DEFAULT 90,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemporalConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeSystem_active_idx" ON "TimeSystem"("active");

-- CreateIndex
CREATE UNIQUE INDEX "TimeSystem_orgId_code_key" ON "TimeSystem"("orgId", "code");

-- CreateIndex
CREATE INDEX "TemporalPattern_orgId_status_idx" ON "TemporalPattern"("orgId", "status");

-- CreateIndex
CREATE INDEX "TemporalPattern_isLibrary_idx" ON "TemporalPattern"("isLibrary");

-- CreateIndex
CREATE INDEX "TemporalExpression_orgId_idx" ON "TemporalExpression"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "TemporalExpression_patternId_checksum_key" ON "TemporalExpression"("patternId", "checksum");

-- CreateIndex
CREATE INDEX "TemporalRange_orgId_kind_idx" ON "TemporalRange"("orgId", "kind");

-- CreateIndex
CREATE INDEX "TemporalRule_orgId_type_active_idx" ON "TemporalRule"("orgId", "type", "active");

-- CreateIndex
CREATE INDEX "TemporalDependency_orgId_toType_toId_idx" ON "TemporalDependency"("orgId", "toType", "toId");

-- CreateIndex
CREATE UNIQUE INDEX "TemporalDependency_orgId_fromType_fromId_toType_toId_key" ON "TemporalDependency"("orgId", "fromType", "fromId", "toType", "toId");

-- CreateIndex
CREATE INDEX "Calendar_orgId_kind_archivedAt_idx" ON "Calendar"("orgId", "kind", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Calendar_orgId_code_key" ON "Calendar"("orgId", "code");

-- CreateIndex
CREATE INDEX "CalendarShare_orgId_principalId_idx" ON "CalendarShare"("orgId", "principalId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarShare_calendarId_principalType_principalId_key" ON "CalendarShare"("calendarId", "principalType", "principalId");

-- CreateIndex
CREATE INDEX "ScheduledEvent_orgId_calendarId_startsAt_idx" ON "ScheduledEvent"("orgId", "calendarId", "startsAt");

-- CreateIndex
CREATE INDEX "ScheduledEvent_orgId_status_type_idx" ON "ScheduledEvent"("orgId", "status", "type");

-- CreateIndex
CREATE INDEX "ScheduledEvent_patternId_idx" ON "ScheduledEvent"("patternId");

-- CreateIndex
CREATE INDEX "EventOccurrence_orgId_startsAt_idx" ON "EventOccurrence"("orgId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventOccurrence_eventId_startsAt_key" ON "EventOccurrence"("eventId", "startsAt");

-- CreateIndex
CREATE INDEX "EventAttendee_orgId_eventId_idx" ON "EventAttendee"("orgId", "eventId");

-- CreateIndex
CREATE INDEX "Resource_orgId_type_active_idx" ON "Resource"("orgId", "type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Resource_orgId_code_key" ON "Resource"("orgId", "code");

-- CreateIndex
CREATE INDEX "ResourceBooking_resourceId_status_startsAt_endsAt_idx" ON "ResourceBooking"("resourceId", "status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "ResourceBooking_orgId_idx" ON "ResourceBooking"("orgId");

-- CreateIndex
CREATE INDEX "AvailabilityProfile_orgId_subjectType_subjectId_active_idx" ON "AvailabilityProfile"("orgId", "subjectType", "subjectId", "active");

-- CreateIndex
CREATE INDEX "BlackoutWindow_orgId_startsAt_endsAt_idx" ON "BlackoutWindow"("orgId", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_referenceCode_key" ON "Appointment"("referenceCode");

-- CreateIndex
CREATE INDEX "Appointment_orgId_calendarId_startsAt_idx" ON "Appointment"("orgId", "calendarId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_orgId_status_idx" ON "Appointment"("orgId", "status");

-- CreateIndex
CREATE INDEX "AppointmentSlot_orgId_calendarId_status_startsAt_idx" ON "AppointmentSlot"("orgId", "calendarId", "status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_orgId_code_key" ON "Shift"("orgId", "code");

-- CreateIndex
CREATE INDEX "ShiftAssignment_orgId_userId_startsAt_idx" ON "ShiftAssignment"("orgId", "userId", "startsAt");

-- CreateIndex
CREATE INDEX "ShiftAssignment_shiftId_idx" ON "ShiftAssignment"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "CoverageRequirement_orgId_departmentRef_dayOfWeek_startTime_key" ON "CoverageRequirement"("orgId", "departmentRef", "dayOfWeek", "startTime", "skill");

-- CreateIndex
CREATE INDEX "TemporalTrigger_orgId_status_nextFireAt_idx" ON "TemporalTrigger"("orgId", "status", "nextFireAt");

-- CreateIndex
CREATE INDEX "TemporalTriggerFire_triggerId_firedAt_idx" ON "TemporalTriggerFire"("triggerId", "firedAt");

-- CreateIndex
CREATE INDEX "TemporalTriggerFire_orgId_outcome_idx" ON "TemporalTriggerFire"("orgId", "outcome");

-- CreateIndex
CREATE INDEX "ExecutionPlan_orgId_status_idx" ON "ExecutionPlan"("orgId", "status");

-- CreateIndex
CREATE INDEX "ExecutionPlan_subjectType_subjectId_idx" ON "ExecutionPlan"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "TemporalVersion_orgId_entityType_entityId_version_idx" ON "TemporalVersion"("orgId", "entityType", "entityId", "version");

-- CreateIndex
CREATE INDEX "TemporalEventLog_orgId_at_idx" ON "TemporalEventLog"("orgId", "at");

-- CreateIndex
CREATE INDEX "TemporalEventLog_orgId_type_idx" ON "TemporalEventLog"("orgId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "TemporalEventLog_aggregateType_aggregateId_seq_key" ON "TemporalEventLog"("aggregateType", "aggregateId", "seq");

-- CreateIndex
CREATE INDEX "HolidayCalendar_scope_idx" ON "HolidayCalendar"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "HolidayCalendar_orgId_code_key" ON "HolidayCalendar"("orgId", "code");

-- CreateIndex
CREATE INDEX "Holiday_calendarId_date_idx" ON "Holiday"("calendarId", "date");

-- CreateIndex
CREATE INDEX "Holiday_orgId_date_idx" ON "Holiday"("orgId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalCalendar_orgId_code_key" ON "FiscalCalendar"("orgId", "code");

-- CreateIndex
CREATE INDEX "LibraryTemplate_kind_isGlobal_idx" ON "LibraryTemplate"("kind", "isGlobal");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryTemplate_orgId_code_key" ON "LibraryTemplate"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "TemporalConfiguration_orgId_key" ON "TemporalConfiguration"("orgId");

-- AddForeignKey
ALTER TABLE "TimeSystem" ADD CONSTRAINT "TimeSystem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporalPattern" ADD CONSTRAINT "TemporalPattern_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporalPattern" ADD CONSTRAINT "TemporalPattern_timeSystemId_fkey" FOREIGN KEY ("timeSystemId") REFERENCES "TimeSystem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporalExpression" ADD CONSTRAINT "TemporalExpression_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporalExpression" ADD CONSTRAINT "TemporalExpression_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "TemporalPattern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporalRange" ADD CONSTRAINT "TemporalRange_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporalRule" ADD CONSTRAINT "TemporalRule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporalDependency" ADD CONSTRAINT "TemporalDependency_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calendar" ADD CONSTRAINT "Calendar_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calendar" ADD CONSTRAINT "Calendar_timeSystemId_fkey" FOREIGN KEY ("timeSystemId") REFERENCES "TimeSystem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calendar" ADD CONSTRAINT "Calendar_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "TemporalPattern"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarShare" ADD CONSTRAINT "CalendarShare_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarShare" ADD CONSTRAINT "CalendarShare_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledEvent" ADD CONSTRAINT "ScheduledEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledEvent" ADD CONSTRAINT "ScheduledEvent_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledEvent" ADD CONSTRAINT "ScheduledEvent_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "TemporalPattern"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventOccurrence" ADD CONSTRAINT "EventOccurrence_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ScheduledEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ScheduledEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceBooking" ADD CONSTRAINT "ResourceBooking_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceBooking" ADD CONSTRAINT "ResourceBooking_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityProfile" ADD CONSTRAINT "AvailabilityProfile_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityProfile" ADD CONSTRAINT "AvailabilityProfile_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlackoutWindow" ADD CONSTRAINT "BlackoutWindow_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "AvailabilityProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ScheduledEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentSlot" ADD CONSTRAINT "AppointmentSlot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentSlot" ADD CONSTRAINT "AppointmentSlot_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentSlot" ADD CONSTRAINT "AppointmentSlot_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftAssignment" ADD CONSTRAINT "ShiftAssignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoverageRequirement" ADD CONSTRAINT "CoverageRequirement_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporalTrigger" ADD CONSTRAINT "TemporalTrigger_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporalTrigger" ADD CONSTRAINT "TemporalTrigger_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporalTriggerFire" ADD CONSTRAINT "TemporalTriggerFire_triggerId_fkey" FOREIGN KEY ("triggerId") REFERENCES "TemporalTrigger"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionPlan" ADD CONSTRAINT "ExecutionPlan_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporalVersion" ADD CONSTRAINT "TemporalVersion_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporalEventLog" ADD CONSTRAINT "TemporalEventLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HolidayCalendar" ADD CONSTRAINT "HolidayCalendar_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "HolidayCalendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalCalendar" ADD CONSTRAINT "FiscalCalendar_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryTemplate" ADD CONSTRAINT "LibraryTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemporalConfiguration" ADD CONSTRAINT "TemporalConfiguration_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
