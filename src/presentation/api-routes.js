/**
 * API Routes — Express Router for all backend endpoints consumed
 * by the Hextech React Dashboard.
 *
 * Handles crawler control, data aggregation, publishing, asset sync,
 * system logs, and API key management.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const Crawler = require('../application/crawler');
const GlobalAggregator = require('../application/aggregator');
const { uploadTierData } = require('../infrastructure/output/firebase-storage');
const { incrementVersionFields } = require('../infrastructure/output/remote-config');
const { readJson } = require('../infrastructure/utils/io');
const Database = require('../infrastructure/database/sqlite-client');
const { STORAGE, RANK_HIERARCHY } = require('../../config/constants');
const Logger = require('../infrastructure/utils/logger');

const router = express.Router();

// Keep track of crawler state
let activeCrawler = null;

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
        await Database.connect();
        activeCrawler = new Crawler();
        // Don't await here so it runs in background
        activeCrawler.run(0, RANK_HIERARCHY.length).then(() => {
            activeCrawler = null;
        }).catch(err => {
            Logger.error("Crawler failed: " + err.message);
            activeCrawler = null;
        });
        
        res.json({ message: "Crawler started" });
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
        await GlobalAggregator.mergeAll(false);
        res.json({ message: "Aggregation complete" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/action/publish', async (req, res) => {
    try {
        const meta = await readJson(STORAGE.CHAMPION_META);
        const rating = await readJson(STORAGE.CHAMPION_RATING);
        const drafting = await readJson(STORAGE.CHAMPION_DRAFTING);
        const scaling = await readJson(STORAGE.CHAMPION_SCALING);

        if (!meta || !rating || !drafting) {
            return res.status(400).json({ error: "Missing local data. Aggregate first." });
        }

        const uploadResult = await uploadTierData(meta, rating, drafting, scaling || []);
        
        // Auto bump version for ALL environments
        if (uploadResult && uploadResult.rcFields && uploadResult.rcFields.length > 0) {
            await incrementVersionFields(uploadResult.rcFields, { 
                latestPatch: uploadResult.patch, 
                environment: "ALL" 
            });
        }

        res.json({ message: "Publish complete", result: uploadResult });
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

module.exports = router;
