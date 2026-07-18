---
name: RTMP SourceType enum
description: "rtmp" must be in the SourceType enum in openapi.yaml or API rejects source creation with 400
---

## Rule
Any new source type added to the frontend must also be added to the SourceType enum in `lib/api-spec/openapi.yaml` (3 locations).

**Why:** The API route uses a generated Zod schema (CreateSourceBody) that validates the `type` field against the enum. Missing values cause a 400 rejection with no visible feedback to the user.

**How to apply:** After editing openapi.yaml, re-run orval then reapply the queryKey patch:
```bash
cd lib/api-spec && pnpm exec orval --config orval.config.ts
# python3 patch script — replaces query?:UseQueryOptions<...> with Omit version (24 occurrences)
pnpm run typecheck:libs
```
