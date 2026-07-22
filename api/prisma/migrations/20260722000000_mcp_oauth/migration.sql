-- CreateTable
CREATE TABLE "mcp_oauth_clients" (
    "clientId" TEXT NOT NULL,
    "clientSecretHash" TEXT,
    "clientName" TEXT,
    "redirectUris" TEXT[],
    "grantTypes" TEXT[],
    "responseTypes" TEXT[],
    "tokenEndpointAuthMethod" TEXT NOT NULL DEFAULT 'none',
    "scope" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_oauth_clients_pkey" PRIMARY KEY ("clientId")
);

-- CreateTable
CREATE TABLE "mcp_auth_codes" (
    "codeHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "codeChallengeMethod" TEXT NOT NULL DEFAULT 'S256',
    "scope" TEXT,
    "resource" TEXT,
    "subject" TEXT NOT NULL DEFAULT 'owner',
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_auth_codes_pkey" PRIMARY KEY ("codeHash")
);

-- CreateTable
CREATE TABLE "mcp_tokens" (
    "id" TEXT NOT NULL,
    "accessTokenHash" TEXT NOT NULL,
    "refreshTokenHash" TEXT,
    "clientId" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT 'owner',
    "scope" TEXT,
    "resource" TEXT,
    "familyId" TEXT NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_audit_log" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT,
    "clientName" TEXT,
    "tool" TEXT NOT NULL,
    "workspaceId" TEXT,
    "write" BOOLEAN NOT NULL DEFAULT false,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "args" JSONB,
    "error" TEXT,

    CONSTRAINT "mcp_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mcp_auth_codes_expiresAt_idx" ON "mcp_auth_codes"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_tokens_accessTokenHash_key" ON "mcp_tokens"("accessTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_tokens_refreshTokenHash_key" ON "mcp_tokens"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "mcp_tokens_clientId_idx" ON "mcp_tokens"("clientId");

-- CreateIndex
CREATE INDEX "mcp_tokens_familyId_idx" ON "mcp_tokens"("familyId");

-- CreateIndex
CREATE INDEX "mcp_tokens_accessExpiresAt_idx" ON "mcp_tokens"("accessExpiresAt");

-- CreateIndex
CREATE INDEX "mcp_audit_log_at_idx" ON "mcp_audit_log"("at");

-- CreateIndex
CREATE INDEX "mcp_audit_log_tool_idx" ON "mcp_audit_log"("tool");

-- AddForeignKey
ALTER TABLE "mcp_auth_codes" ADD CONSTRAINT "mcp_auth_codes_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "mcp_oauth_clients"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "mcp_oauth_clients"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

