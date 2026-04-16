# LoL Guide Script

Fetches and syncs League of Legends champion, item, and rune data from Riot's [Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon) API to Firebase or local JSON — plus an autonomous ranked-data crawler with distributed multi-laptop support and interactive draft simulator.

## Quick Start

```powershell
# 1. Install dependencies
npm install

# 2. Copy the env template and fill in your keys
cp config/.env.example .env

# 3. Run interactively (choose data type + destination)
npm run sync

# 4. Or auto-sync everything to Firebase
npm run sync:auto
```

You can also use the batch file on Windows:
```powershell
.\run.bat
```

## Available Scripts

| Command            | Description                                             |
| ------------------ | ------------------------------------------------------- |
| `npm run sync`     | Interactive mode — pick data & destination              |
| `npm run sync:auto`| Auto-sync all data to Firebase (CI-friendly)            |
| `npm run crawl`    | Ranked match crawler with interactive menu              |
| `npm run draft`    | Interactive draft simulator using crawled data          |

## Crawler Menu

When you run `npm run crawl`, you get an interactive menu:

```
╔════════════════════════════════════════════════╗
║       LoL Guide  ·  Data Crawler              ║
╚════════════════════════════════════════════════╝

  [1]  🔄 Solo Crawl        (all ranks, single machine)
  [2]  👥 Team Crawl        (split ranks across laptops)
  [3]  📦 Merge & Upload    (combine data + push to Firebase)
  [4]  📊 Upload Only       (push existing data to Firebase)
  [5]  🗄️  Static Data       (fetch items & runes mappings)
```

### Solo Crawl
Crawls all 31 rank divisions (Iron IV → Challenger) on a single machine.

### Team Crawl (Distributed)
Split the workload across multiple laptops. Each laptop crawls a different slice of ranks:

```
Laptop 1: npm run crawl → [2] → 3 laptops → laptop 1 → crawls Iron–Silver
Laptop 2: npm run crawl → [2] → 3 laptops → laptop 2 → crawls Gold–Emerald
Laptop 3: npm run crawl → [2] → 3 laptops → laptop 3 → crawls Diamond–Challenger
```

All laptops share seen match IDs via Firebase to **prevent duplicate fetches**.

### Merge & Upload
After all laptops finish, copy their `data/` folders into one machine, then run option `[3]` to:
1. Combine all rank data into a unified dataset
2. Generate `CHAMPION_META.json`, `CHAMPION_RATING.json`, `CHAMPION_DRAFTING.json`
3. Upload all three to Firebase

### Crawler Controls (during crawl)
| Key       | Action          |
|-----------|-----------------|
| `P` / `Space` | Pause / Resume |
| `R`       | Restart from Iron IV |
| `Q` / `Ctrl+C` | Quit safely |

## Output Files

The crawler generates three output files:

| File | Contents | Firestore Doc |
|------|----------|---------------|
| `CHAMPION_META.json` | Full champion data: builds, runes, spells, skill order, rates, matchups (top 10) | `data/champion_meta` |
| `CHAMPION_RATING.json` | Slim rates only: win/pick/ban rate, icon, lane, role | `data/champion_rating` |
| `CHAMPION_DRAFTING.json` | Full untrimmed matchup data for draft master feature | `data/champion_drafting` |

## Recommended Workflow

```
Step 1:  npm run crawl → [1] Solo  or  [2] Team
         (crawl ranked match data from Riot API)

Step 2:  npm run crawl → [3] Merge & Upload
         (combine all rank data + push to Firebase)

Step 3:  npm run sync
         (sync static champion data WITH real rates/builds/runes from Step 2)
```

Running `npm run sync` after crawling will enrich `champion_details` in Firebase with real win/pick/ban rates, recommended builds, runes, skill order, and matchup data from the crawler.

## Project Structure

```
lolguidescript/
├── src/
│   ├── api/
│   │   ├── ddragon.js              # Data Dragon HTTP client
│   │   └── riot-client.js          # Riot API client (rate-limited, retry)
│   ├── mappers/
│   │   ├── champion-details.js     # Raw → detail entry (enriched with crawler data)
│   │   ├── champion-list.js        # Detail → list entry
│   │   ├── items.js                # Raw → domain items
│   │   ├── runes.js                # Raw → domain rune trees
│   │   └── spells.js               # Raw → domain summoner spells
│   ├── services/
│   │   ├── champions.js            # Fetch + process champions (loads CHAMPION_META)
│   │   ├── items.js                # Fetch + process items
│   │   ├── runes.js                # Fetch + process runes
│   │   ├── spells.js               # Fetch + process summoner spells
│   │   ├── analytics.js            # Match analysis & stat formatting
│   │   ├── asset-manager.js        # DDragon asset fetch & cache
│   │   ├── static-data.js          # Items & runes extraction (Kotlin-matching)
│   │   ├── aggregator.js           # Global rank data merge (3 outputs)
│   │   └── match-registry.js       # Firebase match dedup (arrayUnion)
│   ├── output/
│   │   ├── firebase.js             # Upload to Firestore (includes tier data)
│   │   └── local-export.js         # Export to JSON files
│   └── utils/
│       ├── cli.js                  # Colors, menus, progress bar
│       ├── metadata.js             # Local champion metadata
│       ├── parser.js               # HTML → clean text
│       ├── logger.js               # Colored timestamped logger
│       ├── io.js                   # JSON file read/write helpers
│       └── sleep.js                # Async delay utility
├── scripts/
│   ├── sync-master.js              # DDragon sync orchestrator
│   ├── crawl.js                    # Ranked crawler with interactive menu
│   └── draft.js                    # Interactive draft simulator
├── config/
│   ├── firebase.js                 # Firebase Admin SDK setup
│   ├── constants.js                # All config constants & rank hierarchy
│   └── .env.example                # Environment variable template
├── assets/
│   └── champion_metadata.json      # Lanes, regions per champion
├── .github/workflows/
│   └── sync.yml                    # Scheduled CI sync to Firebase
├── exports/                        # Local JSON output (gitignored)
├── data/                           # Crawler output data (gitignored)
├── index.js                        # Shim → scripts/sync-master.js
├── run.bat                         # Windows launcher
└── package.json
```

