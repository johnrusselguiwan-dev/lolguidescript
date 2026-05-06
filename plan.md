# Improvement Plan — Structure, UX, Aggregation & Firebase Publishing

This is a structured proposal for making the existing pipeline more intuitive
and the aggregation / publishing path smoother. It intentionally does **not**
rewrite working logic; it reorganises entry points, fixes safety / correctness
issues, and reduces unnecessary I/O. Each section is independent and can be
adopted incrementally.

---

## 1. Unify the entry points

### Current state
- `index.js` shows a 2-option menu (Static / Live).
- `npm run crawl` shows a different 4-option menu.
- `npm run sync` runs the static sync directly.
- `npm run draft` is a third tool unreachable from any menu.
- `run.bat` only launches `index.js` and does `pause` at the end (awkward
  after a multi-hour crawl).

The user has to learn three menus and the README to know what to do.

### Proposed
Single canonical entry point `index.js` (also reachable via `npm start` and
`run.bat`) with one cohesive menu:

```
LoL Guide · Master Control Panel
─────────────────────────────────
  1) Static Data Sync          Champions / Items / Runes / Spells → Firebase or JSON
  2) Crawl Ranked Matches      Solo or Team mode
  3) Merge & Publish Results   Aggregate crawl data → Firebase
  4) Draft Simulator           Interactive draft picks
  5) Status                    Show current patch, last sync, Firebase doc sizes
  q) Quit
```

`src/application/{crawler,sync-master}.js` and `scripts/draft.js` keep their current logic, but each
exports a single `run()` function that the menu invokes. Direct
`node src/application/...` or `node scripts/...` invocation still works for CI.

### Benefit
- One place to start. No mental model switching.
- `Status` option lets the user see *what is in Firebase right now* before
  overwriting it.

---

## 2. Make the recommended workflow obvious

### Current state
The README says the right order is **crawl → merge → sync**, but nothing in
the CLI nudges the user. A new user can easily `npm run sync` first and end up
with champion details containing placeholder data; nothing warns them.

### Proposed
1. In option (1) Static Sync, before fetching, check whether
   `data/CHAMPION_META.json` exists and whether its mtime is recent. If
   missing or stale, print:

   > ⚠ No recent crawler data found. Champion details will use placeholder
   > rates/builds. Run option (2) Crawl + (3) Merge first for real data.
   > Continue anyway? (y/N)

2. After option (3) Merge & Publish completes, prompt:

   > Done. Run Static Sync now to enrich champion_details with these
   > rates? (Y/n)

   If yes, jump straight into the static sync flow. This eliminates the
   "oh wait I have to run another command" step.

### Benefit
- The pipeline self-documents through prompts.
- Two-step "merge then sync" becomes one continuous flow.

---

## 3. Auto-publish after a successful crawl

### Current state
`src/application/crawler.js` ends with:

```js
await GlobalAggregator.mergeAll();
Logger.success("Crawl Complete!");
```

The local JSON files are written but *never uploaded*. The user has to come
back to the menu, pick option [4] Upload Only, to actually publish. Many
crawls finish overnight and the data sits unpublished.

### Proposed
After `mergeAll()` finishes a full ranked sweep:

```js
const meta = await readJson(STORAGE.CHAMPION_META, []);
if (meta.length > 0) {
    if (isAuto || await askConfirmation("Crawl complete. Publish to Firebase now?")) {
        await uploadTierData(meta, rating, drafting);
    }
}
```

Add a `--no-publish` flag for users who deliberately want a dry run.

### Benefit
- Removes a manual step that's easy to forget.
- `--no-publish` preserves the existing "stage locally first" workflow.

---

## 4. Reduce aggregation cost

### Current state
`mergeAll()` is called every time the crawler finishes a rank
(`src/application/crawler.js:293`). For each call it:
1. Reads `matchStore.json` and `timelines.json` for *all 31 ranks*.
2. Re-runs analytics from scratch.
3. Re-formats champion data.
4. Writes three output files.

After 31 rank transitions you've done that 31 times. Timelines files are the
biggest items on disk; rereading them is slow.

### Proposed
A. **Don't aggregate on every rank flip.** Aggregate only:
   - Once at the start (load existing `CHAMPION_META.json` if present).
   - Every N ranks (e.g. every 5) for progress visibility.
   - Once at the end before publishing.

B. **Cache per-rank stats**. Each rank can write a small
   `data/<TIER>/<DIV>/stats.json` (the per-rank reduction of `processChunk`).
   `mergeAll` then reduces those small files instead of rereading every match.
   Pseudocode:

```js
// Per-rank, after crawl cycle:
writeJson(rankDir/stats.json, AnalyticsEngine.reduce(matches, timelines));

// Aggregator:
for (rank) merge(stats, readJson(rankDir/stats.json));
return AnalyticsEngine.finalize(stats, total, assets);
```

This requires splitting `processChunk` into a *reducer* (per-rank, no
finalize) and `finalize` (global, runs once).

### Benefit
- `mergeAll` stops being O(allMatches × allTimelines) on every call.
- Crawl loop spends time crawling, not re-aggregating.

---

## 5. Fix Firestore document size risk

### Current state
`uploadTierData` puts each dataset into a *single Firestore document* as a
stringified JSON blob:

```js
batch.set(db.collection("data").doc("champion_drafting"), {
    json: JSON.stringify(drafting),
});
```

Firestore documents have a **1 MiB limit**. `champion_drafting` carries
untrimmed matchup data for every champion (~170 of them × all opponents).
This silently approaches the cap and will start failing as more data comes in.

### Proposed
A. **Detect and warn** before uploading:

```js
function assertDocSize(name, payload) {
    const bytes = Buffer.byteLength(payload, "utf8");
    if (bytes > 900_000) {
        Logger.warn(`${name} is ${(bytes/1024).toFixed(1)} KB — close to 1 MiB limit`);
    }
    if (bytes > 1_048_487) {
        throw new Error(`${name} exceeds Firestore 1 MiB doc limit (${bytes} bytes)`);
    }
}
```

B. **Shard if necessary** — for `champion_drafting` and `champion_meta`,
   shard by champion across documents:

```
data/champion_drafting/index             { championIds: [...] }
data/champion_drafting/<championId>      { matchups: {...} }
```

Consumers fetch the index, then the champion they need. This also makes
client-side reads cheaper.

### Benefit
- Removes a hidden ceiling that will be hit silently.
- Reduces client read cost — apps don't need to download all matchups to
  show one champion.

---

## 6. Fix patch tracking on tier data

### Current state
`uploadChampions` / `uploadItems` / `uploadRunes` / `uploadSpells` all set
`patch_info.latestPatch`. But `uploadTierData` only sets `lastUpdated`
(`src/infrastructure/output/firebase-storage.js:106-111`). After a crawler upload, `latestPatch`
still reflects whatever the last static sync wrote — even if the crawl ran
on a newer patch.

### Proposed
Capture the patch version at the start of the crawl (already available
through `AssetManager.getAssets().ddragonVersion`) and pass it into
`uploadTierData`:

```js
async function uploadTierData(meta, rating, drafting, patchVersion) {
    ...
    batch.set(systemMetadata.doc("patch_info"), {
        latestPatch: patchVersion,
        lastUpdated: serverTimestamp(),
    }, { merge: true });
}
```

Also add a per-document `patchVersion` field so consumers can detect
mismatched data without trusting the global doc.

### Benefit
- No more silently-mismatched patch labels.
- Apps can reject stale data cleanly.

---

## 7. Make the three writes atomic-ish

### Current state
`uploadTierData` uses a Firestore batch (good). But if the batch fails
mid-write (network drop, quota), the *partial* set may have been retried and
some docs reflect new data while others don't — readers can see a
champion in `champion_rating` but not in `champion_meta`.

### Proposed
A. Add a top-level `data/champion_meta_index { revision: N, patch: "14.x" }`
   document, written **last** in the batch. Clients only consider data fresh
   when `revision` increments.

B. Wrap the upload in a Firestore transaction or use a versioned doc path:

```
data/champion_meta_v{N}
data/champion_rating_v{N}
data/champion_drafting_v{N}
```

with the index doc pointing to the active N. Bumping N is the atomic commit.
Old versions can be garbage-collected later.

### Benefit
- Clients never read mismatched datasets.
- Easy rollback: change the index back to revision N-1.

---

## 8. Compact the seen-matches registry

### Current state
`MatchRegistry.markSeen()` keeps appending to a single `seenMatches` array
in `system_metadata/crawler_state` via `arrayUnion`. Over time this:
- Approaches the 1 MiB doc limit (~50k match IDs is already 800 KB).
- Reads the *whole array* on every `loadSeen()` call.
- Has two sources of truth with `STORAGE.GLOBAL_SEEN` local file.

### Proposed
A. **Hash-bucket the seen set** by month or by match-ID prefix:

```
system_metadata/crawler_state/buckets/<yyyy-mm>   { seenMatches: [...] }
```

