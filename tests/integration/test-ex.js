const assert = require("node:assert/strict");
const { pool } = require("../../src/database/db");
const playerService = require("../../src/services/playerService");
const characterService = require("../../src/services/characterService");
const exRepository =
    require("../../src/database/repositories/exRepository");
const bs = require("../../src/game/services/battleService");
const { EX_KEYS, getExSkill } = require("../../src/game/exSkills");
const { migrate } = require("../../src/database/migrations/migrate");

// EX persistence + end-to-end activation on real Neon.

const TAG = `__ex_test_${Date.now()}__`;
const P1 = `${TAG}_p1`;
const P2 = `${TAG}_p2`;

function test(title, result) {
    assert(result, title);
    console.log(`PASS: ${title}`);
}

(async () => {
    try {
        console.log("=== EX Integration Tests ===");

        // Migration idempotency — must not fail or duplicate.
        await migrate();
        await migrate();
        test("migration is idempotent", true);

        await playerService.registerPlayer(P1, "ex_one");
        await playerService.registerPlayer(P2, "ex_two");
        await characterService.createCharacter(
            P1, { name: "Blade", maxHp: 100, atk: 20, def: 15, spe: 15 }
        );
        await characterService.createCharacter(
            P2, { name: "Wall", maxHp: 150, atk: 0, def: 0, spe: 0 }
        );

        const { characters: [blade] } =
            await characterService.listCharacters(P1);

        // New character gets a valid deterministic assignment.
        const key = await exRepository.getExKey(blade.id);
        test("new character has a valid EX assignment",
            !!key && !!getExSkill(key));
        test("assignment is deterministic (id % count)",
            key === EX_KEYS[blade.id % EX_KEYS.length]);

        // Re-provisioning never overwrites.
        await exRepository.provision(blade.id);
        const again = await exRepository.getExKey(blade.id);
        test("provisioning does not overwrite assignment",
            again === key);

        // Forged key cannot be stored.
        const forged = await exRepository.assign(blade.id, "nukem_all");
        test("forged EX key rejected", !forged.ok);

        // Pin a known EX so the end-to-end assertions are exact.
        const assigned = await exRepository.assign(
            blade.id, "oblivion_edge"
        );
        test("catalog EX can be assigned", assigned.ok);

        // Two different characters can hold different EX.
        const { characters: [wall] } =
            await characterService.listCharacters(P2);
        const key2 = await exRepository.getExKey(wall.id);
        test("second character also provisioned",
            !!key2 && !!getExSkill(key2));

        // Battle character carries exKey + zero gauge.
        await characterService.selectCharacter(P1, "Blade");
        await characterService.selectCharacter(P2, "Wall");
        const a = await characterService.getActiveBattleCharacter(P1);
        test("battle character carries exKey",
            a.character.exKey === "oblivion_edge" &&
            a.character.ex === 0);

        // End-to-end: build gauge via real attacks, then unleash.
        const b = await characterService.getActiveBattleCharacter(P2);
        const session = bs.startBattle(
            `${TAG}_chan`,
            { discordId: P1, character: a.character },
            { discordId: P2, character: b.character },
            { firstRolls: [18], secondRolls: [5] }
        ).session;

        const hero = session.battle.characters[0];

        // EX not ready → rejected, state untouched.
        const early = bs.useEx(session, P1);
        test("EX rejected below 100 gauge",
            !early.ok && early.error === "ex_not_ready");

        hero.ex = 100;
        hero.cost = 5;
        const enemy = session.battle.characters[1];
        const hpBefore = enemy.hp;

        const out = bs.useEx(session, P1, {
            attackerRolls: [15], defenderRolls: [10],
            damageRolls: [5]
        });

        test("EX resolves through real battle", out.ok);
        test("gauge consumed to 0", hero.ex === 0);
        // cost set to 5 after turn start → −4 EX → +1 hit = 2
        test("EX COST spent once", hero.cost === 2);
        test("EX damaged the target", enemy.hp < hpBefore);
        test("target gained +10 damage-received EX", enemy.ex === 10);
        test("exactly one turn transition",
            session.battle.turnNumber === 2);

        bs.forfeit(session, P1);

        console.log("\nEX integration tests passed.");
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
