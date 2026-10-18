// ADMIN_IDS must be set BEFORE any module that reads env is
// required — env.js snapshots the set at require time.
process.env.ADMIN_IDS = "999000111";

const assert = require("node:assert/strict");
const { pool } = require("../../src/database/db");
const { isAdmin } = require("../../src/config/env");
const statusService = require("../../src/services/statusService");
const statusRepository =
    require("../../src/database/repositories/statusRepository");
const playerService = require("../../src/services/playerService");
const characterService = require("../../src/services/characterService");
const { rulesForAction } = require("../../src/game/statuses");

const TAG = `__sc_test_${Date.now()}__`;
const PID = `${TAG}_p`;

function test(title, result) {
    assert(result, title);
    console.log(`PASS: ${title}`);
}

// Track rows this test creates so cleanup can delete them — the
// seeded catalog definitions stay untouched.
const createdDefIds = [];
let testCharacterId = null;

(async () => {
    try {
        console.log("=== Status Config Integration Tests ===");

        // --- migration shape ------------------------------------------

        {
            const { rows } = await pool.query(
                `SELECT table_name FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name IN
                     ('status_definitions', 'status_rules')`
            );
            assert.equal(rows.length, 2);
            console.log("PASS: status tables exist");
        }

        {
            // Seed catalog is idempotent: six shipped definitions.
            const defs = await statusService.listDefinitions();
            const keys = defs.map(d => d.key);
            for (const k of [
                "burn", "poison", "bleed",
                "stun", "atk_down", "def_down"
            ]) {
                assert(keys.includes(k), `seeded def ${k}`);
            }
            console.log("PASS: seed catalog present");
        }

        // --- admin authorization ----------------------------------------

        {
            assert(isAdmin("999000111"));
            assert(!isAdmin("123456789"));
            assert(!isAdmin(""));
            console.log("PASS: ADMIN_IDS gates admin access");
        }

        // --- definition CRUD + validation --------------------------------

        let def;
        {
            const created = await statusService.createDefinition({
                key: `hex_${Date.now().toString(36)}`,
                name: "Hex",
                behavior: "modify_atk",
                power: -10,
                is_percent: false,
                max_stacks: 2,
                default_duration: 2,
                reapply_policy: "stack_intensity",
                description: "test def"
            });
            assert(created.ok);
            def = created.definition;
            createdDefIds.push(def.id);
            console.log("PASS: createDefinition persists");
        }

        {
            const invalid = await statusService.createDefinition({
                key: "BAD KEY!!", name: "x", behavior: "nonsense",
                power: 0, is_percent: false, max_stacks: 0,
                default_duration: -1, reapply_policy: "whatever",
                description: ""
            });
            assert.equal(invalid.ok, false);
            assert(invalid.details.length >= 5);
            console.log("PASS: invalid definition rejected");

            const dup = await statusService.createDefinition({
                key: def.key, name: "dup", behavior: "skip_turn",
                power: 0, is_percent: false, max_stacks: 1,
                default_duration: 1, reapply_policy: "ignore_if_active",
                description: ""
            });
            assert.equal(dup.error, "duplicate_key");
            console.log("PASS: duplicate key rejected");
        }

        {
            const updated = await statusService.updateDefinition(
                def.id, { power: -15, name: "Hex II" }
            );
            assert(updated.ok);
            assert.equal(updated.definition.power, -15);
            assert.equal(updated.definition.name, "Hex II");

            const toggled = await statusService.updateDefinition(
                def.id, { enabled: false }
            );
            assert(toggled.ok);
            assert.equal(toggled.definition.enabled, false);
            await statusService.updateDefinition(
                def.id, { enabled: true }
            );
            console.log("PASS: updateDefinition + enable toggle");
        }

        // --- rules -------------------------------------------------------

        {
            await playerService.registerPlayer(PID, "sc_tester");
            const created = await characterService.createCharacter(PID, {
                name: `${TAG}_c`, maxHp: 80, atk: 20, def: 10, spe: 10
            });
            assert(created.ok);
            testCharacterId = created.character.id;
            const selected =
                await characterService.selectCharacterById(
                    PID, testCharacterId
                );
            assert(selected.ok);
        }

        {
            const badScope = await statusService.upsertRule({
                character_id: testCharacterId, status_id: def.id,
                scope: "skill", action_key: "not_a_skill",
                enabled: true, chance: 50, duration: null,
                stacks: 1, timing: "per_action", conditions: {}
            });
            assert.equal(badScope.ok, false);
            assert(badScope.details.some(d => d.includes("skill")));

            const badChance = await statusService.upsertRule({
                character_id: testCharacterId, status_id: def.id,
                scope: "attack", action_key: "",
                enabled: true, chance: 101, duration: null,
                stacks: 1, timing: "per_action", conditions: {}
            });
            assert.equal(badChance.ok, false);
            console.log("PASS: invalid rules rejected at the service");
        }

        let ruleId;
        {
            // Character fallback + attack override + skill override.
            const fallback = await statusService.upsertRule({
                character_id: testCharacterId, status_id: def.id,
                scope: "character", action_key: "",
                enabled: true, chance: 100, duration: null,
                stacks: 1, timing: "per_action", conditions: {}
            });
            assert(fallback.ok);
            ruleId = fallback.rule.id;

            const attackRule = await statusService.upsertRule({
                character_id: testCharacterId, status_id: def.id,
                scope: "attack", action_key: "",
                enabled: false, chance: 25, duration: 5,
                stacks: 2, timing: "per_hit", conditions: {}
            });
            assert(attackRule.ok);

            // Upsert is idempotent on the same scope tuple.
            const again = await statusService.upsertRule({
                character_id: testCharacterId, status_id: def.id,
                scope: "character", action_key: "",
                enabled: true, chance: 77, duration: null,
                stacks: 1, timing: "per_action", conditions: {}
            });
            assert(again.ok);
            assert.equal(again.rule.id, ruleId, "upsert not insert");
            assert.equal(again.rule.chance, 77);

            const rules = await statusService.listRulesForCharacter(
                testCharacterId
            );
            assert.equal(rules.length, 2);
            console.log("PASS: rule upsert + unique scope constraint");
        }

        {
            const rules = await statusService.listRulesForCharacter(
                testCharacterId
            );

            // Attack scope: disabled attack rule wins → blocks.
            const forAttack = rulesForAction(rules, {
                type: "normal", key: null
            });
            assert.equal(forAttack[0].scope, "attack");
            assert.equal(forAttack[0].enabled, false);

            // Skill scope: no skill rule → character fallback.
            const forSkill = rulesForAction(rules, {
                type: "skill", key: "power_strike"
            });
            assert.equal(forSkill[0].scope, "character");
            assert.equal(forSkill[0].chance, 77);
            console.log(
                "PASS: DB rules feed precedence resolution"
            );
        }

        {
            // getActiveBattleCharacter attaches the snapshot.
            const loaded = await characterService
                .getActiveBattleCharacter(PID);
            assert(loaded.ok);
            assert.equal(loaded.character.statusRules.length, 2);
            assert(Array.isArray(loaded.character.statuses));
            console.log(
                "PASS: battle characters carry statusRules snapshot"
            );
        }

        {
            const deleted = await statusService.deleteRule(ruleId);
            assert(deleted);
            console.log("PASS: deleteRule removes config");
        }

        console.log("=== Status Config Integration Tests — ALL PASS ===");
    } catch (err) {
        console.error("FAIL:", err);
        process.exitCode = 1;
    } finally {
        // Rules cascade with the definition; character/player rows
        // get deleted explicitly.
        if (testCharacterId) {
            await pool.query(
                `DELETE FROM characters WHERE id = $1`,
                [testCharacterId]
            );
        }

        await pool.query(
            `DELETE FROM players WHERE discord_id = $1`, [PID]
        );

        for (const id of createdDefIds) {
            await pool.query(
                `DELETE FROM status_definitions WHERE id = $1`, [id]
            );
        }

        await pool.end();
    }
})();