B. **Drop the local mirror** (`STORAGE.GLOBAL_SEEN`). The Firebase copy is
   already authoritative; the local file just adds drift.

C. **Periodic compaction**: archive buckets older than X months to a backup
   collection and delete from the active set.

### Benefit
- Constant-bounded reads.
- One source of truth.
- Long-running deployments don't hit the array ceiling.

---

## 9. Reduce hot-path I/O

### Current state
Each crawl cycle (`runCycle`) writes:
- `matchStore.json` (large, full match objects).
- `timelines.json` (largest, full timeline frames per match).
- `pageState.json`
- `ranking.json`
- and the outer loop writes `crawlerState.json` + `globalSeenMatches.json`.

Every cycle rewrites the *entire* file even though only a few matches were
appended.

### Proposed
A. **Append-only NDJSON** for matches and timelines:

```
data/<TIER>/<DIV>/matches.ndjson   # one JSON object per line
data/<TIER>/<DIV>/timelines.ndjson
```

`fs.appendFile` is dramatically faster than `JSON.stringify(wholeArray)` +
`writeFile` once files get large. Read-time conversion is a one-shot
`.split("\n").filter(Boolean).map(JSON.parse)`.

B. **Defer ranking.json**. It's recomputed every cycle but only consumed at
   merge time. Drop it from the hot path; let `mergeAll` produce it.

### Benefit
- Faster cycles, especially in late-game when timelines.json is huge.
- Less wear on disks (relevant since the README mentions multiple laptops).

---

## 10. Move data normalisation out of the analytics hot loop

### Current state
`AnalyticsEngine.processChunk` contains:
- A hardcoded `BOOT_DOWNGRADE_MAP` (Tier-3 → Tier-2 boots).
- `if (hero === "FiddleSticks") hero = "Fiddlesticks";` (twice).

These are *normalisation* concerns leaking into the analytics inner loop.

### Proposed
A small `src/application/normalize.js` that exposes:

```js
normalizeChampionName(name)
normalizeItemId(id)
```

Called once per match in a preprocessing step (or inside the API layer
right after fetch). Analytics then operates on cleaned data and stays
focused on stats.

### Benefit
- New normalisations (future Riot renames, new boot tiers) live in one
  place, not scattered through analytics.
- Analytics is easier to test in isolation.

---

## 11. Safety rails for destructive Firebase uploads

### Current state
A single `y` keypress overwrites production data. No dry-run, no preview,
no diff. The CI auto mode (`AUTO_SYNC=true`) skips the confirmation entirely.

### Proposed
A. **`--dry-run` flag** that runs the full pipeline and prints the size and
   patch of each doc that *would* be written, without committing.

B. **Pre-upload diff**: before committing the batch, fetch existing
   `patch_info.latestPatch` and `lastUpdated`. Show:

   ```
   About to upload to Firebase:
     champion_meta:     245 KB  (patch 14.18 → 14.19)
     champion_rating:    34 KB  (patch 14.18 → 14.19)
     champion_drafting: 612 KB  (patch 14.18 → 14.19)  ⚠ approaching 1 MiB
   Last update: 2026-04-21 14:33 UTC (7 days ago)
   Proceed? (y/N)
   ```

C. **Lock file in Firestore** (`system_metadata/upload_lock`) so two
   machines can't publish simultaneously.

### Benefit
- No accidental overwrites.
- CI can use `--dry-run` for PR validation.
- Distributed crawl + merge can't race on publish.

---

## 12. Tighten `run.bat`

### Current state
- Only launches `index.js`.
- `pause` at the end means after a 6-hour crawl the user comes back to
  "press any key to continue" before the window closes.
- No way to launch directly into auto mode.

### Proposed

```bat
@echo off
IF NOT EXIST "node_modules\" call npm install
IF "%1"=="auto" (
    node --max-old-space-size=8192 src/application/sync-master.js --auto
) ELSE (
    node --max-old-space-size=8192 index.js
)
```

Drop `pause` — modern Windows Terminal keeps the tab open after a script
exits when launched from a terminal, and double-click users will see the
final summary lines anyway.

### Benefit
- `run.bat auto` is a one-click CI/scheduled sync.
- No awkward post-completion prompt.

---

## Suggested adoption order

These are listed independently but they're not all equal value. Suggested
order if doing this incrementally:

| Priority | Item | Reason |
|---|---|---|
| P0 | §5 doc-size guard | Prevents silent data loss |
| P0 | §6 patch tracking on tier data | Correctness bug |
| P0 | §7 atomic publish | Consumers can read mismatched data today |
| P1 | §3 auto-publish after crawl | Removes a manual step that's easy to forget |
| P1 | §1 unify entry points | Biggest UX win |
| P1 | §11 safety rails | Prevents production overwrite accidents |
| P2 | §4 cheaper aggregation | Performance |
| P2 | §9 append-only NDJSON | Performance |
| P2 | §8 seen-matches compaction | Long-term scalability |
| P3 | §2 workflow nudges | Polish |
| P3 | §10 normalisation refactor | Maintainability |
| P3 | §12 run.bat tweaks | Minor polish |

---

## What is already good and should not change

- The `infrastructure/api/ → application/ → domain/mappers/ → infrastructure/output/` layering. Don't flatten it.
- `MatchRegistry` using `arrayUnion` for concurrent dedup is the right call.
- Per-rank directory layout (`data/<TIER>/<DIV>/`) is clean.
- The CLI colour/box/progress-bar style — keep it.
- `config/constants.js` as the single tuning surface — keep it.
- Confirmation prompts before destructive actions exist (just need to be
  more informative, see §11).

---

# Part B — File / Folder Architecture

The existing layering is good but has noticeable inconsistencies and a few
"orphan" files. This part is about *layout*, not behaviour.

## 13. Folder-architecture audit

### Issues observed

**B1. Two parallel "static data" pipelines that do almost the same thing.**
- `src/application/static-data.js` (`StaticDataExtractor`) fetches
  items/runes from DDragon, applies Kotlin-matching filters, writes
  `ITEMS_SUMMARY.json` / `RUNES_SUMMARY.json`.
- `src/application/items.js` + `src/application/runes.js` also fetch items/runes
  from DDragon via the `mappers/`.

These exist side-by-side. `static-data.js` is never imported anywhere in the
codebase that the menu reaches — it's an orphan referenced only via storage
constants. New developers will be confused which one is the "real" path.

**B2. One file mixes service + extractor + writer.**
`static-data.js` does HTTP fetch + filter + JSON write all in one class.
That violates the same separation-of-concerns rule the rest of the project
follows (`infrastructure/api/` → `application/` → `infrastructure/output/`). Move the writes into
`src/infrastructure/output/local-export.js` and the HTTP into `src/infrastructure/api/ddragon.js`.

**B3. `src/infrastructure/api/cdragon.js` is one tiny function.**
A whole file for a single endpoint. Either expand it (sensible — Community
Dragon has lots of useful data) or fold the call into `ddragon.js` under a
clearly-labelled helper. Solo-function files add navigation cost.

**B4. `assets/champion_metadata.json` lives at the project root.**
The `assets/` folder contains **source-controlled lookup data** (lanes,
regions per champion). But the crawler also writes runtime asset cache to
`data/assets/` (defined in `STORAGE.ASSETS`). Same word, two meanings.

Suggested rename:
```
assets/                     → resources/      # version-controlled inputs
data/assets/                → data/cache/     # runtime, gitignored
```

**B5. Firebase service-account JSON sits at the project root.**
`config/firebase.js:14` does:
```js
serviceAccount = require("../league-of-legends-guide-202602-firebase-adminsdk-fbsvc-7f51437389.json");
```
That filename is hard-coded and lives at the project root, which is risky
(easy to accidentally commit) and ugly. Move it under `config/` or
`secrets/`, gitignore the whole folder, and reference by env var path:
```
FIREBASE_SERVICE_ACCOUNT_FILE=./secrets/firebase-admin.json
```

**B6. `scripts/` and `src/` boundary is fuzzy.**
`src/application/crawler.js` defines a 477-line `Crawler` class that includes:
- CLI menu / readline / keypress handling
- The crawl loop
- The cycle logic
- Page-state management
- Aggregation triggering

It should be:
```
src/application/crawler.js                    # Thin: parses args, runs menu, calls services
src/application/crawler/
    crawler.js                      # Crawl loop only
    cycle.js                        # runCycle logic
    page-state.js                   # advance / persist page state
src/presentation/cli-utils.js                    # already has menus — extend it
```

`scripts/` should be ≤50 lines per file: argument parsing + orchestration.
Currently it carries business logic.

**B7. Mappers live next to services with no clear pairing convention.**
`src/domain/mappers/champion-details.js` builds the *detail* part of a champion,
`src/domain/mappers/champion-list.js` builds the *list* part. But both belong to
the same domain object. Group:
```
src/domain/mappers/champion/
    detail.js
    list.js
src/domain/mappers/items.js
src/domain/mappers/runes.js
src/domain/mappers/spells.js
```

