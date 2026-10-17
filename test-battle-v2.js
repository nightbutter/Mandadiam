
const assert = require("node:assert/strict");
const { determineTurnOrder, resolveAttack } = require("./combat");

const player = {
    name: "Noctis",
    hp: 100,
    atk: 20,
    def: 5
};

const enemy = {
    name: "Slime",
    hp: 50,
    atk: 8,
    def: 7
};

console.log("=== BATTLE V2 TEST ===");

// ทดสอบลำดับเทิร์น
const turnOrder = determineTurnOrder(player, enemy, {
    firstRolls: [18],
    secondRolls: [12]
});

assert.deepEqual(turnOrder.order, ["Noctis", "Slime"]);
console.log("PASS: กำหนดลำดับเทิร์น");

// Noctis โจมตี Slime และชนะการทอย d20
const playerAttack = resolveAttack(player, enemy, {
    attackerRolls: [15],
    defenderRolls: [10],
    damageRolls: [5]
});

assert.equal(playerAttack.outcome, "hit");
assert.equal(playerAttack.damage, 18);
assert.equal(enemy.hp, 32);
console.log("PASS: โจมตีด้วย d20 และลด HP ถูกต้อง");

// Slime โจมตี Noctis และชนะการทอย d20
const enemyAttack = resolveAttack(enemy, player, {
    attackerRolls: [15],
    defenderRolls: [10],
    damageRolls: [4]
});

assert.equal(enemyAttack.outcome, "hit");
assert.equal(enemyAttack.damage, 7);
assert.equal(player.hp, 93);
console.log("PASS: ศัตรูโจมตีกลับและลด HP ถูกต้อง");

// ทดสอบว่าผู้ที่ HP หมดแล้วไม่สามารถโจมตีได้
enemy.hp = 0;

const defeatedAttack = resolveAttack(player, enemy, {
    attackerRolls: [15],
    defenderRolls: [10],
    damageRolls: [5]
});

assert.equal(defeatedAttack.success, false);
assert.equal(enemy.hp, 0);
console.log("PASS: ไม่สามารถโจมตีเป้าหมายที่พ่ายแพ้แล้ว");

console.log("\nBattle V2 tests passed.");
