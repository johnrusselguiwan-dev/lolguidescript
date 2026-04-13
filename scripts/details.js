const { parseChampionText, splitDescription } = require("../utils/parser");

const BASE_URL = "https://ddragon.leagueoflegends.com/cdn";

const transformIcons = {
    "Nidalee": [
        "https://wiki.leagueoflegends.com/en-us/images/Nidalee_Takedown.png?11a28",
        "https://wiki.leagueoflegends.com/en-us/images/Nidalee_Pounce.png?b56c7",
        "https://wiki.leagueoflegends.com/en-us/images/Nidalee_Swipe.png?858cd",
        "https://ddragon.leagueoflegends.com/cdn/14.2.1/img/spell/AspectOfTheCougar.png"
    ],
    "Elise": [
        "https://wiki.leagueoflegends.com/en-us/images/Elise_Venomous_Bite.png?b75ac",
        "https://wiki.leagueoflegends.com/en-us/images/Elise_Skittering_Frenzy.png?2688a",
        "https://wiki.leagueoflegends.com/en-us/images/Elise_Rappel.png?bde86",
        "https://ddragon.leagueoflegends.com/cdn/14.2.1/img/spell/EliseR.png"
    ],
    "Jayce": [
        "https://wiki.leagueoflegends.com/en-us/images/Jayce_Shock_Blast.png?5a8bc",
        "https://wiki.leagueoflegends.com/en-us/images/Jayce_Hyper_Charge.png?23f15",
        "https://wiki.leagueoflegends.com/en-us/images/Jayce_Acceleration_Gate.png?2e86b",
        "https://wiki.leagueoflegends.com/en-us/images/Jayce_Transform_Mercury_Hammer.png?41ff9"
    ],
    "Gnar": [
        "https://wiki.leagueoflegends.com/en-us/images/Gnar_Boulder_Toss.png?c368e",
        "https://wiki.leagueoflegends.com/en-us/images/Gnar_Wallop.png?6f5c6",
        "https://wiki.leagueoflegends.com/en-us/images/Gnar_Crunch.png?bd523",
        "https://ddragon.leagueoflegends.com/cdn/14.2.1/img/spell/GnarR.png"
    ]
};

function buildDetailEntry(raw, meta, version) {
    const id = raw.id;
    const isShapeshifter = ["Nidalee", "Jayce", "Elise", "Gnar"].includes(id);

    let skillNames = [], skillDescriptions = [], skillIcons = [], skillCooldowns = [], skillCosts = [];

    // 1. Passive
    const pParts = splitDescription(raw.passive.description, id);
    const passiveName = raw.passive.name;
    const passiveDescription = parseChampionText(pParts[0]);
    const passiveIcon = `${BASE_URL}/${version}/img/passive/${raw.passive.image.full}`;

    // 2. Spells
    raw.spells.forEach((s, i) => {
        const sParts = splitDescription(s.description, id);
        const tIcon = transformIcons[id] ? transformIcons[id][i] : null;

        skillNames.push(s.name.split("/")[0].trim());
        skillDescriptions.push(parseChampionText(sParts[0]));
        skillIcons.push(`${BASE_URL}/${version}/img/spell/${s.image.full}`);
        skillCooldowns.push(s.cooldownBurn || "0");
        skillCosts.push(s.costBurn || "0");

        if (isShapeshifter) {
            const altName = s.name.includes("/") ? s.name.split("/")[1].trim() : s.name;
            skillNames.push(altName);
            skillDescriptions.push(parseChampionText(sParts[1] || sParts[0]));
            skillIcons.push(tIcon || `${BASE_URL}/${version}/img/spell/${s.image.full}`);
            skillCooldowns.push(s.cooldownBurn || "0");
            skillCosts.push(s.costBurn || "0");
        }
    });

    const detailEntry = {
        id: raw.id,
        name: raw.name,
        title: raw.title,
        background: `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${raw.id}_0.jpg`,
        icon: `${BASE_URL}/${version}/img/champion/${raw.image.full}`,
        lore: parseChampionText(raw.lore),
        roles: raw.tags,
        lanes: meta.lanes,
        region: meta.region,
        attack: raw.info.attack,
        defense: raw.info.defense,
        magic: raw.info.magic,
        difficulty: raw.info.difficulty,
        hp: raw.stats.hp,
        mp: raw.stats.mp,
        attackDamage: raw.stats.attackdamage,
        attackSpeed: raw.stats.attackspeed,
        armor: raw.stats.armor,
        spellBlock: raw.stats.spellblock,
        moveSpeed: raw.stats.movespeed,
        passiveName,
        passiveDescription,
        passiveIcon,
        skillNames,
        skillDescriptions,
        skillIcons,
        skillCooldowns,
        skillCosts,
        winRate: "49.5%",
        pickRate: "8.2%",
        banRate: "12.0%",
        priceGold: "4800",
        damageType: (raw.info.magic > raw.info.attack) ? "AP" : "AD"
    };

    return detailEntry;
}

module.exports = {
    buildDetailEntry
};