**B8. No `src/index.js` re-export.**
Every consumer imports deeply: `require("../application/aggregator")`,
`require("../../config/constants")`. A barrel `src/index.js` (or per-folder
`index.js`) would give:
```js
const { AnalyticsEngine, GlobalAggregator } = require("../src/services");
```
Optional, but cuts deep relative paths.

### Proposed final layout

```
lolguidescript/
├── index.js                        # ≤40 lines: master menu only
├── run.bat
├── package.json
├── README.md
│
├── config/
│   ├── constants.js
│   ├── firebase.js
│   └── .env.example
│
├── secrets/                        # gitignored
│   └── firebase-admin.json
│
├── resources/                      # version-controlled input data
│   └── champion_metadata.json
│
├── data/                           # gitignored runtime output
│   ├── cache/                      # DDragon asset cache (formerly data/assets/)
│   ├── <TIER>/<DIV>/               # per-rank match data
│   └── CHAMPION_*.json
│
├── scripts/                        # thin orchestrators (argv + menu only)
│   ├── sync.js                     # static sync
│   ├── crawl.js                    # ranked crawl
│   ├── publish.js                  # merge + upload
│   └── draft.js                    # draft simulator
│
└── src/
    ├── api/
    │   ├── ddragon.js
    │   ├── cdragon.js              # expanded or merged
    │   └── riot-client.js
    │
    ├── mappers/
    │   ├── champion/
    │   │   ├── detail.js
    │   │   └── list.js
    │   ├── items.js
    │   ├── runes.js
    │   └── spells.js
    │
    ├── services/
    │   ├── crawler/
    │   │   ├── crawler.js
    │   │   ├── cycle.js
    │   │   └── page-state.js
    │   ├── aggregator.js
    │   ├── analytics.js
    │   ├── asset-manager.js
    │   ├── champions.js
    │   ├── items.js
    │   ├── match-registry.js
    │   ├── normalize.js            # NEW (see §10)
    │   ├── runes.js
    │   └── spells.js
    │
    ├── output/
    │   ├── firebase.js
    │   └── local-export.js
    │
    └── utils/
        ├── cli/
        │   ├── colors.js
        │   ├── menus.js
        │   ├── progress.js
        │   └── prompt.js
        ├── io.js
        ├── logger.js
        ├── metadata.js             # also rename → resources.js (clearer)
        ├── parser.js
        └── sleep.js
```

Renames are not free — but they document the layering and make new files
obvious where to put.

---

# Part C — Crash-resilience: the "one error kills everything" problem

You're right: there are several spots where a single failure brings the
whole pipeline down. This is fixable without much refactoring.

## 14. Fix `await (await fetch(...)).json()` pattern

### Current
`src/application/asset-manager.js:27, 35` and `src/application/static-data.js:19, 23, 24` use:

```js
const realm = await (await fetch(DDRAGON.REALM_URL)).json();
```

Two things wrong:
1. **No status check.** If DDragon returns a 5xx HTML error page, `.json()`
   throws a parse error and the message is opaque ("Unexpected token <...").
2. **No timeout.** Native `fetch` has no default timeout; a hung CDN
   connection stalls the crawler forever.
3. **Stylistically nested.** The double-await pattern obscures intent.

### Proposed
Add a thin helper in `src/infrastructure/api/http.js` (NEW):

```js
async function getJson(url, { timeoutMs = 15000 } = {}) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) {
            throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
        }
        return await res.json();
    } finally {
        clearTimeout(t);
    }
}
```

Replace every `await (await fetch(x)).json()` with `await getJson(x)`.

### Benefit
- Errors are descriptive.
- Hung connections fail in 15 s instead of hanging the crawler.
- Single helper means future cross-cutting concerns (caching, retries,
  user-agent header) live in one place.

---

## 15. `Promise.all` is a "fail one, fail all" trap

### Current

`src/application/asset-manager.js:41`:
```js
const [champs, items, spells, runes] = await Promise.all([
    fetchCache("champions", `${base}/champion.json`),
    fetchCache("items", `${base}/item.json`),
    fetchCache("summoners", `${base}/summoner.json`),
    fetchCache("runes", `${base}/runesReforged.json`),
]);
```
If any single fetch rejects (transient DDragon hiccup), the *entire* asset
load fails → `getAssets()` throws → caller crashes.

`src/application/champions.js:54`:
```js
const chunkResults = await Promise.all(chunkPromises);
```
If one of the 20 champion-detail fetches in a chunk fails, the whole batch
of 20 is lost — including the 19 that succeeded.

### Proposed
Use **`Promise.allSettled`** for tolerant batch fetching, then surface
which ones failed:

```js
const results = await Promise.allSettled(chunkPromises);
const succeeded = [];
const failed = [];
results.forEach((r, i) => {
    if (r.status === "fulfilled") succeeded.push(r.value);
    else failed.push({ id: chunkKeys[i], error: r.reason.message });
});
if (failed.length) Logger.warn(`${failed.length} failures in this chunk: ${failed.map(f => f.id).join(", ")}`);
return succeeded;
```

For asset-manager, fall back to cached version if the live fetch fails:

```js
async function fetchCache(name, url) {
    const cachePath = path.join(STORAGE.ASSETS, `${name}_${v}.json`);
    try {
        let data = await readJson(cachePath);
        if (!data) {
            data = await getJson(url);
            await writeJson(cachePath, data);
        }
        return data;
    } catch (e) {
        // Last-resort: any older cached version of this name
        const fallback = await findAnyCachedVersion(name);
        if (fallback) {
            Logger.warn(`Using stale cache for ${name}: ${e.message}`);
            return fallback;
        }
        throw e;
    }
}
```

### Benefit
- A single network blip doesn't kill an entire crawl run.
- Champion sync becomes resilient — partial completion is now possible
  and reported, not a silent total failure.

---

## 16. Wrap the crawl-cycle entry point in a top-level try/catch

### Current

`src/application/crawler.js` `start()` has the outer catch only at the very end:
```js
new Crawler().start().catch((err) => Logger.error("Fatal Error", err));
```
But inside the loop, an unexpected throw (corrupt match JSON, asset fetch
failure, mergeAll exception) bubbles up and exits the process *before*
state is persisted. The user loses progress for that cycle.

### Proposed
Wrap each iteration of the crawl loop in its own `try/catch`. If something
fails:
1. Log the error.
2. **Persist current state.**
3. Sleep a back-off interval.
4. Try the next iteration.

```js
while (state.rankIndex < rankEnd) {
    try {
        await this.runOneIteration(state, ...);
    } catch (err) {
        Logger.error(`Cycle failed: ${err.message}. State saved. Retrying in 30s...`);
        await writeJson(STORAGE.CRAWL_STATE, state);
        await this.interruptibleSleep(30_000);
    }
}
```

### Benefit
- "One bad match crashes everything" is gone.
- Multi-hour crawls survive transient DDragon / Riot blips.

---

## 17. `mergeAll()` runs unguarded inside the crawl loop

### Current
`src/application/crawler.js:293`:
```js
state.rankIndex++;
state.currentMatches = 0;
state.initialStoreSize = undefined;
await writeJson(STORAGE.CRAWL_STATE, state);
await GlobalAggregator.mergeAll();   // ← unguarded
continue;
```
If `mergeAll` throws (corrupt rank file, disk full, asset re-fetch failure),
the crawler dies *after* successfully completing a rank. State is saved,
yes, but the user wakes up to "Fatal Error" with no idea aggregation is the
culprit.

Also, the matches *are already on disk* — aggregation can always be redone
later. It's a reporting / pre-publish step, not a crawl step.

### Proposed
Either:
- Move `mergeAll()` calls outside the crawl loop entirely (run at end), or
- Wrap each call in `try/catch` and treat aggregation failures as warnings:

```js
try { await GlobalAggregator.mergeAll(); }
catch (e) { Logger.warn(`Aggregation failed (non-fatal, will retry later): ${e.message}`); }
```

### Benefit
- Aggregation failures don't terminate a crawl in progress.
- Clear separation: crawling produces files; aggregation consumes them.

---

## 18. Make `loadLocalMetadata` async (consistency + non-blocking)

### Current
`src/infrastructure/utils/metadata.js`:
```js
const fs = require("fs");
function loadLocalMetadata() {
    const raw = JSON.parse(fs.readFileSync(META_PATH, "utf-8"));
    ...
}
```
Sync I/O blocks the event loop. Everything else in the codebase uses
`fs/promises`. It's a small file, but the pattern leaks: new contributors
copy-paste it.

### Proposed
```js
const { readJson } = require("./io");

async function loadLocalMetadata() {
    const raw = await readJson(META_PATH, []);
    const metaMap = {};
    raw.forEach((item) => { metaMap[item.id] = item; });
    return metaMap;
}
```

### Benefit
- One async style across the codebase.
- Doesn't block the event loop while loading 170-row metadata.

