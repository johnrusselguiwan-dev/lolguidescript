# LoL Guide Script

Fetches and syncs League of Legends champion, item, and rune data from Riot's [Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon) API to Firebase or local JSON — plus an autonomous ranked-data crawler with distributed multi-laptop support, interactive draft simulator, and a Hextech React Dashboard for visual management.

## Quick Start

```powershell
# 1. Install dependencies
npm install
cd hextech-dashboard && npm install && cd ..

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

## Master Control Panel

When you run `npm run crawl` or `.\run.bat`, you get the interactive Master Control Panel:

```text
  ╔══════════════════════════════════════════════════════╗
  ║         LoL Guide  ·  Master Control Panel         ║
  ╚══════════════════════════════════════════════════════╝

  Data Collection (For Everyone)
    [1]  🔄 Start Crawling         (Fetch live match data)
    [2]  📤 Export Data for Team   (Share your crawled matches with the Master)

  Data Processing (For Master Laptop)
    [3]  📥 Import Team Data       (Load matches shared by a coworker)
    [4]  📦 Aggregate Data         (Combine matches into champion stats)
    [5]  🚀 Publish to App         (Upload aggregated stats to Firebase)
    [6]  🗄️  Sync Static Assets    (Update base champions, items, runes)
    [7]  💠 Start Hextech Dashboard(React-based League UI)

    [0]  ❌ Exit
```

### [1] Start Crawling
Starts the data crawler. You can pick Solo Mode (crawl all 31 divisions) or Team Worker (split divisions). Laptops share a Firebase log to **prevent duplicate fetches**.

### [2] Export & [3] Import
`[2]` exports a worker's local database to the Desktop so they can share it (via Slack/Drive).
The Master Laptop uses `[3]` to ingest those files without duplicating any matches.

### [4] Aggregate Data
Combines the raw SQLite Database into statistical models (`CHAMPION_META.json`, `CHAMPION_RATING.json`, `CHAMPION_DRAFTING.json`, `CHAMPION_SCALING.json`).

### [5] Publish & [6] Sync
`[5]` deploys these newly updated stat structures directly into Firestore and auto-bumps Remote Config version fields.
`[6]` patches your database with any newly released Riot static assets (champ icons, rune data, etc.).

### [7] Hextech Dashboard
Launches a React-based web interface built with [react-hextech](https://www.npmjs.com/package/react-hextech) (League of Legends UI components). The dashboard provides:
- **API Key Management** — update your `.env` Riot API key from the browser
- **Crawler Controls** — start/stop crawling with live progress tracking
- **Data Processing** — trigger aggregation, publish, and asset sync
- **System Logs** — live log viewer with auto-scroll

The backend Express API runs on port `3000` and the Vite dev server on port `5173` with a proxy for `/api` routes.

### Crawler Controls (during crawl)
| Key       | Action          |
|-----------|-----------------|
| `P` | Pause / Resume |
| `R`       | Restart from Iron IV |
| `Q` / `Ctrl+C` | Quit safely |

## Output Files

The crawler generates four output files:

| File | Contents | Firestore Doc |
|------|----------|---------------|
| `CHAMPION_META.json` | Full champion data: builds, runes, spells, skill order, rates, matchups (top 10) | `data/champion_meta` |
| `CHAMPION_RATING.json` | Slim rates only: win/pick/ban rate, icon, lane, role | `data/champion_rating` |
| `CHAMPION_DRAFTING.json` | Full untrimmed matchup data for draft master feature | `data/champion_drafting` |
| `CHAMPION_SCALING.json` | Per-champion win rates by game duration (power spikes) | `data/champion_scaling` |

## Recommended Workflow

```text
Step 1: Everyone runs [1] Start Crawling (Team Worker mode) in the Master Control Panel.

Step 2: Workers run [2] Export Data. They send their database to the Master.

Step 3: Master runs [3] Import Team Data on all worker files.

Step 4: Master runs [4] Aggregate Data to compute final stats.

