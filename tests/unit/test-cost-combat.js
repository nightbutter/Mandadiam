
const assert = require("node:assert/strict");
const { resolveAttack } = require("../../src/game/combat");

function createCharacters() {
    return {
        player: {
            name: "Noctis",
            hp: 100,
            atk: 20,
            def: 5,
            spe: 4,
            cost: 3
        },
        enemy: {
            name: "Slime",
            hp: 100,
            atk: 8,
            def: 7,
            spe: 2,
            cost: 3
        }
    };
}

console.log("=== COST + COMBAT Integration Tests ===");

// 1. โจมตีโดน ต้องได้ COST จากการโจมตีหนึ่งครั้ง
{
    const { player, enemy } = createCharacters();

    resolveAttack(player, enemy, {
        attackerRolls: [15],
        defenderRolls: [10],
        damageRolls: [5]
    });

    assert.equal(player.cost, 4);
    assert.equal(enemy.cost, 4);
    console.log("PASS: โจมตีโดนและได้รับดาเมจ เพิ่ม COST ถูกต้อง");
}

// 2. Double Attack ได้ COST จากการโจมตีเพียง +1
{
    const { player, enemy } = createCharacters();

    resolveAttack(player, enemy, {
        attackerRolls: [20],
        defenderRolls: [10],
        damageRolls: [5, 4]
    });

    assert.equal(player.cost, 4);
    assert.equal(enemy.cost, 5);
    console.log("PASS: Double Attack ไม่เพิ่ม COST โจมตีเกินหนึ่งครั้ง");
}

// 3. สะท้อนดาเมจแล้วผู้โจมตีได้รับ COST จากดาเมจ
{
    const { player, enemy } = createCharacters();

    resolveAttack(player, enemy, {
        attackerRolls: [12],
        defenderRolls: [20],
        reflectRolls: [6]
    });

    assert.equal(player.cost, 4);
    assert.equal(enemy.cost, 3);
    console.log("PASS: สะท้อนดาเมจเพิ่ม COST ให้ผู้รับดาเมจ");
}

console.log("\nCOST + Combat integration tests passed.");