---

## 19. `RiotClient.fetch` retry loop has a return-undefined edge case

### Current
`src/infrastructure/api/riot-client.js:45-96`:
```js
for (let i = 0; i < API.RETRY_ATTEMPTS; i++) {
    try {
        const res = await fetch(url, ...);
        if (res.status === 429) { await sleep(wait); continue; }
        ...
        return await res.json();
    } catch (err) {
        if (...) throw err;
        if (i === API.RETRY_ATTEMPTS - 1) throw err;
        Logger.warn(`...Retrying...`);
        await sleep(2000);
    }
}
// ← NOTE: implicit `return undefined` here
```

If every attempt is a 429 and the loop exhausts, the function *returns
undefined* with no throw. Callers like `getMatchDetail` will then push
`undefined` into `localStore`, which corrupts later analytics (silently —
no error, just bad data).

### Proposed
Add an explicit throw after the loop:
```js
throw new Error(`Failed after ${API.RETRY_ATTEMPTS} retries: ${url}`);
```

### Benefit
- No silent corruption.
- Failures bubble to the per-cycle try/catch (§16) which then survives.

---

## 20. Resource cleanup — readline interfaces leak on errors

### Current
`src/application/crawler.js:127-156`, `src/presentation/cli-utils.js:31-37`, `index.js:7-12`,
`scripts/draft.js:65` all do:
```js
const rl = readline.createInterface({ input, output });
rl.question("...", (ans) => { rl.close(); resolve(ans); });
```
If the question's body throws (unlikely but possible), `rl.close()` is
never called and the process can hang on shutdown because stdin is still
held.

### Proposed
A small helper:
```js
async function withReadline(fn) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try { return await fn(rl); } finally { rl.close(); }
}
```

Or, since multiple prompts in a row keep recreating the interface (e.g.
`askTeamConfig` does it once but `index.js` + `crawl.js` re-create it for
each menu), use a **single shared readline** that lives for the duration
of the menu phase.

### Benefit
- No leaked file handles on the main loop.
- Fewer `setRawMode` flips when chaining prompts.

---

# Part D — JavaScript coding standard for this project

Goal: a one-page set of conventions that any JS dev can read in 5 minutes
and immediately know how to write code that fits this codebase.

## 21. Coding standard (proposed `STANDARDS.md`)

### File anatomy

Every source file must:
1. Begin with a **JSDoc block** stating its purpose.
2. Group `require()` calls in this order, separated by blank lines:
   - Node built-ins (`fs`, `path`, …)
   - Third-party (`axios`, `firebase-admin`, …)
   - Project config (`../../config/...`)
   - Project sources (`../api/...`, `../services/...`, `../utils/...`)
3. End with a single `module.exports = { ... }`. No mixed
   `module.exports.x = ...` and `module.exports = ...` styles.

Example:
```js
/**
 * Champion data service — fetches, processes, and validates all champion data.
 */

const path = require("path");

const axios = require("axios");

const { STORAGE } = require("../../config/constants");

const { api } = require("../api/ddragon");
const { buildDetailEntry } = require("../mappers/champion/detail");
const Logger = require("../utils/logger");

// ... code ...

module.exports = { fetchAndProcessChampions };
```

### Naming

| Element                    | Style         | Example                          |
|---------------------------|---------------|----------------------------------|
| Files                     | kebab-case    | `match-registry.js`              |
| Folders                   | kebab-case    | `services/crawler/`              |
| Classes                   | PascalCase    | `RiotClient`, `AnalyticsEngine`  |
| Functions / methods       | camelCase     | `fetchAndProcessChampions`       |
| Module-level constants    | UPPER_SNAKE   | `MAX_REQUESTS_PER_CYCLE`         |
| Local constants           | camelCase     | `const baseUrl = ...`            |
| "Service" exports         | named exports | `module.exports = { foo, bar };` |

### Async rules

1. **Every async function caller awaits or `.catch()`s — never both, never
   neither.** Floating promises = silent crashes.
2. **No `await` inside `Array.prototype.forEach`.** `forEach` ignores the
   returned promise. Use `for…of` for sequential or
   `Promise.allSettled(map(...))` for parallel.
3. **Replace `Promise.all` with `Promise.allSettled`** for any batch where
   partial completion is acceptable (every batch in this project qualifies).
4. **Never write `await (await fetch(x)).json()`.** Use a `getJson(url)`
   helper that handles status and timeout.
5. **Every `for await` loop and every async function must be inside a
   `try/catch`** if it touches the network or disk.

### Error handling

1. Distinguish **fatal** (process must die — bad config, missing API key)
   from **recoverable** (transient I/O — log and continue).
2. Use **typed errors via `error.code` strings**, not parsed messages:
   ```js
   throw Object.assign(new Error("Riot API key invalid"), { code: "API_KEY_INVALID" });
   ```
   Callers check `err.code === "API_KEY_INVALID"`, not `err.message`.
3. **`process.exit(1)` only at top level** (entry scripts). Library code
   throws.

### Logging

| Use                 | Method               | Audience            |
|---------------------|----------------------|---------------------|
| Lifecycle events    | `Logger.info`        | User                |
| Successful steps    | `Logger.success`     | User                |
| Recoverable issues  | `Logger.warn`        | User                |
| Failures            | `Logger.error`       | User                |
| Per-request trace   | `Logger.log`         | User (verbose)      |
| Internal debug data | `console.debug` + `process.env.DEBUG` | Developer  |

Every log line must contain enough context to be findable. Don't log
"failed" — log "failed: matchId=NA1_4567 reason=429". Bare exception
messages (`err.message` only) are insufficient.

### State / I/O

1. Files in `data/` are *runtime state*. Files in `resources/` are
   *committed inputs*. Never write to `resources/`.
2. Use `readJson(path, fallback)` and `writeJson(path, data)` from
   `src/infrastructure/utils/io.js`. Never call `fs.readFileSync` directly except in
   `config/`.
3. Persistent JSON paths must be defined in `config/constants.js`. Never
   inline a path string in a service.
4. After mutating state, persist *before* sleeping or making a network
   call. State on disk after every observable side-effect.

### Modules

1. **One responsibility per file.** A file named `crawler.js` should
   contain the crawl loop, *not* CLI handling.
2. Files >200 lines must be split. `src/application/crawler.js` (480 lines today)
   is the canonical anti-example.
3. Classes are allowed where state is genuinely encapsulated
   (`RiotClient`, `Crawler`). Single-method classes
   (`class StaticDataExtractor { static async extractAndSave() {...} }`)
   should be plain modules of functions.

### Comments

1. JSDoc on every exported function with at least `@param` types and
   `@returns`. Editors then give autocomplete without TypeScript.
2. Comment **why**, not what. `// increment used count` is noise.
   `// Riot rate-limits at 100 req / 2 min — pace ourselves at 30 req/min`
   is useful.
3. Section dividers — keep the existing convention:
   ```js
   // ── Section Title ──────────────────────────────────────
   ```

### Lint / format

Add minimal tooling so reviewers don't argue about style:
- `.editorconfig` — 4 spaces, LF endings, UTF-8.
- `eslint` with `eslint:recommended` + a few project rules:
  - `no-floating-promises` (via `eslint-plugin-promise`)
  - `no-await-in-loop` warn (allows for-loops with explicit comment)
  - `consistent-return`
  - `prefer-const`
- `prettier` for formatting; print-width 100.

A `npm run lint` script wired into the recommended workflow makes this
self-enforcing.

---

---

# Part E — Data resilience: API fallbacks, validation, and rollback

The pipeline depends on three external services (Riot, Data Dragon,
Community Dragon) and one of your own (Firebase). Any of them can fail,
return malformed data, or return *technically valid* data that's actually
garbage (Riot has shipped broken patches before). You also need a way to
say "the data we just published is bad — go back."

## 22. Multi-source fallback for upstream APIs

### Threat model
What can go wrong with the upstream APIs:

| Source            | Failure mode                      | Effect today                        |
|-------------------|-----------------------------------|-------------------------------------|
| Data Dragon       | CDN timeout / 5xx                 | Crawler dies, sync fails            |
| Data Dragon       | Latest patch missing fields       | Mappers silently produce garbage    |
| Community Dragon  | 404 on hardcoded `13.24` URL      | Spell sync fails, no fallback       |
| Riot ranked API   | Key revoked mid-crawl             | Handled (pause + prompt)            |
| Riot ranked API   | Region down                       | Crawl loops forever on errors       |
| All               | DNS / network / proxy blocking    | Whole pipeline blocks               |

### Proposed: cascading fallback chain

For each external dataset, define an ordered chain of sources. The first
that succeeds wins. The chain is data, not code:

