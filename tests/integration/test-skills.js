const assert = require("node:assert/strict");
const { pool } = require("../../src/database/db");
const playerService = require("../../src/services/playerService");
const characterService = require("../../src/services/characterService");
const skillRepository =
    require("../../src/database/repositories/skillRepository");
const bs = require("../../src/game/services/battleService");
const driver = require("../helpers/rollDriver");
const { INITIAL_LOADOUT } = require("../../src/game/skills");

// Skill persistence + end-to-end battle use on real Neon.

const TAG = `__skill_test_${Date.now()}__`;
const P1 = `${TAG}_p1`;
const P2 = `${TAG}_p2`;

function test(title, result) {
    assert(result, title);
    console.log(`PASS: ${title}`);
}

(async () => {
    try {
        console.log("=== Skill Integration Tests ===");

        await playerService.registerPlayer(P1, "skill_one");
        await playerService.registerPlayer(P2, "skill_two");
        await characterService.createCharacter(
            P1, { name: "Mage", maxHp: 100, atk: 20, def: 15, spe: 15 }
        );
        await characterService.createCharacter(
            P2, { name: "Tank", maxHp: 60, atk: 10, def: 10, spe: 10 }
        );

        const { characters: [mage] } =
            await characterService.listCharacters(P1);

        // New character provisioned with the initial loadout.
        const keys = await skillRepository.listKeys(mage.id);
        test(
            "new character provisioned with all three skills",
            keys.length === 3 &&
            INITIAL_LOADOUT.every(k => keys.includes(k))
        );

        // Duplicate provisioning is idempotent.
        await skillRepository.provision(mage.id);
        const again = await skillRepository.listKeys(mage.id);
        test("re-provisioning inserts no duplicates",
            again.length === 3);

        // Ownership-scoped listing.
        const owned = await characterService.listCharacterSkills(
            P1, mage.id
        );
        test("owner can list their character's skills",
            owned.ok && owned.skills.length === 3);

        const foreign = await characterService.listCharacterSkills(
            P2, mage.id
        );
        test("forged character id rejected",
            !foreign.ok && foreign.error === "not_found");

        // Battle character carries equipped skills.
        await characterService.selectCharacter(P1, "Mage");
        await characterService.selectCharacter(P2, "Tank");
        const a = await characterService.getActiveBattleCharacter(P1);
        test("battle character loads equipped skills",
            a.character.skills.length === 3 &&
            a.character.skills.includes("power_strike"));

        // End-to-end: skill resolves through the shared engine.
        const b = await characterService.getActiveBattleCharacter(P2);
        const session = driver.start(
            `${TAG}_chan`,
            { discordId: P1, character: a.character },
            { discordId: P2, character: b.character },
            { firstRolls: [18], secondRolls: [5] }
        ).session;

        const hero = session.battle.characters[0];
        hero.cost = 5;

        const out = driver.useSkill(
            session, P1, "power_strike",
            { attackerRolls: [15], defenderRolls: [10],
              damageRolls: [5] }
        );
        test("power strike resolves in a real battle", out.ok);
        test(
            "skill damage uses skill formula (d8+ATK+SPE−DEF)",
            out.result.hits[0].damage === 5 + 20 + 15 - 10
        );
        test("COST spent once (5 −3 +1 hit = 3)",
            hero.cost === 3);
        test("turn advanced exactly once",
            session.battle.turnNumber === 2);

        bs.forfeit(session, P1);

        console.log("\nSkill integration tests passed.");
    } finally {
        const session = bs.getSession(`${TAG}_chan`);
        if (session) {
            bs.forfeit(session, session.players[0].discordId);
        }
        await pool.query(
            `DELETE FROM players WHERE discord_id LIKE $1`, [`${TAG}%`]
        );
        await pool.end();
    }
})().catch(err => {
    console.error("FAIL:", err);
    process.exit(1);
});
