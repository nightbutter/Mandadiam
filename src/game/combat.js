const {
    onAttackHit,
    onAttackDamageTaken
} = require("./cost");
/**
 * RPG Combat Engine
 * ระบบคำนวณดาเมจและตัดสินผลการต่อสู้
 */

function rollDice(sides) {
    return Math.floor(Math.random() * sides) + 1;
}

// คำนวณดาเมจพื้นฐาน
// type: "normal" หรือ "skill"
// options.roll ใช้กำหนดผล d8 สำหรับทดสอบ
function calculateDamage(attacker, defender, options = {}) {
    const type = options.type || "normal";
    const roll = options.roll ?? rollDice(8);

    if (!Number.isInteger(roll) || roll < 1 || roll > 8) {
        throw new Error("ผลเต๋า d8 ต้องอยู่ระหว่าง 1 ถึง 8");
    }

    const atk = attacker.atk ?? 0;
    const spe = type === "skill" ? (attacker.spe ?? 0) : 0;
    const def = defender.def ?? 0;
    const rawDamage = roll + atk + spe;

    const damage = roll === 8
        ? rawDamage * 2 - def
        : rawDamage - def;

    return {
        roll,
        critical: roll === 8,
        damage: Math.max(0, damage)
    };
}

// อ่านผลเต๋าที่กำหนดไว้สำหรับการทดสอบ
function getRoll(sides, rolls, index) {
    const value = rolls && index < rolls.length
        ? rolls[index]
        : rollDice(sides);

    if (!Number.isInteger(value) || value < 1 || value > sides) {
        throw new Error(`ผลเต๋า d${sides} ต้องอยู่ระหว่าง 1 ถึง ${sides}`);
    }

    return value;
}

// ทอย d20 แข่งขันกัน หากเสมอให้ทั้งคู่ทอยใหม่
function resolveContest(options = {}) {
    let attackerIndex = 0;
    let defenderIndex = 0;
    let rerolls = 0;

    while (true) {
        const attackerRoll = getRoll(
            20, options.attackerRolls, attackerIndex++
        );

        const defenderRoll = getRoll(
            20, options.defenderRolls, defenderIndex++
        );

        if (attackerRoll === defenderRoll) {
            rerolls++;

            // ป้องกันการทดสอบที่กำหนดผลเสมอซ้ำไม่สิ้นสุด
            if (
                options.attackerRolls &&
                options.defenderRolls &&
                (attackerIndex >= options.attackerRolls.length ||
                    defenderIndex >= options.defenderRolls.length)
            ) {
                throw new Error(
                    "ผล d20 เสมอ แต่ไม่มีผลเต๋าสำหรับทอยรอบถัดไป"
                );
            }

            continue;
        }

        return {
            attackerRoll,
            defenderRoll,
            winner: attackerRoll > defenderRoll
                ? "attacker"
                : "defender",
            rerolls
        };
    }
}

/**
 * กำหนดลำดับเทิร์นตอนเริ่มต่อสู้
 * หาก d20 เสมอ จะทอยใหม่ทั้งคู่
 */
function determineTurnOrder(first, second, options = {}) {
    const result = resolveContest({
        attackerRolls: options.firstRolls,
        defenderRolls: options.secondRolls
    });

    const firstGoesFirst = result.winner === "attacker";

    return {
        first: first.name,
        second: second.name,
        firstRoll: result.attackerRoll,
        secondRoll: result.defenderRoll,
        rerolls: result.rerolls,
        order: firstGoesFirst
            ? [first.name, second.name]
            : [second.name, first.name]
    };
}

// สร้างดาเมจหนึ่งครั้ง
function calculateHitDamage(attacker, defender, roll, type, doubled) {
    const atk = attacker.atk ?? 0;
    const spe = type === "skill" ? (attacker.spe ?? 0) : 0;
    const def = defender.def ?? 0;
    const rawDamage = roll + atk + spe;

    // การโจมตีพิเศษจาก d20 = 20:
    // ครั้งแรกคูณ 2 และไม่คูณ Critical ซ้ำ
    if (doubled) {
        return {
            roll,
            critical: false,
            damage: Math.max(0, rawDamage * 2 - def)
        };
    }

    return calculateDamage(attacker, defender, {
        type,
        roll
    });
}

