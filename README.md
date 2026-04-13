# LoL Guide Script

This script handles fetching and processing League of Legends champion data from Riot's Data Dragon API.

## How to Run

1. Open the terminal in VS Code (`Ctrl + Shift + ~`).
2. Run the batch script:
   ```powershell
   .\run.bat
   ```

## What it Does

- **Fetch**: Gets the latest patch version and champion list from Data Dragon.
- **Process**: Downloads full details for each champion in chunks and merges them with local data from `assets/champion_metadata.json`.
- **Map**: Converts the raw JSON into two simplified formats (`listEntry` and `detailEntry`).
- **Output**: 
  - **Firebase**: Uploads a batched JSON string to Firestore.
  - **Local**: Exports the JSON files to the `exports/` folder.

## Key Files
- `index.js`: Main logic (fetch, map, upload/export).
- `mappers/`: Restructures the API data.
- `config/firebase.js`: Service account setup for Firestore.
- `run.bat`: Simple wrapper that run `npm install` if needed then starts `index.js`.