```js
// src/infrastructure/api/sources.js
const SOURCES = {
    championList: [
        { name: "ddragon-live",     fn: (v) => ddragon.getChampionList(v) },
        { name: "ddragon-mirror",   fn: (v) => ddragonMirror.getChampionList(v) },
        { name: "cdragon-fallback", fn: (v) => cdragon.getChampionList(v) },
        { name: "local-snapshot",   fn: (v) => loadSnapshot("champion-list", v) },
    ],
    summonerSpells: [
        { name: "cdragon-13.24",    fn: () => cdragon.getSpells("13.24") },
        { name: "cdragon-latest",   fn: () => cdragon.getSpells("latest") },
        { name: "ddragon-live",     fn: (v) => ddragon.getSpells(v) },
        { name: "local-snapshot",   fn: () => loadSnapshot("summoner-spells") },
    ],
    // ...
};

async function fetchWithFallback(key, version) {
    for (const source of SOURCES[key]) {
        try {
            const data = await source.fn(version);
            if (validate(key, data)) {
                Logger.info(`[${key}] fetched from ${source.name}`);
                return { data, source: source.name };
            }
            Logger.warn(`[${key}] ${source.name} returned invalid data, trying next`);
        } catch (e) {
            Logger.warn(`[${key}] ${source.name} failed: ${e.message}`);
        }
    }
    throw new Error(`All sources failed for ${key}`);
}
```

### What goes in `local-snapshot/`

A directory of last-known-good payloads, refreshed automatically on every
successful sync:

```
data/
└── snapshots/
    ├── champion-list/
    │   ├── 14.18.json
    │   ├── 14.19.json
    │   └── latest.json -> 14.19.json   # symlink or copy
    ├── summoner-spells/
    │   └── ...
    └── meta.json   # { "champion-list": { source: "ddragon-live", fetchedAt: ... } }
```

When all live sources fail, `loadSnapshot` returns the most recent matching
patch. The crawler keeps going on slightly stale data instead of dying.

### Benefit
- **No single point of failure** for upstream data.
- **Graceful degradation**: stale data is better than no data.
- **Auditable**: logs name the source for every fetch.

---

## 23. Validate every payload before trusting it

### Current state
Mappers assume incoming data has the right shape. If DDragon ships a
broken patch (it has happened), `buildDetailEntry` happily dereferences
`raw.spells[0].cooldownBurn` and crashes — or worse, silently produces
malformed output that gets written to Firebase.

### Proposed: schema gates

A lightweight validator (no need for a full library — `zod` or a hand-rolled
`assertShape` is fine) at every boundary:

```js
// src/validators/champion.js
function validateChampionDetail(raw) {
    const errors = [];
    if (!raw?.id || typeof raw.id !== "string") errors.push("missing id");
    if (!raw?.key || isNaN(Number(raw.key))) errors.push("missing/invalid key");
    if (!Array.isArray(raw?.spells) || raw.spells.length !== 4) errors.push("expected 4 spells");
    if (!raw?.passive?.name) errors.push("missing passive");
    if (!raw?.image?.full) errors.push("missing image");
    return errors;
}

// Used in service:
const errors = validateChampionDetail(raw);
if (errors.length) {
    Logger.warn(`Skipping ${id}: ${errors.join(", ")}`);
    return null;   // null is filtered out before Firebase write
}
```

Apply at three points:
1. **After API fetch** — reject malformed champions individually.
2. **After mapping** — confirm output has all required fields before
   saving to local JSON.
3. **Before Firebase upload** — refuse to publish if record count is below
   a threshold (e.g. `< 150 champions` → almost certainly broken upstream).

### Sanity-check thresholds

```js
// src/validators/aggregate.js
const SANITY = {
    minChampions: 150,         // Riot ships ~170 champs
    maxChampions: 250,
    minWinRate: 35,            // No champ should be below ~40%
    maxWinRate: 65,
    minPickRate: 0,
    maxPickRate: 100,
    minMatchesAnalyzed: 1000,  // Don't publish if too few matches crawled
};

function assertSane(meta, totalMatches) {
    if (totalMatches < SANITY.minMatchesAnalyzed)
        throw new Error(`Only ${totalMatches} matches analyzed, refusing to publish`);
    if (meta.length < SANITY.minChampions)
        throw new Error(`Only ${meta.length} champions, expected >= ${SANITY.minChampions}`);
    for (const ch of meta) {
        if (ch.winRate < SANITY.minWinRate || ch.winRate > SANITY.maxWinRate)
            throw new Error(`${ch.championName} winRate ${ch.winRate} outside sane range`);
    }
}
```

The publish step (§3) calls `assertSane(...)` before `uploadTierData(...)`.
Garbage never reaches Firebase.

### Benefit
- Bad upstream data is caught at the boundary, not after publish.
- Aggregation bugs (e.g. denominator-of-zero) get loud errors instead of
  silent corruption.

---

## 24. Versioned Firestore documents — the rollback foundation

This expands §7 into a full rollback strategy.

### Design

Stop overwriting `data/champion_meta`. Instead, write to a versioned path
and maintain a pointer document:

```
data/
├── _index                          ← clients read this first
│     {
│       activeRevision: 42,
│       previousRevision: 41,
│       patch: "14.19",
│       publishedAt: <Timestamp>,
│       publishedBy: "laptop-1",
│       sources: { championList: "ddragon-live", spells: "cdragon-13.24", ... }
│     }
│
├── champion_meta_v41               ← previous (kept)
├── champion_meta_v42               ← current
├── champion_rating_v41
├── champion_rating_v42
├── champion_drafting_v41
├── champion_drafting_v42
├── champion_list_v41
├── champion_list_v42
├── champion_details_v41
└── champion_details_v42

revisions/
└── v42                             ← audit doc per revision
      {
        committedAt, committedBy, patch, recordCounts,
        sanityChecks: { passed: true, warnings: [...] },
        sources: { ... }
      }
```

### Publish flow

```js
async function publish({ meta, rating, drafting, list, details, patch, sources }) {
    // 1. Sanity gate (§23)
    assertSane(meta, totalMatches);

    // 2. Acquire upload lock (§11)
    await acquireLock();

    // 3. Read current index
    const idx = await db.collection("data").doc("_index").get();
    const current = idx.exists ? idx.data().activeRevision : 0;
    const next = current + 1;

    // 4. Write all v{next} docs in a batch
    const batch = db.batch();
    batch.set(db.doc(`data/champion_meta_v${next}`),     { json: JSON.stringify(meta) });
    batch.set(db.doc(`data/champion_rating_v${next}`),   { json: JSON.stringify(rating) });
    batch.set(db.doc(`data/champion_drafting_v${next}`), { json: JSON.stringify(drafting) });
    batch.set(db.doc(`data/champion_list_v${next}`),     { json: JSON.stringify(list) });
    batch.set(db.doc(`data/champion_details_v${next}`),  { json: JSON.stringify(details) });
    batch.set(db.doc(`revisions/v${next}`), {
        committedAt: serverTimestamp(),
        committedBy: os.hostname(),
        patch, sources,
        recordCounts: { meta: meta.length, rating: rating.length, ... },
    });
    await batch.commit();

    // 5. Flip the index pointer (atomic single-doc write)
    await db.collection("data").doc("_index").set({
        activeRevision: next,
        previousRevision: current,
        patch,
        publishedAt: serverTimestamp(),
        publishedBy: os.hostname(),
        sources,
    });

    // 6. Clean up: keep last N revisions only
    await pruneOldRevisions(KEEP_REVISIONS);

    await releaseLock();
}
```

### Client read pattern

The Android app changes from:
```kotlin
db.collection("data").document("champion_meta")
```
to:
```kotlin
val idx = db.collection("data").document("_index").get()
val rev = idx["activeRevision"]
db.collection("data").document("champion_meta_v$rev")
```

That's two reads instead of one, but they're tiny and can be parallelised
(read `_index` and a *cached* `activeRevision` simultaneously, accept the
fresher one). For a published-mostly client this is negligible.

### Why this design

- **Atomic switch**: only the `_index` flip is observable. Until it flips,
  clients keep reading the previous revision. The batched v{next} writes
  can fail halfway and clients are unaffected.
- **Multi-doc transaction not needed**: Firestore's single-document
  guarantee is enough because clients gate on the index doc.
- **Audit trail**: every publish leaves a `revisions/v{N}` record.

---

## 25. Rollback — three flavours

With §24 in place, rollback becomes trivial. Add a CLI command:

```
npm run rollback              # interactive: lists last N revisions
npm run rollback -- --to 41   # explicit
npm run rollback -- --previous # one step back
```

### Implementation

