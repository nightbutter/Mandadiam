
const { determineTurnOrder, resolveAttack } = require("./combat");
const { onTurnStart, spendCost } = require("./cost");

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
    endTurn
};
