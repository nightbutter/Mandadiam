
const assert = require("node:assert/strict");
const {
    addCost,
    onTurnStart,
    onAttackHit,
    onAttackDamageTaken,
    spendCost
} = require("../../src/game/cost");

console.log("=== COST System Tests ===");

// 1. เริ่มเทิร์นได้ COST +1
const a = { cost: 2 };
onTurnStart(a);
assert.equal(a.cost, 3);
console.log("PASS: เริ่มเทิร์น COST +1");

// 2. COST ต้องไม่เกิน 6
const b = { cost: 6 };
addCost(b, 1);
assert.equal(b.cost, 6);
console.log("PASS: COST ไม่เกิน 6");

// 3. โจมตีสองครั้งนับ COST เพียงครั้งเดียว
const c = { cost: 2 };
const turn = { attackCostGranted: false };
onAttackHit(c, turn);
onAttackHit(c, turn);
assert.equal(c.cost, 3);
console.log("PASS: โจมตีหลายครั้งได้ COST รวม +1");

// 4. Critical ก็ใช้กติกาเดียวกัน
const d = { cost: 2 };
const criticalTurn = { attackCostGranted: false };
onAttackHit(d, criticalTurn);
assert.equal(d.cost, 3);
console.log("PASS: Critical ไม่ให้ COST เพิ่มพิเศษ");

// 5. ได้รับดาเมจ เพิ่ม COST +1
const e = { cost: 1 };
onAttackDamageTaken(e, 10);
assert.equal(e.cost, 2);
console.log("PASS: ได้รับดาเมจ COST +1");

// 6. ไม่ได้รับดาเมจจริง ไม่เพิ่ม COST
onAttackDamageTaken(e, 0);
assert.equal(e.cost, 2);
console.log("PASS: ดาเมจ 0 ไม่เพิ่ม COST");

// 7. ใช้สกิลและหัก COST
const f = { cost: 5 };
const skill = spendCost(f, 3);
assert.equal(skill.success, true);
assert.equal(f.cost, 2);
console.log("PASS: ใช้สกิลหัก COST ถูกต้อง");

// 8. COST ไม่พอใช้สกิล
const g = { cost: 1 };
const failedSkill = spendCost(g, 2);
assert.equal(failedSkill.success, false);
assert.equal(g.cost, 1);
console.log("PASS: COST ไม่พอและไม่ถูกหัก");

console.log("\nCOST tests passed.");
