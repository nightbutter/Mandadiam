
const { determineTurnOrder, resolveAttack } = require("./combat");
const { resolveExAttack } = require("./exCombat");
const { onTurnStart, spendCost } = require("./cost");
const { consumeEx, EX_MAX } = require("./exGauge");

function createBattle(first, second, options = {}) {
    if (!first || !second || first === second) {
        throw new Error("ต้องมีตัวละครสองตัวที่แตกต่างกัน");
    }

    for (const character of [first, second]) {
        if (!Number.isFinite(character.hp) || character.hp <= 0) {
            throw new Error(`${character.name} ต้องมี HP มากกว่า 0`);
        }

        if (!Number.isInteger(character.cost ?? 0) ||
            (character.cost ?? 0) < 0 ||
            (character.cost ?? 0) > 6) {
            throw new Error(`${character.name} ต้องมี COST ระหว่าง 0 ถึง 6`);
        }

        character.cost ??= 0;
        // EX gauge is transient battle state, like cost.
        character.ex ??= 0;
        // Per-skill cooldown counters (skillKey → remaining own
        // turns), transient like cost/ex — fresh every battle.
        character.cooldowns ??= {};
    }

    const initiative = determineTurnOrder(first, second, options);
    const characters = [first, second];
    const orderedCharacters = initiative.order.map(name =>
        characters.find(character => character.name === name)
    );

    return {
        characters,
        initiative,
        orderedCharacters,
        turnIndex: 0,
        turnNumber: 0,
        status: "active",
        currentTurn: null
    };
}

function getOpponent(battle, character) {
    return battle.characters.find(target => target !== character);
}


function updateBattleStatus(battle) {
    const living = battle.characters.filter(character => character.hp > 0);

    if (living.length <= 1) {
        battle.status = "finished";
        battle.winner = living[0]?.name ?? null;
        battle.currentTurn = null;

        return {
            finished: true,
            winner: battle.winner
        };
    }

    return {
        finished: false,
        winner: null
    };
}


function startTurn(battle) {
    if (battle.status !== "active") {
        return { success: false, message: "การต่อสู้สิ้นสุดแล้ว" };
    }

    if (battle.currentTurn) {
        return { success: false, message: "เทิร์นปัจจุบันเริ่มไปแล้ว" };
    }

    // ข้ามตัวละครที่พ่ายแพ้
    let character = battle.orderedCharacters[battle.turnIndex];

    if (!character || character.hp <= 0) {
        const living = battle.orderedCharacters.filter(target => target.hp > 0);

        if (living.length <= 1) {
            battle.status = "finished";
            return {
                success: false,
                message: "การต่อสู้สิ้นสุดแล้ว",
                winner: living[0]?.name ?? null
            };
        }

        battle.turnIndex = battle.orderedCharacters.findIndex(
            target => target.hp > 0
        );
        character = battle.orderedCharacters[battle.turnIndex];
    }

    battle.turnNumber += 1;
    const costResult = onTurnStart(character);

    battle.currentTurn = {
        character,
        attackCostGranted: false,
        actionTaken: false
    };

    return {
        success: true,
        turnNumber: battle.turnNumber,
        character: character.name,
        cost: costResult
    };
}

function performAction(battle, action, options = {}) {
    if (battle.status !== "active") {
        return { success: false, message: "การต่อสู้สิ้นสุดแล้ว" };
    }

    const turn = battle.currentTurn;

    if (!turn) {
        return { success: false, message: "ต้องเริ่มเทิร์นก่อน" };
    }

    if (turn.actionTaken) {
        return { success: false, message: "ตัวละครใช้การกระทำในเทิร์นนี้แล้ว" };
    }

    const attacker = turn.character;
    const defender = getOpponent(battle, attacker);

    if (attacker.hp <= 0 || defender.hp <= 0) {
        return { success: false, message: "ตัวละครฝ่ายใดฝ่ายหนึ่งพ่ายแพ้แล้ว" };
    }

    if (action.type !== "normal" && action.type !== "skill") {
        return { success: false, message: "ประเภทการกระทำไม่ถูกต้อง" };
    }

    let skillCost = null;

    if (action.type === "skill") {
        if (!Number.isInteger(action.cost) || action.cost < 0) {
            return { success: false, message: "ต้องระบุค่า COST ของสกิลเป็นจำนวนเต็มไม่ติดลบ" };
        }

        skillCost = spendCost(attacker, action.cost);

        if (!skillCost.success) {
            return {
                success: false,
                message: skillCost.message,
                cost: attacker.cost
            };
        }
    }

    const result = resolveAttack(attacker, defender, {
        ...options,
        type: action.type,
        turnState: turn
    });

    if (!result.success) {
        // คืน COST หากการโจมตีถูกปฏิเสธหลังจากหักค่าสกิล
        if (skillCost?.success) {
            attacker.cost = Math.min(6, attacker.cost + skillCost.spent);
        }

        return result;
    }

    turn.actionTaken = true;

    const battleStatus = updateBattleStatus(battle);

    return {
        ...result,
        skillCost: skillCost?.spent ?? 0,
        attackerCost: attacker.cost,
        defenderCost: defender.cost,
        status: battle.status,
        winner: battleStatus.winner
    };
}


