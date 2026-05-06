# TODO: Update plan.md to match current codebase structure

## ✅ Completed ✅

- [x] Analyze discrepancies between plan.md paths and current folder structure
- [x] Replace old `src/services/` references with `src/application/`
- [x] Replace old `src/api/` references with `src/infrastructure/api/`
- [x] Replace old `src/output/` references with `src/infrastructure/output/`
- [x] Replace specific files: `firebase.js` → `firebase-storage.js`, `cli.js` → `cli-utils.js`, etc.
- [x] Replace old `src/utils/` references with `src/infrastructure/utils/`
- [x] Replace old `src/mappers/` references with `src/domain/mappers/`
- [x] Replace old `src/services/match-registry.js` with `src/infrastructure/database/firebase-firestore.js`
- [x] Replace old `src/services/database.js` with `src/infrastructure/database/sqlite-client.js`
- [x] Update Part B "Proposed final layout" tree to use current structure as baseline (§6 reflects current scripts location)
- [x] Verify no old path references remain in plan.md

## ✅ Plan.md Path Updates Completed ✅

All path references in plan.md have been updated to use the new layered architecture nomenclature:

| Old Path | New Path |
|---|---|
| `src/services/` | `src/application/` |
| `src/api/` | `src/infrastructure/api/` |
| `src/output/` | `src/infrastructure/output/` |
| `src/output/firebase.js` | `src/infrastructure/output/firebase-storage.js` |
| `src/utils/cli.js` | `src/presentation/cli-utils.js` |
| `src/utils/io.js` | `src/infrastructure/utils/io.js` |
| `src/utils/logger.js` | `src/infrastructure/utils/logger.js` |
| `src/utils/metadata.js` | `src/infrastructure/utils/metadata.js` |
| `src/utils/sleep.js` | `src/infrastructure/utils/sleep.js` |
| `src/utils/parser.js` | `src/domain/parser.js` |
| `src/mappers/champion-details.js` | `src/domain/mappers/champion-details.js` |
| `src/mappers/champion-list.js` | `src/domain/mappers/champion-list.js` |
| `scripts/{crawl,sync-master}.js` | `src/application/{crawler,sync-master}.js` |
| `src/services/crawler/` | `src/application/crawler/` |

Special cases also fixed:
- `api/ → services/ → mappers/ → output/` → `infrastructure/api/ → application/ → domain/mappers/ → infrastructure/output/`
- `../services/aggregator` → `../application/aggregator`
- `require("../src/services")` pattern corrected to current reality

## Next Steps

If any new path references are discovered during implementation, add them here.

