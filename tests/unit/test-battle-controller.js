
const assert = require("node:assert/strict");
const {
    createBattle,
    startTurn,
    performAction,
    endTurn
} = require("../../src/game/battle");

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

function test(title, callback) {
    callback();
    console.log(`PASS: ${title}`);
}

console.log("=== Battle Controller Tests ===");

// 1. เริ่มการต่อสู้และกำหนดลำดับเทิร์น
test("สร้างการต่อสู้ได้", () => {
    const { player, enemy } = createCharacters();
    const battle = createBattle(player, enemy, {
        firstRolls: [18],
        secondRolls: [12]
    });

    assert.equal(battle.status, "active");
    assert.deepEqual(battle.orderedCharacters.map(c => c.name), [
        "Noctis",
        "Slime"
    ]);
});

// 2. เริ่มเทิร์นแล้ว COST +1
test("เริ่มเทิร์นแล้ว COST เพิ่มหนึ่ง", () => {
    const { player, enemy } = createCharacters();
    const battle = createBattle(player, enemy, {
        firstRolls: [18],
        secondRolls: [12]
    });

    const result = startTurn(battle);

    assert.equal(result.character, "Noctis");
    assert.equal(player.cost, 4);
});

// 3. โจมตีสำเร็จแล้วเพิ่ม COST และรับดาเมจแล้วเพิ่ม COST
test("โจมตีและรับดาเมจเพิ่ม COST ถูกต้อง", () => {
    const { player, enemy } = createCharacters();
    const battle = createBattle(player, enemy, {
        firstRolls: [18],
        secondRolls: [12]
    });

    startTurn(battle);

    const result = performAction(battle, { type: "normal" }, {
        attackerRolls: [15],
        defenderRolls: [10],
        damageRolls: [5]
    });

    assert.equal(result.success, true);
    assert.equal(player.cost, 5); // เริ่มเทิร์น +1 และโจมตีโดน +1
    assert.equal(enemy.cost, 4);  // ได้รับดาเมจ +1
});

// 4. ไม่อนุญาตให้กระทำซ้ำในเทิร์นเดียว
test("ไม่สามารถโจมตีสองครั้งด้วยคำสั่งปกติในเทิร์นเดียว", () => {
    const { player, enemy } = createCharacters();
    const battle = createBattle(player, enemy, {
        firstRolls: [18],
        secondRolls: [12]
    });

    startTurn(battle);

    performAction(battle, { type: "normal" }, {
        attackerRolls: [15],
        defenderRolls: [10],
        damageRolls: [5]
    });

    const second = performAction(battle, { type: "normal" }, {
        attackerRolls: [15],
        defenderRolls: [10],
        damageRolls: [5]
    });

    assert.equal(second.success, false);
});

// 5. ใช้สกิลแล้วหัก COST
test("ใช้สกิลแล้วหัก COST ตามที่กำหนด", () => {
    const { player, enemy } = createCharacters();
    const battle = createBattle(player, enemy, {
        firstRolls: [18],
        secondRolls: [12]
    });

    startTurn(battle);

    const result = performAction(battle, { type: "skill", cost: 2 }, {
        attackerRolls: [15],
        defenderRolls: [10],
        damageRolls: [5]
    });

    assert.equal(result.success, true);
    assert.equal(player.cost, 3); // เริ่ม 3 +1 เทิร์น -2 สกิล +1 โจมตีโดน
});

// 6. COST ไม่พอ ต้องไม่หักและไม่ใช้เทิร์น
test("COST ไม่พอแล้วไม่ดำเนินการ", () => {
    const { player, enemy } = createCharacters();
    player.cost = 0;

    const battle = createBattle(player, enemy, {
        firstRolls: [18],
        secondRolls: [12]
    });

    startTurn(battle);

    const result = performAction(battle, { type: "skill", cost: 5 });

    assert.equal(result.success, false);
    assert.equal(player.cost, 1);
    assert.equal(battle.currentTurn.actionTaken, false);
});

console.log("\nBattle Controller tests passed.");


test("เมื่อศัตรูพ่ายแพ้ การต่อสู้จบทันที", () => {
    const { player, enemy } = createCharacters();

    enemy.hp = 1;

    const battle = createBattle(player, enemy, {
        firstRolls: [18],
        secondRolls: [12]
    });

    startTurn(battle);

    const result = performAction(
        battle,
        { type: "normal" },
        {
            attackerRolls: [20],
            defenderRolls: [5],
            damageRolls: [8]
        }
    );

    assert.equal(result.success, true);
    assert.equal(enemy.hp, 0);
    assert.equal(battle.status, "finished");
    assert.equal(result.winner, player.name);
    assert.equal(battle.currentTurn, null);

    const nextTurn = startTurn(battle);
    assert.equal(nextTurn.success, false);

    const endResult = endTurn(battle);
    assert.equal(endResult.success, false);
});

test("หากไม่มีเทิร์นปัจจุบัน จะไม่สามารถจบเทิร์นได้", () => {
    const { player, enemy } = createCharacters();

    const battle = createBattle(player, enemy, {
        firstRolls: [18],
        secondRolls: [12]
    });

    const result = endTurn(battle);

    assert.equal(result.success, false);
    assert.equal(battle.turnIndex, 0);
});
