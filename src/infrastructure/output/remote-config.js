/**
 * Remote Config Manager — reads and updates the App_Config parameter
 * in Firebase Remote Config via the Admin SDK.
 *
 * Safety:
 *   - Only fields in INCREMENTABLE_FIELDS can be incremented.
 *   - PROTECTED_FIELDS are never modified.
 *   - ETag concurrency is handled automatically by the Admin SDK.
 *   - Errors are caught and logged — never crash the calling upload.
 */

const { admin } = require("../../../config/firebase");
const { c } = require("../../presentation/cli-utils");
const Logger = require("../utils/logger");

const PARAM_KEY = "App_Config";

// Fields that the script is allowed to auto-increment
const INCREMENTABLE_FIELDS = [
    "champion_list_version",
    "champion_detail_version",
    "champion_rating_version",
    "draft_master_version",
    "spell_list_version",
    "item_list_version",
    "rune_list_version",
    "effect_counter_version",
];

// Fields that must NEVER be touched by automation
const PROTECTED_FIELDS = ["version_name", "version_code", "force_update"];

/**
 * Fetch the current Remote Config template and parse the App_Config parameter.
 *
 * @returns {{ template: object, defaultConfig: object, conditionalConfigs: Map<string, object> }}
 */
async function getAppConfig() {
    const rc = admin.remoteConfig();
    const template = await rc.getTemplate();

    const param = template.parameters[PARAM_KEY];
    if (!param) {
        throw new Error(`Remote Config parameter "${PARAM_KEY}" not found!`);
    }

    // Parse default value
    const defaultConfig = JSON.parse(param.defaultValue.value);

    // Parse each conditional value (Debug, Staging, etc.)
    const conditionalConfigs = new Map();
    if (param.conditionalValues) {
        for (const [conditionName, condValue] of Object.entries(param.conditionalValues)) {
            conditionalConfigs.set(conditionName, JSON.parse(condValue.value));
        }
    }

    return { template, defaultConfig, conditionalConfigs };
}

/**
 * Increment specified version fields across ALL conditions and publish.
 *
 * @param {string[]} fieldNames - Fields to increment (must be in INCREMENTABLE_FIELDS)
 * @param {object}   [options]  - Optional: { latestPatch: "16.8.1" }
 * @returns {{ success: boolean, changes: object }}
 */
async function incrementVersionFields(fieldNames, options = {}) {
    try {
        // Validate fields
        const invalidFields = fieldNames.filter(
            (f) => !INCREMENTABLE_FIELDS.includes(f)
        );
        if (invalidFields.length > 0) {
            Logger.error(`Blocked: these fields are not incrementable: ${invalidFields.join(", ")}`);
            return { success: false, changes: {} };
        }

        const protectedHit = fieldNames.filter((f) => PROTECTED_FIELDS.includes(f));
        if (protectedHit.length > 0) {
            Logger.error(`Blocked: these fields are PROTECTED and cannot be modified: ${protectedHit.join(", ")}`);
            return { success: false, changes: {} };
        }

        const rc = admin.remoteConfig();
        const template = await rc.getTemplate();
        const param = template.parameters[PARAM_KEY];

        if (!param) {
            throw new Error(`Remote Config parameter "${PARAM_KEY}" not found!`);
        }

        const changes = {};

        const targetEnv = options.environment || "ALL";

        // ── Helper: increment fields in a single config JSON ─────────────
        function applyIncrements(config, label) {
            for (const field of fieldNames) {
                const oldValue = config[field];
                if (oldValue !== undefined && typeof oldValue === "number") {
                    config[field] = oldValue + 1;
                    // Track changes (use the first config's values for display)
                    if (!changes[field]) {
                        changes[field] = { from: oldValue, to: oldValue + 1 };
                    }
                } else if (oldValue === undefined) {
                    Logger.warn(`Field "${field}" not found in ${label}, creating with value 1`);
                    config[field] = 1;
                    if (!changes[field]) {
                        changes[field] = { from: 0, to: 1 };
                    }
                }
            }

            // Update latest_patch if provided
            if (options.latestPatch) {
                config.latest_patch = options.latestPatch;
            }
        }

        // ── Apply to default value (Prod) ────────────────────────────────
        const updatedConditions = [];
        if (targetEnv === "ALL" || targetEnv.toUpperCase() === "PROD") {
            const defaultConfig = JSON.parse(param.defaultValue.value);
            applyIncrements(defaultConfig, "Prod (default)");
            param.defaultValue.value = JSON.stringify(defaultConfig, null, 2);
            updatedConditions.push("Prod (default)");
        }

        // ── Apply to each conditional value (Debug, Staging) ─────────────
        if (param.conditionalValues) {
            for (const [conditionName, condValue] of Object.entries(param.conditionalValues)) {
                if (targetEnv === "ALL" || targetEnv.toUpperCase() === conditionName.toUpperCase()) {
                    const config = JSON.parse(condValue.value);
                    applyIncrements(config, conditionName);
                    condValue.value = JSON.stringify(config, null, 2);
                    updatedConditions.push(conditionName);
                }
            }
        }

        // ── Publish ──────────────────────────────────────────────────────
        await rc.publishTemplate(template);

        // ── Pretty-print results ─────────────────────────────────────────
        const W = 50;
        console.log();
        console.log(`  ${c.cyan}┌${"─".repeat(W)}┐${c.reset}`);
        console.log(`  ${c.cyan}│${c.reset}  ${c.bold}🔢 Remote Config Updated${c.reset}${" ".repeat(W - 26)}${c.cyan}│${c.reset}`);
        console.log(`  ${c.cyan}├${"─".repeat(W)}┤${c.reset}`);

        for (const [field, { from, to }] of Object.entries(changes)) {
            const line = `  ${field}: ${from} → ${to}`;
            console.log(`  ${c.cyan}│${c.reset}${c.green}${line.padEnd(W)}${c.reset}${c.cyan}│${c.reset}`);
        }

        if (options.latestPatch) {
            const patchLine = `  latest_patch: "${options.latestPatch}"`;
            console.log(`  ${c.cyan}│${c.reset}${c.green}${patchLine.padEnd(W)}${c.reset}${c.cyan}│${c.reset}`);
        }

        console.log(`  ${c.cyan}│${c.reset}${" ".repeat(W)}${c.cyan}│${c.reset}`);
        const condLine = `  Synced: ${updatedConditions.join(", ")}`;
        console.log(`  ${c.cyan}│${c.reset}${c.dim}${condLine.padEnd(W)}${c.reset}${c.cyan}│${c.reset}`);
        console.log(`  ${c.cyan}└${"─".repeat(W)}┘${c.reset}`);
        console.log();

        return { success: true, changes };
    } catch (error) {
        Logger.error(`Remote Config update failed: ${error.message}`);
        return { success: false, changes: {} };
    }
}