```js
async function rollback({ to, previous }) {
    const idxRef = db.collection("data").doc("_index");
    const idx = (await idxRef.get()).data();

    let target = to;
    if (previous) target = idx.previousRevision;
    if (!target) throw new Error("Nothing to roll back to");

    // Verify target docs still exist
    const probe = await db.doc(`data/champion_meta_v${target}`).get();
    if (!probe.exists) throw new Error(`Revision v${target} is missing or pruned`);

    // Confirm with user — show what they're about to do
    const targetRevDoc = (await db.doc(`revisions/v${target}`).get()).data();
    Logger.warn(`Active rev ${idx.activeRevision} → v${target}`);
    Logger.warn(`Patch ${idx.patch} → ${targetRevDoc.patch}`);
    if (!await askConfirmation("Proceed?")) return;

    // Single-doc write — atomic
    await idxRef.set({
        activeRevision: target,
        previousRevision: idx.activeRevision,   // so undo works
        patch: targetRevDoc.patch,
        publishedAt: serverTimestamp(),
        publishedBy: os.hostname() + " (ROLLBACK)",
        sources: targetRevDoc.sources,
    });

    Logger.success(`Rolled back to v${target}`);
}
```

### Three rollback scenarios it covers

1. **"The latest publish is bad"** → `npm run rollback -- --previous`
   instantly. One Firestore write. Clients see the old data on next read.

2. **"Two publishes ago was fine, latest two are bad"** → list revisions
   with `npm run rollback`, pick `v40`. Same one-doc flip.

3. **"We need to go back to a specific patch"** → revisions table records
   the patch per revision; CLI can show:
   ```
   Last 5 revisions:
     v42  patch 14.19  2026-04-27 22:13   sources: ddragon-live          ← active
     v41  patch 14.19  2026-04-27 14:08   sources: ddragon-live
     v40  patch 14.18  2026-04-20 09:55   sources: ddragon-live
     v39  patch 14.18  2026-04-15 11:02   sources: ddragon-mirror
     v38  patch 14.17  2026-04-08 12:30   sources: ddragon-live
   ```

### Auto-rollback on health-check failure

Optional but powerful: a tiny health check after publish.

```js
// Run a few seconds after the index flip
async function postPublishHealthCheck(rev) {
    const meta = await db.doc(`data/champion_meta_v${rev}`).get();
    const data = JSON.parse(meta.data().json);
    try {
        assertSane(data, /* totalMatches from revisions doc */);
        Logger.success(`Post-publish health check OK for v${rev}`);
    } catch (e) {
        Logger.error(`Health check FAILED for v${rev}: ${e.message}`);
        Logger.warn("Auto-rolling back...");
        await rollback({ previous: true });
    }
}
```

---

## 26. Local snapshot mirroring (for the operator)

Mirror everything you publish to disk. If Firebase itself goes down, you
still have a local copy of the last N revisions.

```
data/published/
├── v40/
│   ├── champion_meta.json
│   ├── champion_rating.json
│   ├── champion_drafting.json
│   ├── champion_list.json
│   ├── champion_details.json
│   └── manifest.json    # { patch, committedAt, sources, sha256 of each file }
├── v41/
└── v42/
```

`manifest.json` carries an SHA-256 of each file. Before re-uploading from a
local mirror, the publisher verifies the hash matches. This protects
against silent disk corruption.

### Operator commands

```
npm run publish:from-local -- --rev 40   # republish a specific local revision
npm run mirror                           # download a Firestore revision to disk
npm run verify -- --rev 40               # sha256 check
```

### Benefit
- Disaster recovery if Firestore data is lost or corrupted.
- Forensic comparison: diff `v41` vs `v42` to see what regressed.
- Reproducibility: exact same payload republishable.

---

## 27. Operator dashboard / status command

Tie it all together with a `npm run status` command that any operator can
read in 3 seconds:

```
LoL Guide · Status
──────────────────────────────────────────────
Firebase active revision:  v42
Patch:                     14.19
Published:                 2026-04-27 22:13:42 UTC (3 hours ago)
Published by:              laptop-1
Sources used:
  championList   ddragon-live
  spells         cdragon-13.24
  items          ddragon-live
  matches        riot-sea (12,453 analyzed)

Sanity:                    ✔ all checks pass
Champions:                 168
Doc sizes:
  champion_meta_v42        245 KB
  champion_drafting_v42    612 KB ⚠  (close to 1 MiB)
  champion_rating_v42       34 KB

Recent revisions:
  v42  active  patch 14.19  2026-04-27 22:13
  v41          patch 14.19  2026-04-27 14:08
  v40          patch 14.18  2026-04-20 09:55

Local snapshots: 3 (v40, v41, v42, ~890 KB)
Crawler state:    DIAMOND II, 47/100 matches, last cycle 12 min ago
Riot key:         expires in 4h 12m  ⚠
```

Single screen, no clicking through Firebase Console.

---

## Combined resilience flow (Parts C + E together)

The fallback chain (§22) and validation (§23) live *inside* the resilient
fetch helpers from §14/§15. The flow becomes:

```
                      ┌────────────────────┐
                      │  fetchWithFallback │   ← §22 cascading sources
                      └─────────┬──────────┘
                                │  raw payload
                                ▼
                      ┌────────────────────┐
                      │     validate       │   ← §23 schema check
                      └─────────┬──────────┘
                                │  good shape  (else: try next source / skip)
                                ▼
                      ┌────────────────────┐
                      │      mapper        │   ← existing
                      └─────────┬──────────┘
                                │
                                ▼
                       data/CHAMPION_*.json
                                │
                                ▼
                      ┌────────────────────┐
                      │     assertSane     │   ← §23 aggregate check
                      └─────────┬──────────┘
                                │  passes
                                ▼
                      ┌────────────────────┐
                      │  publish v{N+1}    │   ← §24 versioned write
                      └─────────┬──────────┘
                                │
                                ▼
                      ┌────────────────────┐
                      │  flip _index       │   ← atomic single-doc
                      └─────────┬──────────┘
                                │
                                ▼
                      ┌────────────────────┐
                      │ post-publish check │   ← §25 auto-rollback if bad
                      └────────────────────┘
```

Every stage either succeeds, gracefully degrades, or refuses to advance —
so bad data never reaches users, and any publish can be undone in one
write.

---

---

# Part G — Compliance audit: Riot rate limits, Firestore caps, crawler state

Important question — do the proposals actually fit inside the published
limits of the services we depend on? Short answer: **most do, but a few of
the new ideas (especially §22 fallback chain and §26 republish) need
budget guardrails.** This part audits the current code, the proposed
changes, and prescribes hard limits.

> **Note**: Verify the exact numbers below against the current Riot
> developer portal and Firebase docs before relying on them — Riot
> tightens these periodically. The structure of the constraints is what
> matters here.

---

## 28. Riot API rate limits — current behaviour

### Published limits (typical)

| Key type      | Burst              | Sustained               |
|---------------|--------------------|-------------------------|
| Development   | 20 req / 1 s       | **100 req / 2 min**     |
| Production    | 500 req / 10 s     | 30,000 req / 10 min     |
| Per-method    | varies             | match-v5 has its own bucket |
| Per-region    | each region tracked separately |             |

