
/**
 * RPG COST System
 * COST ต่ำสุด 0 สูงสุด 6
 */

const MAX_COST = 6;
const MIN_COST = 0;

// เพิ่ม COST โดยไม่เกินเพดาน
function addCost(character, amount = 1) {
    if (!Number.isInteger(amount) || amount < 0) {
        throw new Error("จำนวน COST ที่เพิ่มต้องเป็นจำนวนเต็มไม่ติดลบ");
    }

    const current = character.cost ?? 0;

    if (!Number.isInteger(current) || current < MIN_COST || current > MAX_COST) {
        throw new Error("COST ปัจจุบันต้องอยู่ระหว่าง 0 ถึง 6");
    }

    const before = current;
    character.cost = Math.min(MAX_COST, current + amount);

    return {
        before,
        gained: character.cost - before,
        cost: character.cost
    };
}

// เริ่มเทิร์น: COST +1
function onTurnStart(character) {
    return addCost(character, 1);
}

// โจมตีโดน: COST +1 ต่อเทิร์นของผู้โจมตี
// แม้โจมตีสองครั้งหรือ Critical ก็เพิ่มรวมเพียงครั้งเดียว
function onAttackHit(character, turnState) {
    if (turnState.attackCostGranted) {
        return {
            before: character.cost ?? 0,
            gained: 0,
            cost: character.cost ?? 0
        };
    }

    turnState.attackCostGranted = true;
    return addCost(character, 1);
}

// ได้รับดาเมจจากการโจมตี: COST +1 ต่อเหตุการณ์
function onAttackDamageTaken(character, damage) {
    if (!Number.isFinite(damage) || damage < 0) {
        throw new Error("ดาเมจต้องเป็นตัวเลขที่ไม่ติดลบ");
    }

    if (damage === 0) {
        return {
            before: character.cost ?? 0,
            gained: 0,
            cost: character.cost ?? 0
        };
    }

    return addCost(character, 1);
}

// ใช้สกิล: หัก COST ตามค่าใช้จ่าย
function spendCost(character, amount) {
    if (!Number.isInteger(amount) || amount < 0) {
        throw new Error("ค่า COST ของสกิลต้องเป็นจำนวนเต็มไม่ติดลบ");
    }

    const current = character.cost ?? 0;

    if (!Number.isInteger(current) || current < MIN_COST || current > MAX_COST) {
        throw new Error("COST ปัจจุบันต้องอยู่ระหว่าง 0 ถึง 6");
    }

    if (current < amount) {
        return {
            success: false,
            cost: current,
            message: "COST ไม่เพียงพอ"
        };
    }

    character.cost = current - amount;

    return {
        success: true,
        spent: amount,
        cost: character.cost
    };
}

module.exports = {
    MAX_COST,
    MIN_COST,
    addCost,
    onTurnStart,
    onAttackHit,
    onAttackDamageTaken,
    spendCost
};