Step 5: Master runs [5] Publish to App to send updates to Firebase.
```

Running `npm run sync` after crawling will enrich `champion_details` in Firebase with real win/pick/ban rates, recommended builds, runes, skill order, and matchup data from the crawler.

## Project Structure

```
lolguidescript/
├── src/
│   ├── domain/                     # Enterprise Business Rules
│   │   ├── mappers/                # Data transformation handlers
│   │   │   ├── champion-details.js 
│   │   │   ├── champion-list.js    
│   │   │   ├── items.js            
│   │   │   ├── runes.js            
│   │   │   └── spells.js           
│   │   └── parser.js               # HTML → clean text
│   ├── application/                # Application Use Cases
│   │   ├── champions.js            
│   │   ├── items.js                
│   │   ├── runes.js                
│   │   ├── spells.js               
│   │   ├── analytics.js            # Match analysis engine
│   │   ├── asset-manager.js        # DDragon asset cache
│   │   ├── static-data.js          
│   │   ├── aggregator.js           # Global rank merge
│   │   ├── import-manager.js       # DB export/import for team sharing
│   │   ├── crawler.js              # Ranked crawler use case
│   │   └── sync-master.js          # DDragon sync orchestrator
│   ├── infrastructure/             # Frameworks and External Drivers
│   │   ├── api/
│   │   │   ├── ddragon.js          # Data Dragon CDN client
│   │   │   ├── cdragon.js          # Community Dragon client
│   │   │   └── riot-client.js      # Rate-limited Riot API client
│   │   ├── database/
│   │   │   ├── sqlite-client.js    # Local SQLite storage
│   │   │   └── firebase-firestore.js # Cloud match dedup registry
│   │   ├── output/
│   │   │   ├── firebase-storage.js # Firestore upload
│   │   │   ├── local-export.js     # Local JSON export
│   │   │   └── remote-config.js    # Firebase Remote Config versioning
│   │   └── utils/
│   │       ├── io.js               # JSON file I/O
│   │       ├── logger.js           # Colored, buffered logger
│   │       ├── metadata.js         # Champion metadata loader
│   │       └── sleep.js            # Async delay
│   └── presentation/               # Interface Adapters
│       ├── cli-utils.js            # CLI menus, progress bars, colors
│       ├── web-server.js           # Express server bootstrap
│       └── api-routes.js           # REST API route handlers
├── hextech-dashboard/              # React Web Dashboard (Vite)
│   ├── src/
│   │   ├── components/
│   │   │   ├── Sidebar.jsx         # Navigation sidebar
│   │   │   ├── ApiKeyForm.jsx      # API key management
│   │   │   ├── CrawlerPanel.jsx    # Crawler controls + progress
│   │   │   ├── ProcessingPanel.jsx # Aggregate/Publish/Sync cards
│   │   │   └── LogViewer.jsx       # Auto-scrolling system logs
│   │   ├── hooks/
│   │   │   └── useApi.js           # Shared fetch helpers
│   │   ├── App.jsx                 # Root component (composition)
│   │   ├── App.css                 # Hextech-themed styles
│   │   └── main.jsx                # Vite entry point
│   ├── vite.config.js              # Vite config with API proxy
│   └── package.json
├── config/
│   ├── firebase.js                 # Firebase Admin SDK setup
│   ├── constants.js                # All config constants & rank hierarchy
│   └── .env.example                # Environment variable template
├── assets/
│   └── champion_metadata.json      # Lanes, regions, prices, playstyle per champion
├── scripts/
│   └── draft.js                    # Interactive draft pick simulator
├── .github/workflows/
│   └── sync.yml                    # Scheduled CI sync to Firebase
├── data/                           # Crawler output data (gitignored)
├── index.js                        # CLI Entry Point
├── run.bat                         # Windows launcher
└── package.json
```

## Architecture

### DDragon Sync Pipeline

```
  Data Dragon API
        │
        ▼
    src/infrastructure/api/ddragon.js  ← HTTP calls
        │
        ▼
    src/application/                   ← Fetch + process (orchestration)
        │
        ├──► src/domain/mappers/       ← Data transformation
        │
        ▼
    src/infrastructure/output/         ← Firebase upload or local JSON export
```

**Data flows top-down.** Application Use Cases call the API, pass results through domain mappers, and hand off to infrastructure output handlers. The `src/application/sync-master.js` orchestrator ties everything together.

When processing champions, the service loads `CHAMPION_META.json` (if available) and passes real crawled stats into each champion's detail entry — replacing placeholder values with actual win/pick/ban rates, builds, runes, skill order, and matchup data.

### Crawler Pipeline

```
  Riot Ranked API
        │
        ▼
    src/infrastructure/api/riot-client.js                ← Rate-limited API client
        │
        ├──► src/application/asset-manager.js            ← DDragon asset cache
        ├──► src/infrastructure/database/firebase-firestore.js ← Firebase match dedup
        │
        ▼
    src/application/analytics.js                         ← Match analysis engine
        │
        ▼
    src/application/aggregator.js                        ← Global rank merge (4 outputs)
        │
        ├──► data/CHAMPION_META.json
        ├──► data/CHAMPION_RATING.json
        ├──► data/CHAMPION_DRAFTING.json
        ├──► data/CHAMPION_SCALING.json
        │
        ▼
    src/infrastructure/output/firebase-storage.js        ← Upload to Firestore
