const assert = require("node:assert/strict");
const bs = require("../../src/game/services/battleService");
const driver = require("../helpers/rollDriver");

console.log("=== Battle Service Tests ===");

function test(title, run) {
    try {
        run();
        console.log(`PASS: ${title}`);
    } finally {
        cleanup();
    }
}

// Wipe all in-memory state between tests.
function cleanup() {
    for (const s of ["c1", "c2", "chan"]) {
        const session = bs.getSession(s);
        if (session) {
            bs.forfeit(session, session.players[0].discordId);
        }
        bs.cancelChallenge(s, "x");
        bs.cancelChallenge(s, "u1");
        bs.cancelChallenge(s, "u2");
    }
}

function player(id, name, stats = {}) {
    return {
        discordId: id,
        character: {
            name,
            hp: stats.hp ?? 100,
            maxHp: stats.hp ?? 100,
            atk: stats.atk ?? 20,
            def: stats.def ?? 5,
            spe: stats.spe ?? 4,
            cost: 0
        }
    };
}

// Fresh character objects per session — createBattle does not clone,
// and hp/cost are mutated in place during play.
function startSession(channelId = "c1") {
    return driver.start(
        channelId,
        player("u1", "Noctis"),
        player("u2", "Slime"),
        { firstRolls: [18], secondRolls: [12] }
    );
}

// --- challenges ---

test("issue challenge succeeds", () => {
    const r = bs.issueChallenge({
        channelId: "c1", challengerId: "u1", opponentId: "u2"
    });
    assert(r.ok);
});

test("self challenge rejected", () => {
    const r = bs.issueChallenge({
        channelId: "c1", challengerId: "u1", opponentId: "u1"
    });
    assert.equal(r.error, "self_challenge");
});

test("second pending in same channel rejected", () => {
    bs.issueChallenge({ channelId: "c1", challengerId: "u1", opponentId: "u2" });
    const r = bs.issueChallenge({
        channelId: "c1", challengerId: "u3", opponentId: "u4"
    });
    assert.equal(r.error, "channel_busy");
});

test("busy player cannot be challenged", () => {
    bs.issueChallenge({ channelId: "c1", challengerId: "u1", opponentId: "u2" });
    const r = bs.issueChallenge({
        channelId: "c2", challengerId: "u3", opponentId: "u2"
    });
    assert.equal(r.error, "opponent_busy");
});

test("expired challenge cannot be accepted", () => {
    bs.issueChallenge({
        channelId: "c1", challengerId: "u1", opponentId: "u2", ttlMs: -1
    });
    const r = bs.acceptChallenge({ channelId: "c1", userId: "u2" });
    assert.equal(r.error, "expired");
});

test("non-opponent cannot accept", () => {
    bs.issueChallenge({ channelId: "c1", challengerId: "u1", opponentId: "u2" });
    const r = bs.acceptChallenge({ channelId: "c1", userId: "u3" });
    assert.equal(r.error, "not_opponent");
});

test("opponent accepts and challenge is consumed", () => {
    bs.issueChallenge({ channelId: "c1", challengerId: "u1", opponentId: "u2" });
    const r = bs.acceptChallenge({ channelId: "c1", userId: "u2" });
    assert(r.ok);
    assert.equal(
        bs.acceptChallenge({ channelId: "c1", userId: "u2" }).error,
        "no_challenge"
    );
});

test("challenger can withdraw pending challenge", () => {
    bs.issueChallenge({ channelId: "c1", challengerId: "u1", opponentId: "u2" });
    const r = bs.cancelChallenge("c1", "u1");
    assert(r.ok && r.role === "challenger");
});

// --- battle flow ---

test("startBattle begins first turn for initiative winner", () => {
    const { session, firstTurn } = startSession();
    assert(firstTurn.success);
    assert.equal(firstTurn.character, "Noctis");
    assert.equal(bs.currentTurnPlayer(session).discordId, "u1");
});

test("non-participant and out-of-turn attacks rejected", () => {
    const { session } = startSession();
    assert.equal(bs.attack(session, "u9").error, "not_participant");
    assert.equal(bs.attack(session, "u2").error, "not_your_turn");
});

test("normal attack applies damage and COST", () => {
    const { session } = startSession();
    const r = driver.attack(session, "u1", {
        attackerRolls: [15], defenderRolls: [10], damageRolls: [5]
    });
    assert(r.ok && !r.finished);
    assert.equal(r.result.outcome, "hit");
    assert.equal(r.result.damage, 20); // 5 + 20 atk - 5 def
    assert.equal(session.battle.characters[1].hp, 80);
    assert.equal(r.result.attackerCost, 2); // turn start +1, attack +1
    assert.equal(r.result.defenderCost, 1); // damage taken +1
    assert.equal(bs.currentTurnPlayer(session).discordId, "u2");
});

test("double attack on attacker d20 = 20", () => {
    const { session } = startSession();
    const r = driver.attack(session, "u1", {
        attackerRolls: [20], defenderRolls: [10], damageRolls: [5, 4]
    });
    assert.equal(r.result.outcome, "double_attack");
    assert.equal(r.result.hits.length, 2);
});

test("reflect on defender d20 = 20", () => {
    const { session } = startSession();
    const r = driver.attack(session, "u1", {
        attackerRolls: [12], defenderRolls: [20], reflectRolls: [6]
    });
    assert.equal(r.result.outcome, "reflected");
    assert.equal(r.result.damage, 6 + 5 - 5); // reflect d8 + def - def
    assert.equal(session.battle.characters[0].hp, 94);
});

test("attack finishing the battle reports winner", () => {
    const { session } = driver.start(
        "c1", player("u1", "Noctis"), player("u2", "Slime", { hp: 1 }),
        { firstRolls: [18], secondRolls: [12] }
    );
    const r = driver.attack(session, "u1", {
        attackerRolls: [15], defenderRolls: [10], damageRolls: [8]
    });
    assert(r.finished);
    assert.equal(r.winner, "Noctis");
    assert.equal(bs.getSession("c1"), null);
});

test("attack after finish and forfeit rules", () => {
    const { session } = startSession();
    const f = bs.forfeit(session, "u1");
    assert(f.ok && f.winner.character.name === "Slime");
    assert.equal(bs.attack(session, "u1").error, "finished");
});

test("non-participant cannot forfeit", () => {
    const { session } = startSession();
    assert.equal(bs.forfeit(session, "u9").error, "not_participant");
});

console.log("\nBattle service tests passed.");
