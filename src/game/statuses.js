// Status Effect engine — runtime instances live on the battle
// character (`character.statuses`) exactly like cost/ex/cooldowns:
// transient, in-memory, gone on restart.
//
// Model:
//   Definition  — catalog row (key, behavior, power, policy, …).
//   Rule        — per-character application config scoped to
//                 character | attack | skill:<key> | ex:<key>.
//   Instance    — an applied effect: a SNAPSHOT of the definition
//                 at application time plus remainingTurns/stacks/
//                 source. Admin edits never mutate live instances.
//
// Tick timing: the START of the owner's turn, in this order:
//   1. periodic damage (power × stacks)
//   2. skip-turn check (a still-active skip_turn consumes the turn)
//   3. duration decrement; instance expires at 0
// A rule with duration N therefore affects exactly N owner turns.
//
// Effective stats: ATK/DEF modifiers are applied through a Proxy
// view (effView) used by resolveAttack/resolveExAttack/preview paths
// — base stats on the character are never mutated.

const REAPPLY_POLICIES = new Set([
    "refresh_duration",
    "stack_intensity",
    "replace_if_stronger",
    "ignore_if_active",
    "replace_duration"
]);

const BEHAVIORS = new Set([
    "periodic_damage",
    "skip_turn",
    "modify_atk",
    "modify_def"
]);

const SCOPES = new Set(["character", "attack", "skill", "ex"]);
const TIMINGS = new Set(["per_action", "per_hit"]);

// Which scope bucket a combat action falls into.
function actionScope(actionType, actionKey) {
    if (actionType === "skill") return { scope: "skill", key: actionKey };
    if (actionType === "ex") return { scope: "ex", key: actionKey };
    return { scope: "attack", key: "" };
}

function scopeRank(rule, scope, key) {
    if (rule.scope === scope && rule.action_key === key) return 3;
    if (rule.scope === scope && !rule.action_key) return 2;
    if (rule.scope === "character" && !rule.action_key) return 1;
    return 0;
}

// Resolve the governing rules for one action, one rule per status —
// the most specific matching scope wins outright (skill/ex key >
// attack > character fallback). A disabled winner suppresses the
// status for that action; rules never combine across scopes.
// Deterministic application order: definition id ascending.
function rulesForAction(rules, action) {
    if (!Array.isArray(rules) || !rules.length) {
        return [];
    }

    const { scope, key } = actionScope(action.type, action.key);
    const byStatus = new Map();

    for (const rule of rules) {
        const rank = scopeRank(rule, scope, key);
        const id = rule.status_id;

        if (rank === 0) {
            continue;
        }

        const prev = byStatus.get(id);
        if (!prev || rank > prev.rank) {
            byStatus.set(id, { rank, rule });
        }
    }

    return [...byStatus.values()]
        .sort(
            (a, b) =>
                a.rule.status_id - b.rule.status_id ||
                a.rule.id - b.rule.id
        )
        .map(entry => entry.rule);
}

// Optional rule conditions — only known keys are honored; anything
// else fails validation upstream, so unknown keys here are ignored.
// `*_at_or_below_pct` uses the same "≤ threshold" convention as the
// skill conditions (piercing/desperation).
function conditionsMet(rule, attacker, defender) {
    const c = rule.conditions ?? {};

    if (
        c.target_hp_at_or_below_pct != null &&
        defender.hp * 100 / defender.maxHp > c.target_hp_at_or_below_pct
    ) {
        return false;
    }

    if (
        c.self_hp_at_or_below_pct != null &&
        attacker.hp * 100 / attacker.maxHp > c.self_hp_at_or_below_pct
    ) {
        return false;
    }

    return true;
}

function nextRoll(options) {
    if (options.statusRolls && options.statusRolls.length) {
        return options.statusRolls.shift();
    }

    return Math.random();
}

// Snapshot a definition + rule into a live instance.
function makeInstance(rule, sourceName) {
    return {
        key: rule.key,
        name: rule.name,
        statusId: rule.status_id,
        behavior: rule.behavior,
        power: rule.power,
        isPercent: rule.is_percent,
        stacks: rule.stacks,
        maxStacks: rule.max_stacks,
        policy: rule.reapply_policy,
        remainingTurns: rule.duration ?? rule.default_duration,
        sourceName
    };
}

// Compare strength for replace_if_stronger: more stacks wins;
// ties go to the longer remaining duration.
function isStronger(next, active) {
    if (next.stacks !== active.stacks) {
        return next.stacks > active.stacks;
    }

    return next.remainingTurns > active.remainingTurns;
}

// Apply (or merge) one instance on a fighter per the definition's
// reapplication policy. Returns an event describing the outcome.
function applyInstance(target, next) {
    target.statuses ??= [];
    const active = target.statuses.find(s => s.key === next.key);

    if (!active) {
        target.statuses.push(next);
        return { type: "applied", key: next.key, name: next.name };
    }

    switch (active.policy) {
        case "refresh_duration":
            active.remainingTurns = next.remainingTurns;
            return { type: "refreshed", key: next.key, name: next.name };

        case "stack_intensity": {
            const grew = Math.min(
                active.maxStacks, active.stacks + next.stacks
            );
            const changed = grew !== active.stacks;
            active.stacks = grew;
            active.remainingTurns = Math.max(
                active.remainingTurns, next.remainingTurns
            );
            return {
                type: changed ? "stacked" : "refreshed",
                key: next.key,
                name: next.name
            };
        }

        case "replace_if_stronger":
            if (isStronger(next, active)) {
                Object.assign(active, next);
                return {
                    type: "replaced", key: next.key, name: next.name
                };
            }
            return {
                type: "ignored", reason: "weaker", key: next.key,
                name: next.name
            };

        case "ignore_if_active":
            return {
                type: "ignored", reason: "already_active",
                key: next.key, name: next.name
            };

        case "replace_duration":
            active.remainingTurns = next.remainingTurns;
            active.stacks = next.stacks;
            return { type: "replaced", key: next.key, name: next.name };
    }
}

