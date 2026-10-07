# Feature Flags

OmniMark supports workspace-level feature flags to enable/disable modules without code changes.

## Available Flags

| Flag | Default | Description |
|------|---------|-------------|
| `UTP_ENABLED` | `true` | Universal Temporal Platform (calendar/scheduling) |
| `UTP_ADSPOT` | `false` | Ad spot management module |
| `UTP_WORKFORCE` | `false` | Workforce scheduling and shift management |
| `UTP_CAPACITY` | `false` | Resource capacity planning |
| `UTP_EXTERNAL_CONNECTORS` | `false` | External calendar connector support |

## Usage

### API Access (Owner/Admin only)

```bash
# Get current flags
curl -H "Authorization: Bearer $API_KEY" \
  http://localhost:3000/api/v1/features/flags

# Update a flag
curl -X PUT -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"UTP_WORKFORCE": true}' \
  http://localhost:3000/api/v1/features/flags
```

### Service Integration

Services check flags before executing feature-specific logic:

```typescript
import { isFeatureEnabled, requireUTPEnabled } from "./features";

// Check if enabled (returns false silently)
const utpEnabled = await isFeatureEnabled(ctx, "UTP_ENABLED");

// Require enabled (throws if disabled)
await requireUTPEnabled(ctx); // Throws AppError if disabled
```

### UI Integration

The Settings page shows available features:
- Enabled features have full access
- Disabled features show upgrade/enable prompt
- Feature availability checks happen at route level

## Per-Workspace Configuration

Feature flags are stored in `SystemSetting` and scoped per organization:

| Key | Type | Scope |
|-----|------|-------|
| `feature_flag.utp_enabled` | boolean | WORKSPACE |

## Best Practices

1. **Graceful degradation** - Services should handle disabled features gracefully
2. **Documentation** - Update `docs/services/CONTRACTS.md` when adding new flags
3. **Testing** - Include feature flag checks in smoke tests
4. **Audit** - Flag changes are logged to `ActivityLog`

## Adding a New Flag

1. Add to `FEATURE_FLAG_KEYS` in `src/server/services/features.ts`
2. Default to `false` for paid features, `true` for free features
3. Update the Settings UI to display the new flag
4. Document in this file
