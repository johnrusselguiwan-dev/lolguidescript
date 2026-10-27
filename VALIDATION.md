# Firestore data validation

This change adds validation only. It does not publish data, create staging documents,
fetch a production baseline for comparison, or change production document paths.

## Shared contract

The publisher's `src/domain/validation/data-contract.json` and the app's
`lolguide/src/main/resources/com/heroapps/lolguide/data/validation/data-contract.json`
are identical copies of contract version 1. The two `validation-cases.json` files
are shared acceptance/rejection fixtures. Keep both copies synchronized when
changing an existing field. Unknown fields are accepted for forward compatibility;
known fields are checked even when optional.

The contract covers champion lists, details, meta, ratings, drafting, scaling,
items, rune trees, and summoner spells. It rejects unexpected empty datasets,
null records, duplicate IDs, wrong JSON types, missing required fields, invalid
percentages, out-of-range numeric fields, null nested list elements, and mismatched
skill arrays. Boots may be absent or null. Unknown schema versions are not yet
relevant: current Firestore documents contain only a JSON field, not a versioned envelope.

## Publisher

All public upload functions validate before creating a Firebase batch. Static
sync validates every selected dataset before its first output. Aggregation validates
all four analytics datasets before replacing local output files. Analytics datasets
must contain the same IDs, use the same patch, and match the requested region.
Empty scaling datasets are rejected rather than silently retaining old scaling data.
JSON payloads over 1,000,000 UTF-8 bytes are rejected to leave headroom below the
Firestore document size limit. This is a conservative payload cap, not an exact
Firestore document-size calculation.

From the scraper repository:

```sh
npm run test:validation
npm run validate           # existing global local analytics only
npm run validate -- SEA    # existing local analytics must be for SEA
```

These commands do not initialize Firebase, scrape new data, or modify output files.
Publishing still uses the existing CLI/dashboard actions; this change adds a
mandatory validation gate to those actions. Firestore publication and Remote Config
updates remain separate operations.

## App

Every Firestore dataset is validated as JSON before Gson deserialization. Missing
JSON fields and invalid payloads throw a validation error instead of returning an
empty list. The champion detail refresh requires all four source requests to succeed
and cover the same champion IDs before it merges data. If static and analytics
coverage differ, the refresh retains existing details and retries on a later refresh;
it does not fill failed/missing sections with defaults and overwrite the cache.

Bulk detail validation runs before any insert or version update, including forced
refreshes. An invalid refresh leaves the existing Room details and version intact.
The champion-list replacement maps first and clears/inserts in one Room transaction.
The data insert and version update for champion details are still separate operations;
a failed version update may cause a safe retry. This is not a release-promotion system.

Scaling supports the publisher's `championName` / `scalingData` fields and the older
`name` / `scalingPoints` names. No database migration is required.

```sh
bash gradlew :lolguide:testLolDebugUnitTest :lolguide:assembleLolDebug
```

The app and publisher changes must be deployed separately. Existing installed app
versions do not gain validation automatically. The publisher continues to allow
null boots as a documented optional value; the app fix is needed for old clients
that incorrectly required boots.

## Deliberate limits

This is structural validation and cross-dataset consistency checking. It does not
prove statistical accuracy or detect every valid-but-suspicious change. Production
comparison reports, configurable drop thresholds, staging, rollback, immutable
releases, and atomic active-release pointers are future work. No live Firestore
reads or writes are needed to run validation tests.
