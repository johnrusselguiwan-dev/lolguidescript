# LoL Guide Script

Fetches and syncs League of Legends champion, item, and rune data from Riot's [Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon) API to Firebase or local JSON.

## Quick Start

```powershell
# 1. Install dependencies
npm install

# 2. Run interactively (choose data type + destination)
npm run sync

# 3. Or auto-sync everything to Firebase
npm run sync:auto
```

You can also use the batch file on Windows:
```powershell
.\run.bat
```

## Available Scripts

| Command           | Description                                        |
| ----------------- | -------------------------------------------------- |
| `npm run sync`    | Interactive mode — pick data & destination         |
| `npm run sync:auto` | Auto-sync all data to Firebase (CI-friendly)     |

## Project Structure

```
lolguidescript/
├── src/
│   ├── api/
│   │   └── ddragon.js            # Data Dragon HTTP client
│   ├── mappers/
│   │   ├── champion-details.js   # Raw → detail entry
│   │   ├── champion-list.js      # Detail → list entry
│   │   ├── items.js              # Raw → domain items
│   │   └── runes.js              # Raw → domain rune trees
│   ├── services/
│   │   ├── champions.js          # Fetch + process champions
│   │   ├── items.js              # Fetch + process items
│   │   └── runes.js              # Fetch + process runes
│   ├── output/
│   │   ├── firebase.js           # Upload to Firestore
│   │   └── local-export.js       # Export to JSON files
│   └── utils/
│       ├── cli.js                # Colors, menus, progress bar
│       ├── metadata.js           # Local champion metadata
│       └── parser.js             # HTML → clean text
├── scripts/
│   └── sync-master.js            # Main entry point
├── config/
│   └── firebase.js               # Firebase Admin SDK setup
├── assets/
│   └── champion_metadata.json    # Lanes, regions per champion
├── exports/                      # Local JSON output (gitignored)
├── index.js                      # Shim → scripts/sync-master.js
├── sync-dynamic.js               # Dynamic data sync (WIP)
└── run.bat                       # Windows launcher
```

## Architecture

```
  Data Dragon API
        │
        ▼
    src/api/          ← HTTP calls
        │
        ▼
    src/services/     ← Fetch + process (orchestration)
        │
        ├──► src/mappers/   ← Data transformation
        │
        ▼
    src/output/       ← Firebase upload or local JSON export
```

**Data flows top-down.** Services call the API, pass results through mappers, and hand off to output handlers. The `scripts/sync-master.js` orchestrator ties everything together.

## Adding New Data Types

To add a new data type (e.g., summoner spells):

1. **API** — Add a method in `src/api/ddragon.js`
2. **Mapper** — Create `src/mappers/summoner-spells.js`
3. **Service** — Create `src/services/summoner-spells.js`
4. **Output** — Add upload/export functions in `src/output/firebase.js` and `src/output/local-export.js`
5. **Menu** — Add option in `src/utils/cli.js` and wire it up in `scripts/sync-master.js`

## Environment Variables

| Variable                   | Description                              |
| -------------------------- | ---------------------------------------- |
| `FIREBASE_SERVICE_ACCOUNT` | JSON string of Firebase service account  |
| `AUTO_SYNC`                | Set to `"true"` to skip interactive menu |
| `NO_COLOR`                 | Set to disable ANSI terminal colors      |

## Key Files

- **`scripts/sync-master.js`** — Main orchestrator (start reading here)
- **`src/utils/cli.js`** — Terminal UI (menus, progress bar, colors)
- **`config/firebase.js`** — Firebase service account setup
- **`run.bat`** — Windows wrapper that runs `npm install` if needed then starts the script