The crawler today uses a development key (the README points users to
`developer.riotgames.com` and reminds them keys "expire every 24 hours" —
that's the dev key behavior).

### Current crawler pacing

From `config/constants.js`:
```js
SAFE_DELAY_MS: 3200,             // ~18.75 req/min
MAX_REQUESTS_PER_CYCLE: 40,
PAUSE_MS_BETWEEN_CYCLES: 60_000, // 60s pause after each cycle
```

Effective rate:
```
40 requests × 3.2s = 128s active
+ 60s pause
= 188s per 40 requests
≈ 12.8 req/min sustained
≈ 25.5 req per 2-minute window
```

That's **well under** the 100 / 2-min dev key cap. The crawler is
conservative — **good**. Burst-wise we're at ~1 req/3.2s, far under the
20 req/1s burst cap.

### Where this can still break

1. **No global rate-limit headers respected.** `RiotClient.fetch` only
   pauses on a 429 response. The headers `X-App-Rate-Limit`,
   `X-App-Rate-Limit-Count`, `X-Method-Rate-Limit`,
   `X-Method-Rate-Limit-Count` are ignored. Riot expects clients to read
   these proactively.

2. **Per-method buckets ignored.** `match-v5` has its own counter. The
   crawler treats all endpoints as one pool.

3. **Per-region awareness missing.** `API.PLATFORM = "sg2"` and
   `API.MATCH_REGION = "sea"` are *separate* regional pools. Today's
   single `this.used` counter mixes them, so a heavy ranked-list cycle
   (sg2) artificially limits match fetches (sea) even though they're
   different buckets.

4. **No global daily budget**. Dev keys expire at 24 h *but* there's no
   self-imposed daily cap. A bug that loops fetches could exhaust the
   key faster than expected.

### Proposed guardrails

A `RateLimiter` class that exposes a token-bucket per (region × method)
pair, parsed from response headers:

```js
// src/infrastructure/api/rate-limiter.js
class RateLimiter {
    constructor() {
        this.buckets = new Map(); // key: "sg2:method:league-v4" → { used, limit, windowMs, resetAt }
    }

    async waitFor(region, method) {
        const key = `${region}:${method}`;
        const bucket = this.buckets.get(key);
        if (!bucket) return;
        if (bucket.used >= bucket.limit * 0.9) {  // 90% safety margin
            const wait = Math.max(0, bucket.resetAt - Date.now());
            if (wait > 0) await sleep(wait);
        }
    }

    /** Parse headers after every response to update the bucket. */
    track(region, method, headers) {
        // X-App-Rate-Limit-Count header has format "1:1,1:120"
        // (current count : window seconds, comma-separated for multiple windows)
        const appCount = headers.get("X-App-Rate-Limit-Count");
        const appLimit = headers.get("X-App-Rate-Limit");
        // ... parse pairs, update bucket ...
    }
}
```

`RiotClient.fetch` becomes:
```js
await this.rateLimiter.waitFor(region, method);
const res = await fetch(url, { headers: { "X-Riot-Token": this.apiKey } });
this.rateLimiter.track(region, method, res.headers);
```

### Fix the broken ETA

`src/application/crawler.js:303`:
```js
const etaSeconds = matchesRemaining * 9.5;  // ← WRONG
```
Actual rate is **4.7 s/match** (40 matches per 188 s cycle). ETA today
is overestimated by ~2×. Replace the magic number with:
```js
const SECONDS_PER_MATCH = (CRAWLER.MAX_REQUESTS_PER_CYCLE * (API.SAFE_DELAY_MS / 1000)
                          + CRAWLER.PAUSE_MS_BETWEEN_CYCLES / 1000)
                         / CRAWLER.MAX_REQUESTS_PER_CYCLE;
const etaSeconds = matchesRemaining * SECONDS_PER_MATCH;
```

### Daily budget cap (new)

Add to `config/constants.js`:
```js
DAILY_REQUEST_BUDGET: 10_000,  // dev key practical ceiling
```
RiotClient tracks daily usage in `data/api-budget.json`. When 90% used,
warn; when 100% used, refuse to make more requests. This protects you
from accidentally exhausting your key with a bug.

---

## 29. The fallback chain (§22) doubles your request budget — fix it

### Problem
A naive read of §22 says: "Try ddragon-live, if that fails try
ddragon-mirror, if that fails try cdragon, if that fails try local
snapshot." If the primary returns *technically valid garbage* and the
validator (§23) rejects it, we then try the next source — that's a
**second** request for the same data. Across 170 champions, on a bad
patch day, this multiplies the request count.

### Proposed: tiered fallback budgets

Apply two rules to the cascade:

1. **Cache the upstream choice for the run.** Once `ddragon-live` is
   chosen for a sync, stick with it. Don't re-evaluate per record. The
   fallback is per-*run*, not per-record.

2. **Health-check first.** Before iterating a list of 170 champions
   through `ddragon-live`, do **one** lightweight probe (the realm
   endpoint). If the probe succeeds and the validator likes it, commit
   the run to that source. If the probe fails or the data is invalid,
   move to the next source for this run. Only one probe per source.

```js
async function chooseSource(key, version) {
    for (const source of SOURCES[key]) {
        try {
            const probe = await source.probe(version); // small, cheap call
            if (validate(key, probe)) {
                return source;
            }
        } catch (e) { /* try next */ }
    }
    throw new Error("No upstream source available");
}
```

3. **`local-snapshot` is free** — no budget concern, can be tried last
   without limit.

### Benefit
- Fallback never multiplies the per-record fetch count.
- Worst case: 1 extra probe per failed primary source (≤4 probes per
  run, regardless of dataset size).

---

## 30. Firestore document-size and write-rate compliance

### Published limits

| Limit | Value |
|---|---|
| Document size | **1 MiB (1,048,576 bytes)** |
| Writes per second per document | **1 sustained** (bursts OK) |
| Writes per batched commit | **500 operations** |
| Batched commit total size | **~10 MiB** |
| Array element addition (`arrayUnion`) | constrained by doc size |
| Field name length | 1,500 bytes |

### Current code vs. limits

| Doc | Approx size today | Limit | Risk |
|---|---|---|---|
| `data/champion_list` | ~50 KB | 1 MiB | safe |
| `data/champion_details` | **600 KB–950 KB** | 1 MiB | **at risk** as patches add abilities/items |
| `data/champion_meta` | ~200 KB | 1 MiB | safe |
| `data/champion_rating` | ~30 KB | 1 MiB | safe |
| `data/champion_drafting` | **400–700 KB** | 1 MiB | **at risk** |
| `data/item_list` | ~150 KB | 1 MiB | safe |
| `data/rune_trees` | ~25 KB | 1 MiB | safe |
| `system_metadata/crawler_state.seenMatches` | grows ~22 bytes/ID × 50,000 = **~1.1 MB** | 1 MiB | **will fail silently as it grows** |

`champion_drafting` already concerned me in §5; `champion_details` and
`seenMatches` are also in the danger zone.

### Proposed: hard write-time guard

A single helper called by every uploader:

```js
// src/infrastructure/output/firestore-guard.js
const MAX_DOC_BYTES = 1_048_487;   // 1 MiB minus safety margin
const WARN_DOC_BYTES = 900_000;

function assertDocSize(docName, payload) {
    const json = typeof payload === "string" ? payload : JSON.stringify(payload);
    const bytes = Buffer.byteLength(json, "utf8");
    if (bytes > MAX_DOC_BYTES) {
        throw new Error(
            `Document "${docName}" is ${bytes} bytes, exceeds Firestore 1 MiB cap. Shard or compress.`
        );
    }
    if (bytes > WARN_DOC_BYTES) {
        Logger.warn(`Document "${docName}" is ${(bytes/1024).toFixed(1)} KB — within 12% of cap`);
    }
    return bytes;
}
```

Every `uploadX` in `src/infrastructure/output/firebase-storage.js` wraps the payload with
`assertDocSize` before the batch.

### Sharding strategy when caps are exceeded

For the at-risk docs:

#### A. `champion_details` — shard by champion

Today: one giant doc with a `json: "[<all champions>]"` array.

Proposed:
```
data/champion_details_v{N}/index           { ids: ["Aatrox","Ahri",…] }
data/champion_details_v{N}/<championId>    { json: "<single champion>" }
```

Single-champion docs are ~3–6 KB each. Reading one champion costs the
client one read instead of downloading 600 KB.

#### B. `champion_drafting` — same pattern

Today already in the danger zone.

#### C. `seenMatches` — bucket by month

Today:
```
system_metadata/crawler_state { seenMatches: [...50k IDs...] }
```

Proposed:
```
crawler_seen/2026-04   { ids: [...] }      ← current month
crawler_seen/2026-03   { ids: [...] }
crawler_seen/2026-02   { ids: [...] }      ← prunable
```

`MatchRegistry.markSeen` writes to the current month bucket only.
`loadSeen` reads the most recent N buckets (e.g. last 3 months) — older
matches won't reappear in fresh crawls anyway.

This also keeps individual writes cheap: appending to a 200 KB doc is
faster than appending to a 950 KB doc, and the per-document write-rate
limit (1/s) becomes a non-issue because writes are spread.

### Write-rate compliance

The 1-write-per-second-per-document limit matters most for the
`crawler_state.seenMatches` doc — `markSeen()` is called every cycle
(every ~3 minutes), so we're well under 1/s. Safe today.

But the proposed §3 auto-publish can fire close to other uploads if a
team-crawl finishes simultaneously across laptops. **Per the
upload-lock idea in §11**, only one publisher runs at a time, so
write-rate stays well below 1/s per doc. Confirmed safe.

### Batch-size compliance

§24 publish writes 5 data docs + 1 revision doc + 1 index flip = **7
writes**. Well under the 500-per-batch cap. Total payload (sum of all
JSON strings) needs to stay under 10 MiB; current totals are ~1.5 MB
combined. Safe.

If `champion_details` is sharded into 170 docs (option A above), the
batch size becomes 170 + extras = ~175 writes. Still under 500. Safe.
If we ever cross 500 writes per publish, split into multiple batches —
**per Firestore rules, separate batches are not atomic**, so all writes
must go to v{N+1} paths and only the final index flip commits the
publish.

---

## 31. Crawler state files (`crawl.db` / state JSONs)

> The user mentioned `crawl.db` — there is no SQLite database in the
> codebase. The crawler's persistent state today is stored in **JSON
> files** under `data/`. This section audits those.

### Current state files

| File | Purpose | Size growth |
|---|---|---|
| `data/crawlerState.json` | rank index + match count | constant ~100 bytes |
| `data/globalSeenMatches.json` | local mirror of seen IDs | grows linearly with matches crawled |
| `data/<TIER>/<DIV>/matchStore.json` | full match objects | **~10 KB/match × 100 matches = ~1 MB per rank** |
| `data/<TIER>/<DIV>/timelines.json` | full timeline frames | **~50–100 KB/match × 100 = ~5–10 MB per rank** |
| `data/<TIER>/<DIV>/pageState.json` | crawler page cursor | constant <200 bytes |
| `data/<TIER>/<DIV>/ranking.json` | per-rank analytics output | ~50 KB |

After a full ladder crawl (31 ranks × 100 matches):
```
matchStore.json     31 × 1 MB    = ~31 MB
timelines.json      31 × ~7.5 MB = ~230 MB
ranking.json        31 × 50 KB   = ~1.5 MB
seenMatches local   ~70 KB
```

So full crawl state is **~265 MB on disk**. Manageable but not tiny.

### Issues at scale

1. **Whole-file rewrites on hot path** (already noted in §9).
   `timelines.json` for a hot rank is rewritten *each cycle* even though
   only a few match entries were appended. JSON.stringify on a 7.5 MB
   object then writeFile — that's expensive, repeated dozens of times
   per rank.

2. **JSON parsing on aggregate.** `mergeAll` reads + parses every
   `timelines.json` (31 × 7.5 MB = ~230 MB of JSON parsing) on every
   call. Combined with §17 ("mergeAll runs every rank flip") this is
   slow.

3. **No schema versioning.** If we change the shape of
   `crawlerState.json`, old files crash the crawler. Need a `version`
   field and a migration step.

4. **Concurrent writes.** Two laptops on the same shared folder (rare
   but possible) would race. `data/<TIER>/<DIV>/` is per-laptop today;
   document this constraint in `STANDARDS.md`.

5. **No crash recovery.** If the process is killed mid-`writeFile`,
   the JSON file may be truncated and unparseable. `readJson` returns
   `fallback`, silently losing all crawled matches.

### Proposed fixes

#### A. Atomic writes

Replace `writeFile` with write-to-temp-then-rename:
```js
async function writeJson(filePath, data) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = filePath + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(tmp, filePath);  // atomic on the same volume
}
```

If the process dies between writeFile and rename, the original file is
intact. After rename, you have the new data or you have the old. Never
a corrupt half-written file.

#### B. NDJSON for append-heavy files (already in §9)

`matchStore.json` and `timelines.json` are append-only. NDJSON makes
append O(1) instead of O(filesize):

```
data/<TIER>/<DIV>/matches.ndjson
data/<TIER>/<DIV>/timelines.ndjson
```

`fs.appendFile` is dramatically cheaper than rewrite-whole-file as size
grows.

#### C. Optional: SQLite (if the user really wants `crawl.db`)

If you actually want a single `crawl.db`, **SQLite is a great fit** for
this workload:

```
data/crawl.db
├── matches            (rank, tier, division, matchId TEXT PRIMARY KEY, payload JSON, createdAt)
├── timelines          (matchId TEXT PRIMARY KEY, payload JSON)
├── seen_matches       (matchId TEXT PRIMARY KEY, seenAt)
└── crawler_state      (key TEXT PRIMARY KEY, value JSON)
```

Pros:
- Single file (easy to back up, ship, version).
- No more whole-file rewrites; row-level updates.
- Fast O(log n) lookup of "have we seen this match?" without loading
  the full set into memory.
- ACID — crash-safe.
- Can be queried ad-hoc without parsing JSON.

Cons:
- New dependency (`better-sqlite3` or `sqlite3`).
- Migration from existing JSON to DB needed once.
- Slightly more code than `readJson` / `writeJson`.

Recommended only if disk pressure or merge-perf becomes a real problem.
For now, NDJSON + atomic writes (A + B) is enough.

#### D. Schema version

Every state file gets a `_meta.version` field:
```json
{ "_meta": { "version": 2 }, "rankIndex": 12, "currentMatches": 47 }
```
On read, if the version mismatches, run a migration function. No more
silent crashes from older state.

#### E. State separation: ephemeral vs durable

Today everything lives in `data/`. Split:

```
data/cache/         # rebuildable from disk reads (assets, ranking.json)
data/state/         # crawler progress — must persist
data/snapshots/     # last-known-good upstream payloads
data/published/     # local mirror of Firebase (§26)
```

Cleaning rebuildable caches is then safe; clearing state is not. Today
nothing distinguishes them.

---

## 32. Putting compliance numbers into a single config

Avoid scattering magic numbers. Add to `config/constants.js`:

```js
const LIMITS = {
    riot: {
        devKey: { burst: 20, perSecond: 1, sustained: 100, perWindow: 120_000 },
        prodKey: { burst: 500, perSecond: 10, sustained: 30_000, perWindow: 600_000 },
        safetyMargin: 0.9,    // never use more than 90% of a bucket
        dailyBudget: 10_000,
    },
    firestore: {
        maxDocBytes: 1_048_487,
        warnDocBytes: 900_000,
        maxBatchOps: 500,
        maxBatchBytes: 10 * 1024 * 1024,
        writesPerSecPerDoc: 1,
    },
    storage: {
        maxNdjsonFileBytes: 50 * 1024 * 1024,  // rotate at 50 MB
        keepRevisionsLocal: 5,
        seenMatchBucketMonths: 3,
    },
};
```

Every helper that performs a budgeted action reads from `LIMITS`. One
place to bump numbers when keys are upgraded.

---

## 33. Compliance summary table

| Area | Current code | After proposed changes | Limit | Compliant? |
|---|---|---|---|---|
| Riot req/min | ~13 | ~13 (unchanged) | 50 (dev) | ✓ |
| Riot burst | ~0.3 req/s | ~0.3 req/s | 20 req/s | ✓ |
| Riot daily | unbounded | capped at 10k via §28 | none formally, but key practical | ✓ after §28 |
| Riot per-method | ignored | tracked via §28 RateLimiter | per-bucket | ✓ after §28 |
| `champion_details` size | ~700 KB | sharded to 170 × 5 KB | 1 MiB | ✓ after §30 |
| `champion_drafting` size | ~600 KB | sharded by champion | 1 MiB | ✓ after §30 |
| `seenMatches` array | growing toward 1 MiB | bucketed by month | 1 MiB | ✓ after §30 |
| Batch size (publish) | 4 ops | ~7 ops (versioned) or ~175 (sharded) | 500 ops | ✓ |
| Batch bytes | ~1.5 MB | ~1.5 MB | 10 MiB | ✓ |
| Writes/sec/doc | <<1 | <<1 (lock prevents concurrent) | 1 | ✓ |
| Crawler state corruption | possible (mid-write) | atomic (§31A) | n/a | ✓ after §31 |
| ETA accuracy | 2× overestimate | accurate | n/a | ✓ after §28 |

Everything is either compliant today or made compliant by an item
already in the plan — but the §28 rate-limiter, §29 fallback budget,
§30 doc-size guard, and §31 atomic writes need to ship before any
production rollout.

---

## Updated adoption priority (with Parts E and G)

| Priority | Item | Reason |
|---|---|---|
| **P0** | §16 per-iteration try/catch | Prevents whole-crawler crashes |
| **P0** | §17 mergeAll guarded / moved | Same |
| **P0** | §19 RiotClient retry-loop fallthrough | Silent data corruption |
| **P0** | §30 doc-size guard + sharding | Hits 1 MiB cap silently otherwise |
| **P0** | §6 patch tracking on tier data | Correctness |
| **P0** | §7 + §24 versioned publish + index | Mismatched data + foundation for rollback |
| **P0** | §25 rollback command | Recover from a bad publish in one write |
| **P0** | §23 validate before publish | Garbage never reaches Firebase |
| **P0** | §31A atomic state writes | Crash-safety for crawler state |
| P1 | §28 Riot rate-limiter (per-bucket) | Avoid 429s, daily budget cap |
| P1 | §28 fix ETA formula | Currently 2× overestimate |
| P1 | §29 fallback chain probe budget | Prevent fallback from doubling Riot calls |
| P1 | §22 multi-source fallback | Resilience to upstream outages |
| P1 | §14 `getJson` helper | Better errors, timeouts |
| P1 | §15 `Promise.allSettled` | Tolerance to transient errors |
| P1 | §3 auto-publish after crawl | UX |
| P1 | §1 unify entry points | UX |
| P1 | §11 safety rails | Production overwrite prevention |
| P1 | §21 STANDARDS.md + lint | Long-term codebase health |
| P1 | §27 status command | Operator visibility |
| P1 | §32 LIMITS config block | Single source of compliance constants |
| P2 | §13 folder reshape | Maintainability |
| P2 | §26 local snapshot mirroring | Disaster recovery |
| P2 | §4 cheaper aggregation | Performance |
| P2 | §9 / §31B NDJSON for matches/timelines | Hot-path I/O |
| P2 | §8 seen-matches compaction (monthly buckets) | Long-term scalability |
| P2 | §18 metadata async | Consistency |
| P2 | §31D state schema versioning | Safe future migrations |
| P2 | §31E ephemeral vs durable state split | Safe cache cleanup |
| P3 | §31C SQLite migration | Only if NDJSON becomes insufficient |
| P3 | §20 readline cleanup | Polish |
| P3 | §2 workflow nudges | Polish |
| P3 | §10 normalisation refactor | Maintainability |
| P3 | §12 run.bat tweaks | Polish |