// EX/Ultimate action — same lifecycle as performAction: gate, spend
// COST once, consume the gauge, resolve through exCombat, refund both
// resources if resolution fails, mark the action and update status.
// The service layer validates EX-specific conditions (ownership,
// gauge, target) before calling this.
function performExAction(battle, exDef, options = {}) {
    if (battle.status !== "active") {
        return { success: false, message: "การต่อสู้สิ้นสุดแล้ว" };
    }

    const turn = battle.currentTurn;

    if (!turn) {
        return { success: false, message: "ต้องเริ่มเทิร์นก่อน" };
    }

    if (turn.actionTaken) {
        return { success: false, message: "ตัวละครใช้การกระทำในเทิร์นนี้แล้ว" };
    }

    const attacker = turn.character;
    const defender = getOpponent(battle, attacker);

    if (attacker.hp <= 0 || defender.hp <= 0) {
        return { success: false, message: "ตัวละครฝ่ายใดฝ่ายหนึ่งพ่ายแพ้แล้ว" };
    }

    if (attacker.ex !== EX_MAX) {
        return { success: false, message: "เกจ EX ยังไม่เต็ม" };
    }

    if (!Number.isInteger(exDef?.cost) || exDef.cost < 0) {
        return { success: false, message: "ค่า COST ของ EX ไม่ถูกต้อง" };
    }

    const costSpend = spendCost(attacker, exDef.cost);

    if (!costSpend.success) {
        return {
            success: false,
            message: costSpend.message,
            cost: attacker.cost
        };
    }

    // Consume the gauge before resolving; if resolution is rejected
    // afterwards, both COST and the gauge are restored — a rejected
    // activation never consumes resources.
    consumeEx(attacker);

    const result = resolveExAttack(attacker, defender, exDef, {
        ...options,
        turnState: turn
    });

    if (!result.success) {
        attacker.cost = Math.min(6, attacker.cost + costSpend.spent);
        attacker.ex = EX_MAX;
        return result;
    }

    turn.actionTaken = true;

    const battleStatus = updateBattleStatus(battle);

    return {
        ...result,
        exCost: costSpend.spent,
        attackerCost: attacker.cost,
        defenderCost: defender.cost,
        status: battle.status,
        winner: battleStatus.winner
    };
}

function endTurn(battle) {
    if (battle.status !== "active") {
        battle.currentTurn = null;

        return {
            success: false,
            message: "การต่อสู้สิ้นสุดแล้ว",
            winner: battle.winner ?? null
        };
    }

    if (!battle.currentTurn) {
        return {
            success: false,
            message: "ไม่มีเทิร์นที่กำลังดำเนินอยู่"
        };
    }

    const status = updateBattleStatus(battle);

    if (status.finished) {
        return {
            success: false,
            message: "การต่อสู้สิ้นสุดแล้ว",
            winner: status.winner
        };
    }

    // Tick the departing fighter's skill cooldowns — each counter is
    // "remaining own turns until ready". Ticking at end-of-own-turn
    // means a skill just used this turn keeps its full count.
    const actor = battle.currentTurn.character;

    if (actor.cooldowns) {
        for (const key of Object.keys(actor.cooldowns)) {
            actor.cooldowns[key] = Math.max(0, actor.cooldowns[key] - 1);
        }
    }

    battle.turnIndex =
        (battle.turnIndex + 1) % battle.orderedCharacters.length;

    battle.currentTurn = null;

    return {
        success: true,
        nextTurn: true
    };
}

module.exports = {
    createBattle,
    startTurn,
    performAction,
    performExAction,
    endTurn
};
