
const assert = require("node:assert/strict");
const { determineTurnOrder } = require("../../src/game/combat");

const player = { name: "Noctis" };
const enemy = { name: "Slime" };

function test(title, callback) {
    callback();
    console.log(`PASS: ${title}`);
}

console.log("=== Turn Order Tests ===");

// 1. ผู้เล่นทอยได้มากกว่า จึงเริ่มก่อน
test("ผู้เล่นได้แต้มสูงกว่า", () => {
    const result = determineTurnOrder(player, enemy, {
        firstRolls: [18],
        secondRolls: [12]
    });

    assert.deepEqual(result.order, ["Noctis", "Slime"]);
    assert.equal(result.firstRoll, 18);
    assert.equal(result.secondRoll, 12);
    assert.equal(result.rerolls, 0);
});

// 2. ศัตรูได้แต้มสูงกว่า จึงเริ่มก่อน
test("ศัตรูได้แต้มสูงกว่า", () => {
    const result = determineTurnOrder(player, enemy, {
        firstRolls: [8],
        secondRolls: [15]
    });

    assert.deepEqual(result.order, ["Slime", "Noctis"]);
});

// 3. แต้มเสมอ ทั้งคู่ต้องทอยใหม่
test("แต้มเสมอแล้วทอยใหม่ทั้งคู่", () => {
    const result = determineTurnOrder(player, enemy, {
        firstRolls: [10, 17],
        secondRolls: [10, 12]
    });

    assert.equal(result.rerolls, 1);
    assert.equal(result.firstRoll, 17);
    assert.equal(result.secondRoll, 12);
    assert.deepEqual(result.order, ["Noctis", "Slime"]);
});

// 4. เสมอสองรอบก่อนตัดสินผู้เริ่ม
test("เสมอสองรอบแล้วทอยใหม่อีกครั้ง", () => {
    const result = determineTurnOrder(player, enemy, {
        firstRolls: [10, 14, 19],
        secondRolls: [10, 14, 11]
    });

    assert.equal(result.rerolls, 2);
    assert.deepEqual(result.order, ["Noctis", "Slime"]);
});

console.log("\nการทดสอบลำดับเทิร์นทั้งหมดผ่าน");
