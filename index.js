const readline = require("readline");
const Crawler = require("./scripts/crawl");
const { runMasterSync } = require("./scripts/sync-master");
const { c } = require("./src/utils/cli");

function ask(query) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((res) => rl.question(`  ${c.yellow}▸${c.reset} ${query}`, (ans) => {
        rl.close();
        res(ans.trim());
    }));
}

async function main() {
    console.log();
    console.log(`  ${c.cyan}╔══════════════════════════════════════════════════════╗${c.reset}`);
    console.log(`  ${c.cyan}║${c.reset}${c.bold}${c.cyan}         LoL Guide  ·  Master Control Panel         ${c.reset}${c.cyan}║${c.reset}`);
    console.log(`  ${c.cyan}╚══════════════════════════════════════════════════════╝${c.reset}`);
    console.log();
    console.log(`  ${c.bold}What would you like to run?${c.reset}`);
    console.log();
    console.log(`    ${c.cyan}[1]${c.reset}  🗄️  Static Data Sync     ${c.dim}(Base Champions, Items, Runes, Spells)${c.reset}`);
    console.log(`    ${c.cyan}[2]${c.reset}  ⚔️  Live Data Crawler    ${c.dim}(Ranked Matches, Win Rates, Builds)${c.reset}`);
    console.log();
    
    const choice = await ask("Enter choice (1-2): ");
    
    if (choice === "1") {
        console.clear();
        await runMasterSync();
    } else if (choice === "2") {
        console.clear();
        new Crawler().start().catch((err) => console.error("Fatal Error", err));
    } else {
        console.log(`\n  ${c.red}❌ Invalid choice. Exiting.${c.reset}\n`);
        process.exit(1);
    }
}

main();