// Remove every instance of a status (cleansing hook — currently
// unused by combat but kept for admin/future mechanics).
function clearStatus(target, key) {
    if (!target.statuses) return false;
    const before = target.statuses.length;
    target.statuses = target.statuses.filter(s => s.key !== key);
    return target.statuses.length !== before;
}

function activeStatus(target, key) {
    return target.statuses?.find(s => s.key === key) ?? null;
}

// --- effective stats ------------------------------------------------

function modifierFor(character, stat) {
    const behavior = stat === "atk" ? "modify_atk" : "modify_def";
    let total = 0;

    for (const s of character.statuses ?? []) {
        if (s.behavior !== behavior) continue;
        // Trunc toward zero keeps percent modifiers symmetric:
        // ±50% of 21 = ±10 in both directions.
        total += s.isPercent
            ? Math.trunc(character[stat] * s.power / 100) * s.stacks
            : s.power * s.stacks;
    }

    return total;
}

function effectiveStat(character, stat) {
    return (character[stat] ?? 0) + modifierFor(character, stat);
}

// Proxy view: reads of atk/def return the status-adjusted value;
// every other property (and all writes — hp, cost, ex…) pass through
// to the real character. Used inside damage computation only.
function effView(character) {
    return new Proxy(character, {
        get(target, key) {
            if (key === "atk" || key === "def") {
                return effectiveStat(target, key);
            }
            return target[key];
        }
    });
}

// --- application ----------------------------------------------------

// Apply configured statuses after a RESOLVED action. `action` is
// { type: "normal"|"skill"|"ex", key }. Only runs when the engine
// produced a successful, non-reflected result with executed hits;
// a defeated target receives nothing (existing KO rules win).
function applyActionStatuses(attacker, defender, action, result, options = {}) {
    const rules = rulesForAction(attacker.statusRules, action);

    if (!rules.length || !result.success || result.outcome === "reflected") {
        return [];
    }

    const events = [];
    const hits = result.hits ?? [];

    for (const rule of rules) {
        // A disabled rule — or a disabled definition — is an explicit
        // override that blocks any inherited application.
        if (rule.enabled === false || rule.status_enabled === false) {
            events.push({
                type: "skipped", reason: "disabled",
                key: rule.key, name: rule.name
            });
            continue;
        }

        if (!conditionsMet(rule, attacker, defender)) {
            events.push({
                type: "skipped", reason: "condition",
                key: rule.key, name: rule.name
            });
            continue;
        }

        // per_action: once for the action — but never onto a
        // defeated fighter (a dead target gains no statuses).
        // per_hit: once per executed hit, excluding the killing hit.
        const times =
            rule.timing === "per_hit"
                ? hits.map((_, i) => i)
                : hits.length && !result.defeated ? [0] : [];

        for (const hitIndex of times) {
            if (result.defeated && hitIndex === hits.length - 1) {
                continue;
            }

            const roll = nextRoll(options);

            if (!(roll * 100 < rule.chance)) {
                events.push({
                    type: "missed", key: rule.key, name: rule.name,
                    hitIndex
                });
                continue;
            }

            const event = applyInstance(
                defender, makeInstance(rule, attacker.name)
            );
            event.hitIndex = hitIndex;
            events.push(event);
        }
    }

    return events;
}

// --- turn-start processing ------------------------------------------

// Periodic damage + duration decrement + skip check for the fighter
// whose turn is starting. Mutates hp directly — status damage is NOT
// attack damage, so it grants no COST or EX gauge on purpose.
// Returns { events, skipped, ko }.
function processTurnStart(battle, character) {
    const events = [];
    let skipped = false;

    for (const status of [...(character.statuses ?? [])]) {
        if (status.behavior === "periodic_damage") {
            const damage = status.power * status.stacks;
            character.hp = Math.max(0, character.hp - damage);
            events.push({
                type: "tick", key: status.key, name: status.name,
                target: character.name, damage
            });
        }

        if (status.behavior === "skip_turn" && character.hp > 0) {
            if (!skipped) {
                events.push({
                    type: "skipped", key: status.key,
                    name: status.name, target: character.name
                });
            }
            skipped = true;
        }

        status.remainingTurns -= 1;

        if (status.remainingTurns <= 0) {
            character.statuses = character.statuses.filter(
                s => s !== status
            );
            events.push({
                type: "expired", key: status.key, name: status.name,
                target: character.name
            });
        }
    }

    return { events, skipped, ko: character.hp <= 0 };
}

module.exports = {
    REAPPLY_POLICIES,
    BEHAVIORS,
    SCOPES,
    TIMINGS,
    rulesForAction,
    applyActionStatuses,
    applyInstance,
    clearStatus,
    activeStatus,
    effectiveStat,
    effView,
    processTurnStart
};
