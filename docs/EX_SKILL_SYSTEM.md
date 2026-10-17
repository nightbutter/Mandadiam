# EX Skill / Ultimate System

Character-specific ultimates added in Phase 6. Each character owns one
persisted EX assignment; the gauge itself is transient battle state.

## Files

| File | Role |
|---|---|
| `src/game/exSkills.js` | EX catalog — names, COST, multipliers, effect configs |
| `src/game/exGauge.js` | Gauge primitives (0–100), gain rules |
| `src/game/exCombat.js` | EX attack resolution (formulas, effects) |
| `src/game/battle.js` | `performExAction` — gate/spend/consume/resolve lifecycle |
| `src/game/services/battleService.js` | `useEx` — participant/turn/ownership gates, turn transition |
| `src/database/repositories/exRepository.js` | `character_ex` persistence |
| `src/bot/battleFormat.js` | Gauge display, 💥 Ultimate button, `buildExPrompt` |
| `src/bot/buttons.js` | `battle:ultimate` → confirm → `useEx` |

## EX gauge

- Range **0–100**, starts at 0, per battle character.
- **In-memory only** — like HP/COST, the gauge is lost on restart and
  never written to the database.
- Gains are applied **inside the combat engine** (`resolveAttack`,
  `resolveExAttack`) at the exact points where damage is confirmed —
  the same authoritative event path as COST hooks. Nothing outside the
  engine awards EX, so an outcome can never be counted twice.

| Event | Gain |
|---|---|
| Successful attack action (`hit` or `double_attack`) | **+20** once per action — a double attack is still one action |
| Reflected outcome | **+0** action EX — the attack did not land |
| Each actual damage instance received (damage > 0) | **+10** to the recipient — including reflected damage taken by the attacker |
| Zero-damage instance | +0 |
| Rejected action (any validation failure) | +0 |
| EX activation itself | +0 — the gauge is consumed, not re-earned |

Note: this engine has no "miss" outcome — a resolved attack always
lands (hits) or is reflected. Normal attacks, skill attacks, and EX
hits all feed the damage-received gain.

## Activation requirements

All checked server-side before any mutation (`useEx`):

1. Battle exists and is active
2. Requester is a participant and the current turn owner
3. Actor is alive with a valid, catalog-resolvable EX assignment
4. `ex === 100` exactly
5. Actor has enough COST for the EX's declared cost
6. Target is valid and alive

On success: COST is deducted once and the gauge set to 0 inside
`performExAction`, the effect resolves, the turn advances exactly
once. On any rejection: **nothing** changes — HP, COST, EX, turn,
dice, and logs are untouched (COST + gauge are refunded even if
resolution fails after deduction). Duplicate clicks see
`actionTaken` already set or a different turn owner, so an EX can
never resolve twice.

## Damage model

```
per hit:  max(0, floor((d8 + ATK + SPE) × multNum/multDen) − effectiveDef)
crit:     d8 === 8 doubles (d8 + ATK + SPE) before the multiplier
```

- The multiplier applies once; DEF is deducted once per hit.
- The d20 contest is identical to normal attacks: defender 20 reflects
  (standard reflect formula, no EX multiplier), attacker 20 doubles the
  action's hit sequence. Multi-hit doubles to 2N hits.
- Each damage instance triggers existing per-instance COST and EX
  gains; the attacker's once-per-action hit COST still fires once.

## Effect types

| Type | Behavior |
|---|---|
| `heavy` | Plain high multiplier |
| `pierce_defense` | Ignores `piercePercent`% of target DEF — `effDef = def − floor(def × pct / 100)` |
| `multi_hit` | N separate damage instances, **one** d20 contest, N d8 rolls, DEF per instance |
| `desperation` | Adds `bonusNum/bonusDen` to the multiplier when `hp × 100 ≤ maxHp × hpPercent` (integer compare) |

## Initial catalog

| Key | Name | COST | Multiplier | Effect |
|---|---|---|---|---|
| `oblivion_edge` | Oblivion Edge | 4 | 5/2 | heavy |
| `void_piercer` | Void Piercer | 4 | 2/1 | pierce 50% DEF |
| `fang_barrage` | Fang Barrage | 4 | 1/1 | 3 hits |
| `last_light` | Last Light | 4 | 3/2 | +3/2 at ≤40% HP (→3×) |

## Persistence

`character_ex (character_id BIGINT PRIMARY KEY REFERENCES characters
(id) ON DELETE CASCADE, ex_key TEXT, created_at)` — one EX per
character by primary key. Deterministic default:
`EX_KEYS[character_id % len]` — the SQL backfill and
`exRepository.provision()` use the same formula and key order, so an
existing `character_id` always maps to the same EX. `ON CONFLICT DO
NOTHING` keeps provisioning idempotent and never overwrites an
existing assignment. `exRepository.assign()` validates keys against
the catalog, so forged keys can't be stored.

Every character gets an assignment: new characters on creation,
existing characters via migration backfill, and lazily on first
battle use if a row is somehow missing.

## UI flow

```
Battle panel → 💥 Ultimate (own turn only)
  → ephemeral detail: name, effect, COST, gauge, ready/reason
  → Unleash! → service re-validates everything → panel updates in place
  → or Cancel → nothing happens
```

Panel stat lines show `EX [██████░░░░] 60/100 · 💥Name (cost)` for
both fighters. Spectator and out-of-turn clicks are rejected
ephemerally; finished battles clear all buttons.

## Adding a new EX

1. Add a definition to `EX_SKILLS` in `src/game/exSkills.js` — unique
   key, `cost`, `multNum`/`multDen`, `effect` (or a new `type` handled
   in `exCombat.js`).
2. If it should be a provisionable default, keep `EX_KEYS` ordering in
   mind — the SQL backfill array must match. Appending is safe;
   reordering changes what `id % n` maps to.
3. Add a unit test for its effect math and, if it's a new effect type,
   its boundary behavior.

## Commands

```bash
npm run migrate          # apply character_ex schema + backfill
npm run test:unit        # includes tests/unit/test-ex.js
npm run test:integration # includes tests/integration/test-ex.js
npm test                 # full suite
```

## Limitations

- Gauge and battle HP/COST are in-memory — a restart loses active
  battles and gauge progress.
- No loadout-selection UI: every character gets the deterministic
  default; `exRepository.assign()` exists for future UI.
- No status effects, buffs, or passives — effects are single-action
  damage modifiers only.
