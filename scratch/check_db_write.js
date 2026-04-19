/**
 * Diagnostic script to check SQLite write access and database integrity.
 */
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data", "system", "crawler.db");

console.log(`\n=== SQLite Diagnostic ===`);
console.log(`DB Path: ${DB_PATH}`);
console.log(`DB Size: ${(require("fs").statSync(DB_PATH).size / 1024 / 1024).toFixed(1)} MB\n`);

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
        console.error(`[FAIL] Could not open in READWRITE mode: ${err.message}`);
        console.log(`\nTrying READONLY mode...`);
        
        const dbRO = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err2) => {
            if (err2) {
                console.error(`[FAIL] Could not open in READONLY mode either: ${err2.message}`);
            } else {
                console.log(`[OK] Opens in READONLY mode. The issue is write permission.`);
                dbRO.close();
            }
        });
        return;
    }

    console.log(`[OK] Database opened in READWRITE mode successfully.\n`);

    // Check journal mode
    db.get("PRAGMA journal_mode;", (err, row) => {
        if (err) console.error(`[FAIL] journal_mode check: ${err.message}`);
        else console.log(`Journal mode: ${row.journal_mode}`);
    });

    // Check page count and size
    db.get("PRAGMA page_count;", (err, row) => {
        if (row) console.log(`Page count: ${row.page_count}`);
    });

    db.get("PRAGMA page_size;", (err, row) => {
        if (row) console.log(`Page size: ${row.page_size}`);
    });

    // Check freelist
    db.get("PRAGMA freelist_count;", (err, row) => {
        if (row) console.log(`Freelist (unused pages): ${row.freelist_count}`);
    });

    // Count rows
    db.get("SELECT COUNT(*) as count FROM matches;", (err, row) => {
        if (err) console.error(`[FAIL] Count matches: ${err.message}`);
        else console.log(`\nTotal matches in DB: ${row.count}`);
    });

    db.get("SELECT COUNT(*) as count FROM timelines;", (err, row) => {
        if (err) console.error(`[FAIL] Count timelines: ${err.message}`);
        else console.log(`Total timelines in DB: ${row.count}`);
    });

    // Try a write
    db.run("CREATE TABLE IF NOT EXISTS _write_test (id INTEGER PRIMARY KEY);", (err) => {
        if (err) {
            console.error(`\n[FAIL] Write test FAILED: ${err.message}`);
            console.log(`This confirms the SQLITE_READONLY issue.`);
        } else {
            console.log(`\n[OK] Write test passed!`);
            // Cleanup test table
            db.run("DROP TABLE IF EXISTS _write_test;", () => {
                console.log(`[OK] Cleanup done.`);
            });
        }
    });

    // Quick integrity check (fast)
    db.get("PRAGMA quick_check;", (err, row) => {
        if (err) console.error(`\n[FAIL] Quick check: ${err.message}`);
        else console.log(`\nIntegrity quick_check: ${row.quick_check}`);
        
        db.close(() => {
            console.log(`\n=== Diagnostic Complete ===\n`);
        });
    });
});