## Architecture

### DDragon Sync Pipeline

```
  Data Dragon API
        │
        ▼
    src/api/ddragon.js       ← HTTP calls
        │
        ▼
    src/services/            ← Fetch + process (orchestration)
        │
        ├──► src/mappers/    ← Data transformation
        │
        ▼
    src/output/              ← Firebase upload or local JSON export
```

**Data flows top-down.** Services call the API, pass results through mappers, and hand off to output handlers. The `scripts/sync-master.js` orchestrator ties everything together.

When processing champions, the service loads `CHAMPION_META.json` (if available) and passes real crawled stats into each champion's detail entry — replacing placeholder values with actual win/pick/ban rates, builds, runes, skill order, and matchup data.

### Crawler Pipeline

```
  Riot Ranked API
        │
        ▼
    src/api/riot-client.js           ← Rate-limited API client
        │
        ├──► src/services/asset-manager.js     ← DDragon asset cache
        ├──► src/services/match-registry.js    ← Firebase match dedup
        │
        ▼
    src/services/analytics.js        ← Match analysis engine
        │
        ▼
    src/services/aggregator.js       ← Global rank merge (3 outputs)
        │
        ├──► data/CHAMPION_META.json
        ├──► data/CHAMPION_RATING.json
        ├──► data/CHAMPION_DRAFTING.json
        │
        ▼
    src/output/firebase.js           ← Upload to Firestore
```

The `scripts/crawl.js` orchestrator controls the crawl loop, CLI menu, team crawl partitioning, and state persistence. It composes RiotClient, AssetManager, AnalyticsEngine, GlobalAggregator, and MatchRegistry.

## Firestore Document Map

| Collection | Document | Contents |
|---|---|---|
| `data` | `champion_list` | Champion list entries (name, icon, lanes) |
| `data` | `champion_details` | Full champion details (skills, stats, builds, rates, matchups) |
| `data` | `champion_meta` | Crawler tier list data (all champions ranked by score) |
| `data` | `champion_rating` | Slim win/pick/ban rates for tier list screens |
| `data` | `champion_drafting` | Full matchup data for draft master feature |
| `data` | `item_list` | All items with stats and descriptions |
| `data` | `rune_trees` | All rune trees and individual runes |
| `data` | `summoner_spells` | All summoner spells |
| `system_metadata` | `patch_info` | Current patch version and last update timestamp |
| `system_metadata` | `crawler_state` | Shared seen match IDs for distributed dedup |

## Adding New Data Types

To add a new data type (e.g., summoner spells):

1. **API** — Add a method in `src/api/ddragon.js`
2. **Mapper** — Create `src/mappers/summoner-spells.js`
3. **Service** — Create `src/services/summoner-spells.js`
4. **Output** — Add upload/export functions in `src/output/firebase.js` and `src/output/local-export.js`
5. **Menu** — Add option in `src/utils/cli.js` and wire it up in `scripts/sync-master.js`

## Environment Variables

| Variable                   | Required | Description                              |
| -------------------------- | -------- | ---------------------------------------- |
| `RIOT_API_KEY`             | Crawler  | Riot Games API key for ranked data       |
| `FIREBASE_SERVICE_ACCOUNT` | Sync     | JSON string of Firebase service account  |
| `AUTO_SYNC`                | No       | Set to `"true"` to skip interactive menu |
| `NO_COLOR`                 | No       | Set to disable ANSI terminal colors      |

## Key Files

- **`scripts/sync-master.js`** — DDragon sync orchestrator (start reading here)
- **`scripts/crawl.js`** — Ranked crawler with interactive 5-option menu
- **`scripts/draft.js`** — Interactive draft pick simulator
- **`config/constants.js`** — All configuration constants in one place
- **`src/services/match-registry.js`** — Firebase-based match dedup for distributed crawling
- **`src/utils/cli.js`** — Terminal UI (menus, progress bar, colors)
- **`config/firebase.js`** — Firebase service account setup
