/**
 * Interactive Draft Simulator — suggests optimal picks based on
 * win-rate data from the crawler's CHAMPION_META.json.
 *
 * Usage:
 *   node scripts/draft.js
 *   npm run draft
 */

const fs = require("fs/promises");
const readline = require("readline/promises");
const { stdin: input, stdout: output } = require("process");
const { STORAGE } = require("../config/constants");

// ─────────────────────────────────────────────────────────────────────────────

async function loadData() {
    try {
        const text = await fs.readFile(STORAGE.CHAMPION_META, "utf8");
        return JSON.parse(text);
    } catch {
        console.error("❌ Failed to load CHAMPION_META.json. Run the crawler first!");
        process.exit(1);
    }
}

function printTeam(name, team, color) {
    console.log(`\n${color}=== ${name} TEAM ===\x1b[0m`);
    if (team.length === 0) console.log("  (Empty)");
    team.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
}

function getSuggestions(myTeam, enemyTeam, stats) {
    const scores = {};

    stats.forEach((s) => {
        const hero = s.championName;
        if (myTeam.includes(hero) || enemyTeam.includes(hero)) return;

        scores[hero] = s.score * 10;

        myTeam.forEach((ally) => {
            if (s.drafting.synergizesWith.includes(ally)) scores[hero] += 5;
        });

        enemyTeam.forEach((enemy) => {
            if (s.drafting.strongAgainst.includes(enemy)) scores[hero] += 8;
        });

        enemyTeam.forEach((enemy) => {
            if (s.drafting.weakAgainst.includes(enemy)) scores[hero] -= 10;
        });
    });

    return Object.entries(scores)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map((x) => x[0]);
}

// ─────────────────────────────────────────────────────────────────────────────

async function start() {
    const stats = await loadData();
    const rl = readline.createInterface({ input, output });

    const blueTeam = [];
    const redTeam = [];
    let isBlueTurn = true;

    console.log("\n🎮 Welcome to the LoL Draft Simulator 🎮");
    console.log("Type the name of a champion to draft them. Type 'exit' to quit.\n");

    while (blueTeam.length < 5 || redTeam.length < 5) {
        const currentTeam = isBlueTurn ? blueTeam : redTeam;
        const enemyTeam = isBlueTurn ? redTeam : blueTeam;
        const teamName = isBlueTurn ? "BLUE" : "RED";
        const colorCode = isBlueTurn ? "\x1b[34m" : "\x1b[31m";

        printTeam("BLUE", blueTeam, "\x1b[34m");
        printTeam("RED", redTeam, "\x1b[31m");

        if (currentTeam.length < 5) {
            console.log(`\n💡 **Suggested Picks for ${teamName} Team**:`);
            const suggestions = getSuggestions(currentTeam, enemyTeam, stats);
            console.log(`   ${suggestions.join("  |  ")}`);

            const answer = await rl.question(`\n${colorCode}[${teamName} TURN]\x1b[0m Pick a champion: `);

            if (answer.toLowerCase() === "exit") break;

            const champRegex = new RegExp(`^${answer}$`, "i");
            const matchedChamp = stats.find((s) => champRegex.test(s.championName));

            if (!matchedChamp) {
                console.log(`⚠ Champion '${answer}' not found in the database. Please try again.`);
                continue;
            }

            const hero = matchedChamp.championName;
            if (blueTeam.includes(hero) || redTeam.includes(hero)) {
                console.log(`⚠ '${hero}' has already been picked!`);
                continue;
            }

            currentTeam.push(hero);
        }

        isBlueTurn = !isBlueTurn;
    }

    console.log("\n🏁 Draft Complete! 🏁");
    printTeam("BLUE", blueTeam, "\x1b[34m");
    printTeam("RED", redTeam, "\x1b[31m");
    rl.close();
}

start();
