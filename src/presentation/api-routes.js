/**
 * API Routes — Express Router for all backend endpoints consumed
 * by the Hextech React Dashboard.
 *
 * Handles crawler control, data aggregation, publishing, asset sync,
 * system logs, API key management, and team data export/import.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs/promises');
const multer = require('multer');
const { spawn } = require('child_process');
const Crawler = require('../application/crawler');
const GlobalAggregator = require('../application/aggregator');
const ImportManager = require('../application/import-manager');
const { uploadTierData } = require('../infrastructure/output/firebase-storage');
const { incrementVersionFields } = require('../infrastructure/output/remote-config');
const { readJson } = require('../infrastructure/utils/io');
const Database = require('../infrastructure/database/sqlite-client');
const { STORAGE, RANK_HIERARCHY, API, getAllPlatforms } = require('../../config/constants');
const Logger = require('../infrastructure/utils/logger');

const router = express.Router();

// Keep track of crawler state
let activeCrawler = null;

// ── Multer config for .db file uploads ───────────────────────────────────────

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            fs.mkdirSync(STORAGE.IMPORT, { recursive: true });
            cb(null, STORAGE.IMPORT);
        },
        filename: (req, file, cb) => {
            // Preserve original filename, but ensure .db extension
            const name = file.originalname.endsWith('.db')
                ? file.originalname
                : `${file.originalname}.db`;
            cb(null, name);
        }
    }),
    fileFilter: (req, file, cb) => {
        if (file.originalname.endsWith('.db')) {
            cb(null, true);
        } else {
            cb(new Error('Only .db files are accepted'), false);
        }
    },
    limits: {
        fileSize: 5 * 1024 * 1024 * 1024 // 5GB max
    }
});

// ── Status & Logs ────────────────────────────────────────────────────────────

router.get('/status', async (req, res) => {
    try {
        const state = await readJson(STORAGE.CRAWL_STATE, {});
        res.json({
            isRunning: !!activeCrawler,
            state: state
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/logs', (req, res) => {
    res.json(Logger.getLogs());
});

// ── Config (for Dashboard UI) ────────────────────────────────────────────────

router.get('/config/regions', (req, res) => {
    res.json({
        regions: API.REGIONS,
        ranks: RANK_HIERARCHY,
        allPlatforms: getAllPlatforms()
    });
});

// ── Settings ─────────────────────────────────────────────────────────────────

router.post('/settings/apikey', (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey) return res.status(400).json({ error: "Missing API Key" });

    try {
        const envPath = path.join(__dirname, '../../.env');
        let envContent = '';
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf8');
        }
        
        if (envContent.includes('RIOT_API_KEY=')) {
            envContent = envContent.replace(/RIOT_API_KEY=.*/g, `RIOT_API_KEY="${apiKey}"`);
        } else {
            envContent += `\nRIOT_API_KEY="${apiKey}"`;
        }
        
        fs.writeFileSync(envPath, envContent);
        
        // Reload dotenv in the current process
        require('dotenv').config({ path: envPath, override: true });
        
        Logger.success("RIOT_API_KEY has been updated via Hextech Dashboard.");
        res.json({ message: "API Key updated successfully" });
    } catch (e) {
        Logger.error("Failed to save API Key", e);
        res.status(500).json({ error: e.message });
    }
});

// ── Crawler Actions ──────────────────────────────────────────────────────────