```

The `src/application/crawler.js` orchestrator controls the crawl loop, CLI menu, team crawl partitioning, and state persistence. It composes RiotClient, AssetManager, AnalyticsEngine, GlobalAggregator, and MatchRegistry.

### Hextech Dashboard Architecture

```
  Browser (localhost:5173)
        │
        ▼
    hextech-dashboard/src/App.jsx          ← React composition root
        │
        ├──► components/Sidebar.jsx        ← Navigation
        ├──► components/ApiKeyForm.jsx     ← Settings
        ├──► components/CrawlerPanel.jsx   ← Data collection
        ├──► components/ProcessingPanel.jsx← Data processing
        ├──► components/LogViewer.jsx      ← Live logs
        │
        ▼
    hooks/useApi.js → /api proxy           ← Vite dev proxy
        │
        ▼
    src/presentation/web-server.js         ← Express bootstrap (port 3000)
        │
        ▼
    src/presentation/api-routes.js         ← REST route handlers
        │
        ├──► /api/status, /api/logs
        ├──► /api/settings/apikey
        ├──► /api/action/crawl/start|stop
        ├──► /api/action/aggregate
        ├──► /api/action/publish
        └──► /api/action/sync-assets
```

## Firestore Document Map

| Collection | Document | Contents |
|---|---|---|
| `data` | `champion_list` | Champion list entries (name, icon, lanes) |
| `data` | `champion_details` | Full champion details (skills, stats, builds, rates, matchups) |
| `data` | `champion_meta` | Crawler tier list data (all champions ranked by score) |
| `data` | `champion_rating` | Slim win/pick/ban rates for tier list screens |
| `data` | `champion_drafting` | Full matchup data for draft master feature |
| `data` | `champion_scaling` | Per-champion power spike data by game duration |
| `data` | `item_list` | All items with stats and descriptions |
| `data` | `rune_trees` | All rune trees and individual runes |
| `data` | `summoner_spells` | All summoner spells |
| `system_metadata` | `patch_info` | Current patch version and last update timestamp |
| `system_metadata` | `crawler_state` | Shared seen match IDs for distributed dedup |

## Adding New Data Types

To add a new data type (e.g., summoner spells):

1. **API** — Add a method in `src/infrastructure/api/ddragon.js`
2. **Mapper** — Create `src/domain/mappers/summoner-spells.js`
3. **Use Case** — Create `src/application/summoner-spells.js`
4. **Output** — Add upload/export functions in `src/infrastructure/output/firebase-storage.js` and `src/infrastructure/output/local-export.js`
5. **Menu** — Add option in `src/presentation/cli-utils.js` and wire it up in `src/application/sync-master.js`
6. **Dashboard** — (Optional) Add a new component in `hextech-dashboard/src/components/` and an API route in `src/presentation/api-routes.js`

## Environment Variables

| Variable                   | Required | Description                              |
| -------------------------- | -------- | ---------------------------------------- |
| `RIOT_API_KEY`             | Crawler  | Riot Games API key for ranked data       |
| `FIREBASE_SERVICE_ACCOUNT` | Sync     | JSON string of Firebase service account  |
| `AUTO_SYNC`                | No       | Set to `"true"` to skip interactive menu |
| `NO_COLOR`                 | No       | Set to disable ANSI terminal colors      |

## Key Files

- **`src/application/sync-master.js`** — DDragon sync orchestrator (start reading here)
- **`src/application/crawler.js`** — Ranked crawler with interactive menu and team worker support
- **`src/presentation/api-routes.js`** — REST API for the Hextech Dashboard
- **`hextech-dashboard/src/App.jsx`** — React dashboard composition root
- **`scripts/draft.js`** — Interactive draft pick simulator
- **`config/constants.js`** — All configuration constants in one place
- **`src/infrastructure/database/firebase-firestore.js`** — Firebase-based match dedup for distributed crawling
- **`src/presentation/cli-utils.js`** — Terminal UI (menus, progress bar, colors)
- **`config/firebase.js`** — Firebase service account setup
