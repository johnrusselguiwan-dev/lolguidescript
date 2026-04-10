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
        if (!tagsToKeep.includes(tagName)) {
            // Unwraps the tag but keeps the text inside
            $(el).replaceWith($(el).contents());
        }
    });

    // 5. Return the cleaned string with tags preserved
    return $.html().trim();
}