router.post('/action/crawl/start', async (req, res) => {
    if (activeCrawler) {
        return res.status(400).json({ error: "Crawler is already running" });
    }

    try {
        const { rankStart = 0, rankEnd = RANK_HIERARCHY.length, region = 'all', strictPatch = true } = req.body || {};

        // Validate rank bounds
        const start = Math.max(0, Math.min(rankStart, RANK_HIERARCHY.length - 1));
        const end = Math.max(start + 1, Math.min(rankEnd, RANK_HIERARCHY.length));

        await Database.connect();
        activeCrawler = new Crawler();
        // Don't await here so it runs in background
        activeCrawler.startFromWeb(start, end, region, strictPatch).then(() => {
            activeCrawler = null;
        }).catch(err => {
            Logger.error("Crawler failed: " + err.message);
            activeCrawler = null;
        });
        
        const startRank = `${RANK_HIERARCHY[start].tier} ${RANK_HIERARCHY[start].division}`;
        const endRank = `${RANK_HIERARCHY[end - 1].tier} ${RANK_HIERARCHY[end - 1].division}`;
        const regionLabel = region === 'all' ? 'All Regions' : region;

        res.json({ message: `Crawler started: ${startRank} → ${endRank} | Region: ${regionLabel} | Patch: ${strictPatch ? 'Strict' : 'Lenient'}` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/action/crawl/stop', async (req, res) => {
    if (activeCrawler) {
        activeCrawler.isPaused = true;
        activeCrawler = null; 
        res.json({ message: "Crawler stopped/detached" });
    } else {
        res.status(400).json({ error: "Crawler is not running" });
    }
});

// ── Data Processing Actions ──────────────────────────────────────────────────

router.post('/action/aggregate', async (req, res) => {
    try {
        const { region = 'all' } = req.body || {};
        const regionLabel = region === 'all' ? 'Global' : region;
        Logger.info(`Aggregation requested for region: ${regionLabel}`);
        await GlobalAggregator.mergeAll(false, region);
        res.json({ message: `Aggregation complete (${regionLabel})` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/action/publish', async (req, res) => {
    try {
        const { region = 'all' } = req.body || {};
        const regionLabel = region === 'all' ? 'Global' : region;

        const meta = await readJson(STORAGE.CHAMPION_META);
        const rating = await readJson(STORAGE.CHAMPION_RATING);
        const drafting = await readJson(STORAGE.CHAMPION_DRAFTING);
        const scaling = await readJson(STORAGE.CHAMPION_SCALING);

        if (!meta || !rating || !drafting) {
            return res.status(400).json({ error: "Missing local data. Aggregate first." });
        }

        const uploadResult = await uploadTierData(meta, rating, drafting, scaling || [], region);
        
        // Auto bump version for ALL environments
        if (uploadResult && uploadResult.rcFields && uploadResult.rcFields.length > 0) {
            await incrementVersionFields(uploadResult.rcFields, { 
                latestPatch: uploadResult.patch, 
                environment: "ALL" 
            });
        }

        res.json({ message: `Publish complete (${regionLabel})`, result: uploadResult });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


router.post('/action/sync-assets', (req, res) => {
    const syncProcess = spawn('node', [path.join(__dirname, '../application/sync-master.js'), '--auto']);

    syncProcess.stdout.on('data', (data) => {
        Logger.info(`Sync: ${data.toString().trim()}`);
    });

    syncProcess.stderr.on('data', (data) => {
        Logger.error(`Sync error: ${data.toString().trim()}`);
    });

    syncProcess.on('close', (code) => {
        if (code === 0) {
            Logger.success("Asset sync completed.");
        } else {
            Logger.warn(`Asset sync exited with code ${code}`);
        }
    });

    res.json({ message: "Asset sync started in background" });
});

// ── Team Data: Export & Import ───────────────────────────────────────────────

/**
 * GET /data/db-stats — Database statistics for the Team Data panel
 */
router.get('/data/db-stats', async (req, res) => {
    try {
        await Database.connect();
        const patches = await Database.getDistinctPatches();

        // Total match count
        const totalRow = await Database.get("SELECT COUNT(*) as count FROM matches");
        const totalMatches = totalRow ? totalRow.count : 0;

        // Per-region counts
        const regionCounts = await Database.all(
            "SELECT region, COUNT(*) as count FROM matches GROUP BY region ORDER BY count DESC"
        );

        // DB file size
        let sizeMB = "0";
        try {
            const stats = await fsPromises.stat(STORAGE.DATABASE);
            sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        } catch (_) {}

        res.json({
            totalMatches,
            sizeMB,
            patches: patches || [],
            regions: regionCounts || []
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /data/export — Export current crawler.db to data/exports/
 */
router.post('/data/export', async (req, res) => {
    try {
        Logger.info("Export requested via Dashboard...");
        const result = await ImportManager.exportToFolder(STORAGE.EXPORTS);
        if (result) {
            res.json({
                message: `Export complete: ${result.fileName} (${result.sizeMB} MB)`,
                fileName: result.fileName,
                sizeMB: result.sizeMB,
                downloadUrl: `/api/data/exports/${result.fileName}`
            });
        } else {
            res.status(500).json({ error: "Export failed. Check logs." });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /data/export/list — List previously exported files
 */
router.get('/data/export/list', async (req, res) => {
    try {
        const files = await ImportManager.listExports();
        res.json({ files });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /data/import/list — List .db files in the import bin
 */
router.get('/data/import/list', async (req, res) => {
    try {
        const files = await ImportManager.listImportBin();
        res.json({ files });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * POST /data/import/upload — Upload a .db file to the import bin
 */
router.post('/data/import/upload', upload.single('dbFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No .db file uploaded" });
    }

    const sizeMB = (req.file.size / (1024 * 1024)).toFixed(2);
    Logger.success(`File uploaded to import bin: ${req.file.originalname} (${sizeMB} MB)`);

    res.json({
        message: `Uploaded ${req.file.originalname} (${sizeMB} MB) to import bin`,
        fileName: req.file.filename,
        sizeMB
    });
});

/**
 * POST /data/import/run — Batch merge all .db files in the import bin
 */
router.post('/data/import/run', async (req, res) => {
    try {
        const { deleteAfterImport = true } = req.body || {};
        Logger.info("Batch import requested via Dashboard...");
        const result = await ImportManager.batchImportFromBin(deleteAfterImport);
        res.json({
            message: `Merged ${result.totalNew} new matches from ${result.results.length} file(s)`,
            ...result
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * DELETE /data/import/:filename — Remove a file from the import bin
 */
router.delete('/data/import/:filename', async (req, res) => {
    try {
        const ok = await ImportManager.removeFromBin(req.params.filename);
        if (ok) {
            res.json({ message: `Removed ${req.params.filename}` });
        } else {
            res.status(500).json({ error: `Failed to remove ${req.params.filename}` });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
