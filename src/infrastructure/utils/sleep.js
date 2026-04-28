/**
 * Simple async delay.
 * @param {number} ms — milliseconds to wait
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

module.exports = sleep;