/**
 * Display the current App_Config versions for all conditions.
 * Returns the parsed default config for use by callers.
 *
 * @returns {object|null} The default App_Config JSON, or null on error.
 */
async function displayCurrentVersions() {
    try {
        const { defaultConfig, conditionalConfigs } = await getAppConfig();

        console.log();
        console.log(`  ${c.bold}📋 Current Remote Config (App_Config)${c.reset}`);
        console.log(`  ${c.dim}${"─".repeat(44)}${c.reset}`);

        // Show version fields from the default config
        for (const field of INCREMENTABLE_FIELDS) {
            const value = defaultConfig[field];
            if (value !== undefined) {
                console.log(`    ${c.cyan}${field.padEnd(30)}${c.reset} ${c.bold}${value}${c.reset}`);
            }
        }

        if (defaultConfig.latest_patch) {
            console.log(`    ${c.cyan}${"latest_patch".padEnd(30)}${c.reset} ${c.bold}${defaultConfig.latest_patch}${c.reset}`);
        }

        console.log(`  ${c.dim}${"─".repeat(44)}${c.reset}`);

        const condNames = [...conditionalConfigs.keys()];
        if (condNames.length > 0) {
            console.log(`  ${c.dim}Conditions: ${condNames.join(", ")} + Prod (default)${c.reset}`);
        }

        console.log();

        return defaultConfig;
    } catch (error) {
        Logger.error(`Failed to read Remote Config: ${error.message}`);
        return null;
    }
}

/**
 * Build a preview of which fields will be incremented and their before/after values.
 *
 * @param {string[]} fieldNames - Fields that will be incremented
 * @param {object}   [options]  - Optional: { latestPatch: "16.8.1" }
 * @returns {{ preview: Array<{field, from, to}>, currentConfig: object }|null}
 */
async function previewIncrements(fieldNames, options = {}) {
    try {
        const { defaultConfig } = await getAppConfig();

        const preview = [];
        for (const field of fieldNames) {
            const from = defaultConfig[field] || 0;
            preview.push({ field, from, to: from + 1 });
        }

        const targetEnv = options.environment || "ALL";

        // Print the preview
        console.log();
        console.log(`  ${c.bold}🔢 Bump Remote Config Versions?${c.reset}`);
        console.log(`  ${c.dim}Target Environment: ${c.reset}${c.yellow}${targetEnv}${c.reset}`);
        console.log(`  ${c.dim}The following fields will be incremented:${c.reset}`);
        console.log();

        for (const { field, from, to } of preview) {
            console.log(`    ${c.yellow}•${c.reset} ${field.padEnd(30)} ${c.dim}${from}${c.reset} → ${c.green}${c.bold}${to}${c.reset}`);
        }

        if (options.latestPatch) {
            console.log(`    ${c.yellow}•${c.reset} ${"latest_patch".padEnd(30)} → ${c.green}${c.bold}"${options.latestPatch}"${c.reset}`);
        }

        console.log();

        return { preview, currentConfig: defaultConfig };
    } catch (error) {
        Logger.error(`Failed to preview Remote Config: ${error.message}`);
        return null;
    }
}

module.exports = {
    getAppConfig,
    incrementVersionFields,
    displayCurrentVersions,
    previewIncrements,
    INCREMENTABLE_FIELDS,
    PROTECTED_FIELDS,
};
