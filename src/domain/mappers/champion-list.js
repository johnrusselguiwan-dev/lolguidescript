function buildListEntry(detailEntry) {
    return {
        id: detailEntry.id,
        championId: detailEntry.championId,
        name: detailEntry.name,
        avatar: detailEntry.avatar,
        image: `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${detailEntry.id}_0.jpg`,
        lanes: detailEntry.lanes,
        region: detailEntry.region,
        roles: detailEntry.roles
    };
}

module.exports = {
    buildListEntry
};
