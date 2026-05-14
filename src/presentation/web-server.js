/**
 * Web Server — thin Express bootstrap for the Hextech Dashboard API.
 *
 * All route handlers live in ./api-routes.js.
 * This module only creates the app, mounts the router, and starts listening.
 */

const express = require('express');
const path = require('path');
const { STORAGE } = require('../../config/constants');
const apiRoutes = require('./api-routes');

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));

// Serve exported .db files as static downloads
app.use('/api/data/exports', express.static(STORAGE.EXPORTS));

app.use('/api', apiRoutes);

function startServer() {
    return new Promise((resolve) => {
        app.listen(PORT, () => {
            const url = `http://localhost:${PORT}`;
            console.log(`\n  🌐 API Server running at: \x1b[36m${url}\x1b[0m\n`);
            resolve(url);
        });
    });
}

module.exports = { startServer };