// ตัดสินผลการโจมตี รวมโจมตีสองครั้งและสะท้อนดาเมจ
function resolveAttack(attacker, defender, options = {}) {
    if (attacker.hp <= 0) {
        return {
            success: false,
            message: `${attacker.name} ไม่สามารถโจมตีได้`
        };
    }

    if (defender.hp <= 0) {
        return {
            success: false,
            message: `${defender.name} พ่ายแพ้ไปแล้ว`
        };
    }

    const contest = resolveContest(options);

    // ผู้ป้องกันชนะด้วย d20 = 20: สะท้อนดาเมจ
    if (contest.winner === "defender" && contest.defenderRoll === 20) {
        const reflectRoll = getRoll(8, options.reflectRolls, 0);
        const reflectDamage = Math.max(
            0,
            reflectRoll + (defender.def ?? 0) - (attacker.def ?? 0)
        );

        attacker.hp = Math.max(0, attacker.hp - reflectDamage);
        onAttackDamageTaken(attacker, reflectDamage);

        return {
            success: true,
            outcome: "reflected",
            ...contest,
            attacker: attacker.name,
            defender: defender.name,
            reflectRoll,
            damage: reflectDamage,
            remainingHp: attacker.hp,
            defeated: attacker.hp === 0
        };
    }

    // ผู้โจมตีชนะ: ถ้า d20 = 20 จะโจมตีสองครั้ง
    const doubleAttack = contest.attackerRoll === 20;
    const hitCount = doubleAttack ? 2 : 1;
    const hits = [];
    let totalDamage = 0;

    for (let i = 0; i < hitCount; i++) {
        const roll = getRoll(8, options.damageRolls, i);

        const hit = calculateHitDamage(
            attacker,
            defender,
            roll,
            options.type || "normal",
            doubleAttack && i === 0
        );

        defender.hp = Math.max(0, defender.hp - hit.damage);
        totalDamage += hit.damage;
        hits.push(hit);

        // ผู้โจมตีได้ COST สูงสุด +1 ต่อเทิร์นโจมตี
        if (hit.damage > 0) {
            onAttackHit(attacker, options.turnState ?? (
                options.turnState = { attackCostGranted: false }
            ));
        }

        // ผู้ป้องกันได้ COST +1 เมื่อได้รับดาเมจจริงในแต่ละครั้ง
        onAttackDamageTaken(defender, hit.damage);

        // จบการโจมตีทันทีหากเป้าหมายพ่ายแพ้
        if (defender.hp <= 0) {
            break;
        }
    }

    return {
        success: true,
        outcome: doubleAttack ? "double_attack" : "hit",
        ...contest,
        attacker: attacker.name,
        defender: defender.name,
        hits,
        damage: totalDamage,
        remainingHp: defender.hp,
        defeated: defender.hp === 0
    };
}

// ฟังก์ชันโจมตีเดิม คงไว้เพื่อรองรับ test เก่า
function attack(attacker, defender, options = {}) {
    if (attacker.hp <= 0) {
        return {
            success: false,
            message: `${attacker.name} ไม่สามารถโจมตีได้`
        };
    }

    if (defender.hp <= 0) {
        return {
            success: false,
            message: `${defender.name} พ่ายแพ้ไปแล้ว`
        };
    }

    const result = calculateDamage(attacker, defender, options);
    defender.hp = Math.max(0, defender.hp - result.damage);

    return {
        success: true,
        attacker: attacker.name,
        defender: defender.name,
        roll: result.roll,
        critical: result.critical,
        damage: result.damage,
        remainingHp: defender.hp,
        defeated: defender.hp === 0
    };
}


module.exports = {
    rollDice,
    calculateDamage,
    attack,
    resolveContest,
    resolveAttack,
    determineTurnOrder
};

