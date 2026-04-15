/**
 * CLI utilities — terminal colors, menus, progress bars, and user prompts.
 * Zero external dependencies. Falls back to plain text when NO_COLOR is set.
 */

const readline = require("readline");

// ── ANSI Colors ─────────────────────────────────────────────────────────────

const isColorEnabled = !process.env.NO_COLOR && process.stdout.isTTY !== false;

const c = {
    reset:   isColorEnabled ? "\x1b[0m" : "",
    bold:    isColorEnabled ? "\x1b[1m" : "",
    dim:     isColorEnabled ? "\x1b[2m" : "",
    cyan:    isColorEnabled ? "\x1b[36m" : "",
    green:   isColorEnabled ? "\x1b[32m" : "",
    red:     isColorEnabled ? "\x1b[31m" : "",
    yellow:  isColorEnabled ? "\x1b[33m" : "",
    magenta: isColorEnabled ? "\x1b[35m" : "",
    white:   isColorEnabled ? "\x1b[37m" : "",
};

// ── Prompt ──────────────────────────────────────────────────────────────────

function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise((resolve) =>
        rl.question(`  ${c.yellow}▸${c.reset} ${query}`, (ans) => {
            rl.close();
            resolve(ans);
        })
    );
}

// ── Header ──────────────────────────────────────────────────────────────────

function printHeader(version) {
    const W = 48;
    const title = "LoL Guide  ·  Data Sync Tool";
    const patch = `Patch ${version}`;

    const padCenter = (text, width) =>
        text.padStart(Math.floor((width + text.length) / 2)).padEnd(width);

    console.log();
    console.log(`  ${c.cyan}╔${"═".repeat(W)}╗${c.reset}`);
    console.log(`  ${c.cyan}║${c.reset}${c.bold}${c.cyan}${padCenter(title, W)}${c.reset}${c.cyan}║${c.reset}`);
    console.log(`  ${c.cyan}║${c.reset}${c.dim}${padCenter(patch, W)}${c.reset}${c.cyan}║${c.reset}`);
    console.log(`  ${c.cyan}╚${"═".repeat(W)}╝${c.reset}`);
    console.log();
}

// ── Menus ───────────────────────────────────────────────────────────────────

function showDataMenu() {
    console.log(`  ${c.bold}What would you like to sync?${c.reset}`);
    console.log();
    console.log(`    ${c.cyan}[1]${c.reset}  Champions`);
    console.log(`    ${c.cyan}[2]${c.reset}  Items`);
    console.log(`    ${c.cyan}[3]${c.reset}  Runes`);
    console.log(`    ${c.cyan}[4]${c.reset}  All Data  ${c.dim}(Champions + Items + Runes)${c.reset}`);
    console.log();
}

function showDestMenu() {
    console.log(`  ${c.bold}Where should the data go?${c.reset}`);
    console.log();
    console.log(`    ${c.cyan}[1]${c.reset}  Upload to Firebase`);
    console.log(`    ${c.cyan}[2]${c.reset}  Export to local JSON`);
    console.log();
}

// ── Progress Bar ────────────────────────────────────────────────────────────

class ProgressBar {
    /**
     * Creates a terminal progress bar.
     * @param {string} label  — short label shown to the left of the bar
     * @param {number} total  — the value that represents 100%
     */
    constructor(label, total) {
        this.label = label;
        this.total = total;
        this.current = 0;
        this.barWidth = 24;
        this.startTime = Date.now();
    }

    /** Update the bar to a new current value (redraws the same line). */
    update(current) {
        this.current = current;
        const ratio = this.total > 0 ? this.current / this.total : 0;
        const percent = Math.round(ratio * 100);
        const filled = Math.round(this.barWidth * ratio);
        const empty = this.barWidth - filled;

        const bar = `${c.green}${"█".repeat(filled)}${c.dim}${"░".repeat(empty)}${c.reset}`;
        const counter = `${c.dim}(${this.current}/${this.total})${c.reset}`;

        process.stdout.write(
            `\r  ⏳ ${this.label.padEnd(20)} ${bar}  ${String(percent).padStart(3)}%  ${counter}  `
        );
    }

    /** Finalize the bar — shows 100% filled, elapsed time, and moves to next line. */
    complete(message) {
        const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
        const bar = `${c.green}${"█".repeat(this.barWidth)}${c.reset}`;
        const timeStr = `${c.dim}(${elapsed}s)${c.reset}`;

        process.stdout.write(
            `\r  ${c.green}✅${c.reset} ${(message || this.label).padEnd(20)} ${bar}  100%  ${timeStr}  \n`
        );
    }
}

// ── Logging Helpers ─────────────────────────────────────────────────────────

function printPhase(number, message) {
    console.log();
    console.log(`  ${c.cyan}${c.bold}Phase ${number}:${c.reset} ${message}`);
    console.log(`  ${c.dim}${"─".repeat(44)}${c.reset}`);
}

function printSuccess(message) {
    console.log(`  ${c.green}✅ ${message}${c.reset}`);
}

function printError(message) {
    console.log(`  ${c.red}❌ ${message}${c.reset}`);
}

function printInfo(message) {
    console.log(`  ${c.dim}${message}${c.reset}`);
}

function printAutoMode() {
    console.log(`  ${c.yellow}⚡ Auto-mode detected — syncing all data to Firebase${c.reset}`);
    console.log();
}

function printComplete(version) {
    console.log();
    console.log(`  ${c.green}${c.bold}🎉 Sync completed for patch ${version}${c.reset}`);
    console.log();
}

module.exports = {
    c,
    askQuestion,
    printHeader,
    showDataMenu,
    showDestMenu,
    ProgressBar,
    printPhase,
    printSuccess,
    printError,
    printInfo,
    printAutoMode,
    printComplete,
};
