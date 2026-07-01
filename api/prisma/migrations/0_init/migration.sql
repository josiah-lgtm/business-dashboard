-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "workspaces" (
    "key" TEXT NOT NULL,
    "business" JSONB,
    "targets" JSONB,
    "fxRates" JSONB,
    "fxRate" DOUBLE PRECISION,
    "invoiceCounter" INTEGER NOT NULL DEFAULT 1,
    "slackWebhookUrl" TEXT NOT NULL DEFAULT '',
    "dataUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "expenses" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT,
    "month" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "typicalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "raw" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "date" TEXT,
    "recipient" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT,
    "raw" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "payType" TEXT NOT NULL DEFAULT 'salary',
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthlySalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commissionAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isFounder" BOOLEAN,
    "email" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT 'GB',
    "bank" JSONB,
    "raw" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'todo',
    "linkedVendorId" TEXT,
    "action" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "client" JSONB NOT NULL,
    "items" JSONB NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "clientUpdatedAt" TEXT,
    "raw" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "team_invoices" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "dueDate" TEXT,
    "period" TEXT,
    "itemCategory" TEXT,
    "services" TEXT,
    "hours" DOUBLE PRECISION,
    "rate" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxPct" DOUBLE PRECISION,
    "currency" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TEXT,
    "clientUpdatedAt" TEXT,
    "acceptedAt" TEXT,
    "declinedAt" TEXT,
    "raw" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "team_invoices_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "revenue_entries" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "legacy" BOOLEAN,
    "raw" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "revenue_entries_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "custom_buckets" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '',
    "icon" TEXT,
    "kind" TEXT,
    "categoryMap" TEXT,
    "fallbackMonthField" TEXT,
    "raw" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "custom_buckets_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "team_payouts" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "type" TEXT NOT NULL DEFAULT '',
    "invoiceId" TEXT,
    "invoiceNumber" TEXT,
    "notes" TEXT,
    "raw" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "team_payouts_pkey" PRIMARY KEY ("workspaceId","id")
);

-- CreateTable
CREATE TABLE "month_figures" (
    "workspaceId" TEXT NOT NULL,
    "monthId" TEXT NOT NULL,
    "revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "merchantFees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "salariesTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commissionsTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "referralPayoutsTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "refundsTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "founderComp" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "newClients" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "activeClients" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "churnedClients" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "raw" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "month_figures_pkey" PRIMARY KEY ("workspaceId","monthId")
);

-- CreateTable
CREATE TABLE "budgets" (
    "workspaceId" TEXT NOT NULL,
    "budgetKey" TEXT NOT NULL,
    "savedAt" TEXT,
    "data" JSONB NOT NULL,
    "raw" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("workspaceId","budgetKey")
);

-- CreateTable
CREATE TABLE "team_invoice_counters" (
    "workspaceId" TEXT NOT NULL,
    "counterKey" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "team_invoice_counters_pkey" PRIMARY KEY ("workspaceId","counterKey")
);

-- CreateTable
CREATE TABLE "team_invoice_months" (
    "workspaceId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "team_invoice_months_pkey" PRIMARY KEY ("workspaceId","monthKey")
);

-- CreateTable
CREATE TABLE "tombstones" (
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "deletedAt" TEXT NOT NULL,

    CONSTRAINT "tombstones_pkey" PRIMARY KEY ("workspaceId","key")
);

-- CreateTable
CREATE TABLE "snapshots" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,
    "reason" TEXT NOT NULL DEFAULT 'post',
    "value" JSONB NOT NULL,

    CONSTRAINT "snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expenses_workspaceId_month_idx" ON "expenses"("workspaceId", "month");

-- CreateIndex
CREATE INDEX "expenses_workspaceId_category_idx" ON "expenses"("workspaceId", "category");

-- CreateIndex
CREATE INDEX "refunds_workspaceId_month_idx" ON "refunds"("workspaceId", "month");

-- CreateIndex
CREATE INDEX "tasks_workspaceId_status_idx" ON "tasks"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "invoices_workspaceId_status_idx" ON "invoices"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "team_invoices_workspaceId_memberId_idx" ON "team_invoices"("workspaceId", "memberId");

-- CreateIndex
CREATE INDEX "team_invoices_workspaceId_status_idx" ON "team_invoices"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "revenue_entries_workspaceId_month_idx" ON "revenue_entries"("workspaceId", "month");

-- CreateIndex
CREATE INDEX "team_payouts_workspaceId_memberId_idx" ON "team_payouts"("workspaceId", "memberId");

-- CreateIndex
CREATE INDEX "team_payouts_workspaceId_month_idx" ON "team_payouts"("workspaceId", "month");

-- CreateIndex
CREATE INDEX "snapshots_workspaceId_takenAt_idx" ON "snapshots"("workspaceId", "takenAt");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_invoices" ADD CONSTRAINT "team_invoices_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_entries" ADD CONSTRAINT "revenue_entries_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_buckets" ADD CONSTRAINT "custom_buckets_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_payouts" ADD CONSTRAINT "team_payouts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "month_figures" ADD CONSTRAINT "month_figures_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_invoice_counters" ADD CONSTRAINT "team_invoice_counters_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_invoice_months" ADD CONSTRAINT "team_invoice_months_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tombstones" ADD CONSTRAINT "tombstones_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("key") ON DELETE CASCADE ON UPDATE CASCADE;

