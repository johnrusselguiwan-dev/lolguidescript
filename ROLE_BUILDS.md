# Role-specific item recommendations

**Deferred:** The role-specific and seven-item recommendation implementation has
been withdrawn pending the user's design review. The original scraper recommendation
algorithm is restored. The app keeps only its nullable-boots recommendation hotfix
and original five-main-item layout. General validation and staging routing remain.
The material below describes the deferred proposal, not active behavior.

Champion classes (Marksman, Mage, Tank, melee/ranged) do not determine inventory
capacity. Any champion can be played in any recorded match position. The scraper
uses Riot's `teamPosition` to separate item pools into TOP, JUNGLE, MIDDLE, BOTTOM,
and UTILITY. Unknown positions do not borrow a champion-wide build.

For each champion and lane, normal inventory observations and observations with
recognized boots in `roleBoundItem` are counted separately. A minimum of 20 actual
match observations is required for a lane/layout recommendation. The threshold is
`BUILD_RECOMMENDATIONS.MIN_MATCHES` in `config/constants.js`; changing it requires
updating both shared validation contracts' sample minimum and associated tests.
Weighted item popularity still uses the existing patch weights, while sample counts
are unweighted observations. Counts are not a confidence interval or a rank filter.

If sufficiently sampled quest-slot boots exist, that lane's recommendations use only
that pool. Otherwise they use only a sufficiently sampled standard pool. Different
layouts are never combined to reach the threshold or to fill missing item choices.
Each eligible lane has three popularity-based alternatives. They are not observed
purchase sequences or ranked whole-build combinations, and may coincide when the
item pool is small.

Each build carries:

```json
{
  "lane": "BOTTOM",
  "bootsInRoleSlot": true,
  "sampleSize": 120,
  "boots": "Berserker's Greaves",
  "items": ["Item 1", "Item 2", "Item 3", "Item 4", "Item 5", "Item 6"],
  "spareItems": ["Alternative 1", "Alternative 2"]
}
```

`bootsInRoleSlot` follows observed inventory data, not an assumption that every bot
match completed its quest. This also handles lane swaps where the inferred position
and quest reward differ. Normal builds with boots have at most five main items;
quest-slot builds can have six main items plus boots in a separate slot. Without
boots, the standard inventory can hold six main items. Quest tokens are excluded.

Both publisher and app validate the metadata together, supported lane values,
minimum sample size, capacity, and duplicate main items. Legacy builds without
metadata remain readable using their existing six-slot layout. New metadata is
stored in the existing build JSON column; no Room table migration is required.

The app provides an **Item build lane** selector and shows samples for the selected
lane. It displays quest-slot boots separately, preserving all six main item icons.
It does not infer a missing lane, silently borrow another lane's build, or infer
extra capacity from a champion class. Runes, spells, and skill order keep their
existing champion-wide behavior; this change is specifically for item builds.

## Verification and rollout

```sh
# Scraper repository: offline tests, no Firebase calls
npm run test:analytics
npm run test:validation

# Android repository
bash gradlew :lolguide:testLolDebugUnitTest :lolguide:assembleLolDebug
```

Tests include melee Mundo in bot versus top, Ziggs in bot versus support, both
inventory layouts within one lane, lane swaps, sparse/unknown lanes, older matches,
upgraded boots, cache round trips, slot limits, and shared contract fixtures.
An anonymized replay of the first 2,500 stored matches confirms separated bot/mid
recommendations without modifying the input database or local published outputs.

Re-aggregate and publish the validated output to `staging_data` after reviewing the
code. Existing JSON/Firestore outputs are not changed just by updating the code.
Test with the updated app: older clients ignore lane/layout metadata and cannot
render the extra slot correctly. Production publication and dataset version bumps
are separate actions and are not performed by these changes.
