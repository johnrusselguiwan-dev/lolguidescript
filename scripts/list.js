function buildListEntry(detailEntry) {
    return {
        id: detailEntry.id,
        name: detailEntry.name,
        image: detailEntry.icon,
        lanes: detailEntry.lanes,
        region: detailEntry.region,
        roles: detailEntry.roles
    };
}

module.exports = {
    buildListEntry
};
