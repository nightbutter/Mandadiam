
const assert = require("node:assert/strict");
const { resolveAttack } = require("./combat");

function createCharacters() {
    return {
        player: {
            name: "Noctis",
            hp: 100,
            atk: 20,
            def: 5,
            spe: 4
        },
        enemy: {
            name: "Slime",
            hp: 100,
            atk: 8,
            def: 7,
            spe: 2
        }
    };
}

function test(title, run) {
    run();
    console.log(`PASS: ${title}`);
}

console.log("=== Attack Resolution Tests ===");

// 1. ผู้โจมตีชนะตามปกติ: 1d8 + ATK - DEF
test("โจมตีปกติเมื่อชนะ d20", () => {
    const { player, enemy } = createCharacters();

    const result = resolveAttack(player, enemy, {
        attackerRolls: [15],
        defenderRolls: [10],
        damageRolls: [5]
    });

    assert.equal(result.outcome, "hit");
    assert.equal(result.damage, 18);
    assert.equal(enemy.hp, 82);
});

// 2. ผู้โจมตีได้ 20: ครั้งแรกคูณ 2 ครั้งสองไม่คูณ
test("ได้ 20 แล้วโจมตีสองครั้ง", () => {
    const { player, enemy } = createCharacters();

    const result = resolveAttack(player, enemy, {
        attackerRolls: [20],
        defenderRolls: [10],
        damageRolls: [5, 4]
    });

    // ครั้งแรก: (5 + 20) * 2 - 7 = 43
    // ครั้งสอง: 4 + 20 - 7 = 17
    assert.equal(result.outcome, "double_attack");
    assert.equal(result.hits.length, 2);
    assert.equal(result.hits[0].damage, 43);
    assert.equal(result.hits[1].damage, 17);
    assert.equal(result.damage, 60);
    assert.equal(enemy.hp, 40);
});

// 3. ผู้ป้องกันได้ 20 และชนะ: สะท้อน d8 + DEF - DEF ผู้โจมตี
test("ผู้ป้องกันได้ 20 แล้วสะท้อนดาเมจ", () => {
    const { player, enemy } = createCharacters();

    const result = resolveAttack(player, enemy, {
        attackerRolls: [12],
        defenderRolls: [20],
        reflectRolls: [6]
    });

    // 6 + 7 - 5 = 8
    assert.equal(result.outcome, "reflected");
    assert.equal(result.damage, 8);
    assert.equal(player.hp, 92);
    assert.equal(enemy.hp, 100);
});

// 4. เสมอแล้วทั้งคู่ทอยใหม่
test("ผล d20 เสมอแล้วทอยใหม่", () => {
    const { player, enemy } = createCharacters();

    const result = resolveAttack(player, enemy, {
        attackerRolls: [12, 16],
        defenderRolls: [12, 10],
        damageRolls: [5]
    });

    assert.equal(result.rerolls, 1);
    assert.equal(result.attackerRoll, 16);
    assert.equal(result.defenderRoll, 10);
    assert.equal(result.damage, 18);
});

// 5. d8 ครั้งแรกของการโจมตีสองครั้งออก 8
// ห้ามคูณ Critical เพิ่มในครั้งแรก
test("การโจมตีสองครั้งไม่คูณ Critical ซ้ำ", () => {
    const { player, enemy } = createCharacters();

    const result = resolveAttack(player, enemy, {
        attackerRolls: [20],
        defenderRolls: [10],
        damageRolls: [8, 3]
    });

    // ครั้งแรก: (8 + 20) * 2 - 7 = 49
    // ครั้งสอง: 3 + 20 - 7 = 16
    assert.equal(result.hits[0].damage, 49);
    assert.equal(result.hits[0].critical, false);
    assert.equal(result.hits[1].damage, 16);
    assert.equal(result.damage, 65);
});

console.log("\nการทดสอบทั้งหมดผ่าน");
