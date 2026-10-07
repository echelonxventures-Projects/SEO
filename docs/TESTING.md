# Testing Guide

## Unit Tests

Unit tests cover critical business logic that must be deterministic and isolated from the database.

### Running Unit Tests

```bash
# Run all unit tests
npm run test:unit

# Run specific test file
npx jest __tests__/ledger.test.ts

# Get coverage report
npm run test:unit:coverage
```

### Test Structure

Tests are located in `__tests__/` with:
- `ledger.test.ts` - Payment and invoice settlement logic
- `money.test.ts` - Tax and currency calculations
- `webhook.test.ts` - Payment webhook processing

### Running Migration Rollback Tests

```bash
npm run test:migration-rollback
```

This verifies that database migrations can be rolled back and re-applied without data loss.

## Integration Tests (Smoke Tests)

The smoke test suite runs 337 assertions against a live server instance.

### Running Smoke Tests

```bash
# Set up environment
export BASE=http://localhost:3000
export DEMO_EMAIL=founder@aithink.india
export DEMO_PASSWORD=DemoPassword#1

# Run tests
npm run test:smoke
```

### Running Against Docker Stack

```bash
export BASE=http://host.docker.internal:3000
export SMOKE_SINK_HOST=host.docker.internal
npm run test:smoke
```

### Page Rendering Tests

```bash
npx tsx scripts/smoke-pages.ts
```

This verifies all 52+52 pages render without errors.

## CI/CD Integration

### Recommended Pipeline

```yaml
# .github/workflows/ci.yml (example)
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Lint
        run: npm run lint
      
      - name: Type check
        run: npm run typecheck
      
      - name: Build
        run: npm run build
      
      - name: Unit tests
        run: npm run test:unit
      
      - name: Migrations
        run: |
          npm run db:generate
          npm run db:migrate
```

## Test Coverage

| Area | Test Type | File |
|------|-----------|------|
| Billing ledger | Unit | `__tests__/ledger.test.ts` |
| Tax engine | Unit | `__tests__/money.test.ts` |
| Webhooks | Unit | `__tests__/webhook.test.ts` |
| API routes | Integration | `scripts/smoke.ts` |
| Page rendering | Integration | `scripts/smoke-pages.ts` |
| Migrations | Rollback | `scripts/migration-rollback-test.ts` |

## Debugging Tests

```bash
# Run single test with verbose output
npx jest __tests__/ledger.test.ts --verbose

# Run with watch mode (development)
npx jest --watch

# Run specific test case
npx jest __tests__/money.test.ts -t "should calculate tax correctly"
```

## Writing New Tests

### Unit Test Template

```typescript
import { mockDb } from "../setup";
import { yourFunction } from "../../src/server/services/your-service";

describe("YourService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should do something correctly", async () => {
    // Arrange
    mockDb.model.findUnique.mockResolvedValue({ /* mock data */ });

    // Act
    const result = await yourFunction(ctx, input);

    // Assert
    expect(result).toEqual(expected);
  });
});
```

### Mocking Database Operations

Use the `mockDb` object to control Prisma operations:

```typescript
mockDb.invoice.create.mockResolvedValue({
  id: "inv_123",
  status: "DRAFT",
});
```

### Setting Up Environment

Create `__tests__/setup.ts` with mocks for:
- Database client (`db`)
- Cryptography (`crypto`)
- Errors (`errors`)
- Environment variables (`env`)
