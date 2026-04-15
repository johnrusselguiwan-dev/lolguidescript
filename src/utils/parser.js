const cheerio = require("cheerio");

/**
 * Cleans Riot's messy HTML while preserving the specific tags 
 * your Android Compose extension uses for coloring.
 */
function parseChampionText(htmlContent) {
    if (!htmlContent) return "";

    // 1. Standardize line breaks and lists before parsing
    let intermediate = htmlContent
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<li>/gi, "\n• ")
        .replace(/<\/li>/gi, "");

    // 2. Load into Cheerio
    const $ = cheerio.load(intermediate, null, false); // false = don't add <html>/<body> tags

    // 3. Define the tags your Android App actually uses for styling
    const tagsToKeep = [
        'physicaldamage', 'magicdamage', 'truedamage',
        'scalead', 'scaleap', 'scalehealth',
        'healing', 'shield', 'status', 'rules',
        'attention', 'passive', 'active', 'mana'
    ];

    // 4. Remove all tags NOT in our "Keep" list
    $('*').each((i, el) => {
        const tagName = el.name.toLowerCase();
        if (el.name !== 'root' && !tagsToKeep.includes(tagName)) {
            // Unwraps the tag but keeps the text inside
            $(el).replaceWith($(el).contents());
        }
    });

    // 5. Return the cleaned string with tags preserved
    return $.html().trim();
}

/**
 * Splits descriptions for shapeshifters or standard paragraph breaks.
 */
function splitDescription(desc, id) {
    let parts = desc.split(/<br><br>/i);
    if (parts.length > 1) return [parts[0], parts[1]];
    const splitMap = {
        "Nidalee": /As a cougar,|In human form,/i,
        "Elise": /Spider Form:|Human Form:/i,
        "Jayce": /Hammer Stance:|Cannon Stance:/i,
        "Gnar": /Mega Gnar:|Mini Gnar:/i
    };
    const pattern = splitMap[id];
    if (pattern && desc.match(pattern)) {
        const keywordMatch = desc.match(/(As a cougar,|Spider Form:|Human Form:|Cannon Stance:|Hammer Stance:|Mega Gnar:)/i);
        if (keywordMatch) {
            const index = keywordMatch.index;
            return [desc.substring(0, index).trim(), desc.substring(index).trim()];
        }
    }
    return [desc, desc];
}

module.exports = {
    parseChampionText,
    splitDescription
};
