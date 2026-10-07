# Dev Onboarding Guide

## Prerequisites

- Node.js 20+ (use [nvm](https://github.com/nvm-sh/nvm))
- PostgreSQL 16+ (use Docker or Homebrew)
- Git

## Quick Start

```bash
# Clone the repo
git clone https://github.com/echelonxventures-Projects/SEO.git
cd SEO/omnimark

# Install dependencies
npm install

# Set up database
createdb omnimark
# or: docker run -d --name pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16

# Copy environment file
cp .env.example .env

# Generate secrets
OMNI_ENCRYPTION_KEYS=$(openssl rand -base64 32)
OMNI_TOKEN_SECRET=$(openssl rand -base64 32)
CRON_SECRET=$(openssl rand -hex 24)

# Add to .env file
# OMNI_ENCRYPTION_KEYS={"v1":"YOUR_KEY"}
# OMNI_TOKEN_SECRET=YOUR_TOKEN
# CRON_SECRET=YOUR_CRON_SECRET

# Run migrations and seed
npm run db:generate
npm run db:migrate
npm run db:seed

# Start development server
npm run dev
```

Access: http://localhost:3000  
Demo: `founder@aithink.india` / `DemoPassword#1`

## Project Structure

```
omnimark/
├── src/
│   ├── app/              # Next.js pages
│   ├── components/       # UI components
│   └── server/           # Backend services
│       ├── services/     # Domain services
│       └── monitoring/   # Health checks
├── prisma/               # Database schema
├── docs/                 # Documentation
└── scripts/              # Utility scripts
```

## Running Tests

```bash
# Unit tests (ledger, tax engine)
npm run test:unit

# Integration tests (API smoke tests)
npm run test:smoke

# Migration rollback test
npm run test:migration-rollback
```

## Architecture Overview

**Services Layer** (`src/server/services/`)
- All business logic lives here
- Services are transactional and audited
- See `docs/services/CONTRACTS.md` for API contracts

**Money & Tax** (`src/server/money.ts`)
- Integer-only arithmetic (BigInt minor units)
- GST calculations with exact splitting
- See `docs/TESTING.md` for unit tests

**Temporal Platform** (`src/server/temporal/`)
- Calendar as reusable assets
- Feature-flagged for smaller agencies

## Common Tasks

### Add a New Service

1. Create `src/server/services/your-service.ts`
2. Define Zod schemas at the top
3. Export typed functions with `Ctx` parameter
4. Add to `src/server/api.ts` routes
5. Write tests in `__tests__/your-service.test.ts`

### Add a New Model

1. Edit `prisma/schema.prisma`
2. Run `npm run db:generate`
3. Run `npm run db:migrate`
4. Update seed file if needed

### Monitor Health

```bash
# Setup alerting
npm run monitoring:setup

# Check health
npm run monitoring:check
```

## Development Notes

- **Feature flags**: UTP and advanced features are feature-flagged (`docs/FEATURE_FLAGS.md`)
- **Database migrations**: Always create migration after schema changes
- **Testing**: Run `npm run lint` and `npm run typecheck` before committing
- **Audit logs**: All mutations append to `ActivityLog` automatically

## Environment Variables

See `.env.example` for all required variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `OMNI_ENCRYPTION_KEYS` | AES encryption keyring (JSON) |
| `OMNI_TOKEN_SECRET` | JWT/signing secret |
| `CRON_SECRET` | Cron endpoint authentication |
| `APP_URL` | Public application URL |

## Support

- See `docs/TESTING.md` for testing guide
- See `docs/FEATURE_FLAGS.md` for feature toggles
- See `docs/ARCHITECTURE.md` for system architecture
