const assert = require("node:assert/strict");
const { toBattleCharacter } = require("../../src/game/services/battleService");
const { createBattle } = require("../../src/game/battle");

console.log("=== Battle Mapping Tests ===");

function test(title, run) {
    run();
    console.log(`PASS: ${title}`);
}

const row = {
    id: 99,
    player_id: 7,
    name: "noctis",
    max_hp: 9999,
    atk: 100,
    def: 50,
    spe: 50,
    created_at: new Date()
};

test("max_hp maps to hp, stats pass through, cost starts 0", () => {
    const c = toBattleCharacter(row);

    assert.equal(c.name, "noctis");
    assert.equal(c.hp, 9999);
    assert.equal(c.atk, 100);
    assert.equal(c.def, 50);
    assert.equal(c.spe, 50);
    assert.equal(c.cost, 0);
});

test("mapped object does not leak db fields", () => {
    const c = toBattleCharacter(row);

    assert.equal(c.max_hp, undefined);
    assert.equal(c.player_id, undefined);
    assert.equal(c.id, undefined);
});

test("mapped characters are accepted by createBattle", () => {
    const a = toBattleCharacter(row);
    const b = toBattleCharacter({
        ...row, name: "slime", max_hp: 60, atk: 8, def: 7, spe: 2
    });

    const battle = createBattle(a, b, {
        firstRolls: [15],
        secondRolls: [10]
    });

    assert.equal(battle.status, "active");
});

test("mapper does not mutate the db row", () => {
    toBattleCharacter(row);
    assert.equal(row.max_hp, 9999);
    assert.equal(row.hp, undefined);
});

console.log("\nBattle mapping tests passed.");
