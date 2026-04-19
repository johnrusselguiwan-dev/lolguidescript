const readline = require("readline");
const Crawler = require("./scripts/crawl");
const { runMasterSync } = require("./scripts/sync-master");
const GlobalAggregator = require("./src/services/aggregator");
const ImportManager = require("./src/services/import-manager");
const { uploadTierData } = require("./src/output/firebase");
const { readJson } = require("./src/utils/io");
const { STORAGE } = require("./config/constants");
const { c } = require("./src/utils/cli");
const Logger = require("./src/utils/logger");

function ask(query) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((res) => rl.question(`  ${c.yellow}▸${c.reset} ${query}`, (ans) => {
        rl.close();
        res(ans.trim());
    }));
}

async function main() {
    while (true) {
        console.log();
        console.log(`  ${c.cyan}╔══════════════════════════════════════════════════════╗${c.reset}`);
        console.log(`  ${c.cyan}║${c.reset}${c.bold}${c.cyan}         LoL Guide  ·  Master Control Panel         ${c.reset}${c.cyan}║${c.reset}`);
        console.log(`  ${c.cyan}╚══════════════════════════════════════════════════════╝${c.reset}`);
        console.log();

        console.log(`  ${c.bold}Data Collection (For Everyone)${c.reset}`);
        console.log(`    ${c.cyan}[1]${c.reset}  🔄 Start Crawling         ${c.dim}(Fetch live match data)${c.reset}`);
        console.log(`    ${c.cyan}[2]${c.reset}  📤 Export Data for Team   ${c.dim}(Share your crawled matches with the Master)${c.reset}`);
        console.log();

        console.log(`  ${c.bold}Data Processing (For Master Laptop)${c.reset}`);
        console.log(`    ${c.cyan}[3]${c.reset}  📥 Import Team Data       ${c.dim}(Load matches shared by a coworker)${c.reset}`);
        console.log(`    ${c.cyan}[4]${c.reset}  📦 Aggregate Data         ${c.dim}(Combine matches into champion stats)${c.reset}`);
        console.log(`    ${c.cyan}[5]${c.reset}  🚀 Publish to App         ${c.dim}(Upload aggregated stats to Firebase)${c.reset}`);
        console.log(`    ${c.cyan}[6]${c.reset}  🗄️  Sync Static Assets    ${c.dim}(Update base champions, items, runes)${c.reset}`);
        console.log();

        console.log(`    ${c.red}[0]${c.reset}  ❌ Exit`);
        console.log();

        const choice = await ask("Enter choice (0-6): ");
        console.clear();

        async function confirmAction(warningText) {
            console.log(`\n  ${c.yellow}⚠️  WARNING / INFO${c.reset}`);
            console.log(`  ${c.dim}${warningText}${c.reset}\n`);
            const ans = await ask("Do you want to proceed? (y/N): ");
            return ans.toLowerCase() === "y" || ans.toLowerCase() === "yes";
        }

        try {
            if (choice === "1") {
                if (await confirmAction("This will start the crawler. It fetches matches from the Riot API and saves them to your local database. It will run continuously until you press 'Q' to quit.")) {
                    await new Crawler().start();
                }
            }
            else if (choice === "2") {
                if (await confirmAction("This will optimize and copy your local database to your Desktop. You can then send that file to the Master laptop to share your data.")) {
                    await ImportManager.exportDatabase();
                }
            }
            else if (choice === "3") {
                console.log(`\n  ${c.bold}Import Coworker's Data${c.reset}`);
                console.log(`  ${c.dim}Drag and drop the .db file they sent you right here into the window, then press Enter.${c.reset}\n`);
                const filePath = await ask("Path to file: ");

                if (await confirmAction("This will read your coworker's file and merge their matches into your main database. It will automatically skip any duplicates.")) {
                    await ImportManager.runImport(filePath);
                }
            }
            else if (choice === "4") {
                if (await confirmAction("This will calculate the final win rates, builds, and matchup stats from all the raw matches in your database. This may take a minute.")) {
                    await GlobalAggregator.mergeAll(false);
                }
            }
            else if (choice === "5") {
                if (await confirmAction("This will UPLOAD your final stats to Firebase. This updates the live data for your mobile app users!")) {
                    Logger.info("Reading local aggregated data for upload...");
                    const meta = await readJson(STORAGE.CHAMPION_META);
                    const rating = await readJson(STORAGE.CHAMPION_RATING);
                    const drafting = await readJson(STORAGE.CHAMPION_DRAFTING);

                    if (!meta || !rating || !drafting) {
                        Logger.error("Failed to load local data. You must run [4] Aggregate Data first!");
                    } else {
                        await uploadTierData(meta, rating, drafting);
                    }
                }
            }
            else if (choice === "6") {
                if (await confirmAction("This will fetch the newest champion pictures, item stats, and runes from Riot's Data Dragon.")) {
                    await runMasterSync();
                }
            }
            else if (choice === "0") {
                console.log(`\n  ${c.green}Safely exiting... Bye!${c.reset}\n`);
                process.exit(0);
            }
            else {
                console.log(`\n  ${c.red}❌ Invalid choice. Please try again.${c.reset}\n`);
            }
        } catch (err) {
            console.error(`\n  ${c.red}Error executing option [${choice}]:${c.reset}`, err);
        }

        console.log();
        await ask("Press Enter to return to the Master Control Panel...");
        console.clear();
    }
}

main();