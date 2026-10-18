# Status Effect System

Configurable, reusable status effects for PvP battles — driven by
admin-managed database configuration, executed inside the existing
combat engine. No combat formulas changed; statuses hook the
established lifecycle.

## Model

Three layers, stored separately:

| Layer | Where | What |
|---|---|---|
| **Definition** | `status_definitions` (DB) | What a status is: key, name, behavior, power, max stacks, default duration, reapply policy |
| **Application rule** | `status_rules` (DB) | Which character/action can inflict it: scope, chance, duration override, stacks, timing, conditions |
| **Active instance** | `character.statuses` (in-memory) | A live effect on a fighter — a **snapshot** of the definition at application time |

Rules snapshot onto the battle character (`character.statusRules`)
when `getActiveBattleCharacter` loads the fighter — mid-battle admin
edits never reach live fighters, matching how skills/EX already load.
Active instances never persist; they vanish on restart like COST,
EX gauge, and cooldowns.

## Supported behaviors

| Behavior | Effect |
|---|---|
| `periodic_damage` | `power × stacks` HP damage at the start of each of the owner's turns (status damage is separate from attack damage — it grants **no** COST or EX gauge) |
| `skip_turn` | The owner's turn is consumed (normal bookkeeping still runs: COST ticks, cooldowns tick, turn advances) |
| `modify_atk` / `modify_def` | `power` (flat or percent when `is_percent`) × stacks added to effective ATK/DEF via a Proxy view — base stats are never mutated |

Seeded catalog: `burn`, `poison`, `bleed`, `stun`, `atk_down`,
`def_down`. Definitions are enabled but **inert without rules**.

## Scope and precedence

Each rule lives at one scope:

- `character` — fallback for every action of that character
- `attack` — normal attacks only
- `skill` — one specific skill key
- `ex` — one specific EX key

Precedence (most specific wins, one governing rule per status per
action): `skill/ex` key > `attack` > `character`. A **disabled**
governing rule blocks the inherited fallback. Rules never combine
across scopes and never leak between characters (rules attach to the
attacker only).

## Rule fields

`chance` 0-100 · `duration` (blank = definition default) · `stacks`
per application · `timing` = `per_action` | `per_hit` ·
`conditions` = `{target_hp_at_or_below_pct, self_hp_at_or_below_pct}`
(≤ threshold, same convention as skill conditions).

## Timing and lifecycle

1. Application happens **after successful action resolution** —
   never on rejected, stale, cancelled, or insufficient-COST actions,
   and never on a `reflected` outcome (the reflection is the
   defender's damage, not the attacker's action).
2. `per_action`: one application per resolved action. `per_hit`: one
   chance roll per executed hit — a KO'd hit is skipped, and hits
   that never executed (early KO stop, double-attack truncation,
   Fang Barrage) can't apply anything.
3. A defeated target gains no statuses.
4. Tick order at the **owner's turn start**: periodic damage →
   skip check → duration decrement → expiry. Duration N affects
   exactly N owner turns.
5. Reapplication policies: `refresh_duration`, `stack_intensity`
   (capped at `max_stacks`), `replace_if_stronger` (stacks, then
   duration), `ignore_if_active`, `replace_duration`.
6. A zero-damage confirmed hit still applies statuses — chance and
   conditions decide, not damage.

## Chance rolls and manual dice

Status chance uses a **separate RNG source**: an injected
`statusRolls` queue in tests, `Math.random()` in production. It
never consumes or alters the manual d20/d8 sequence, and clients
never submit or choose the result. Chance rolls are consumed in
deterministic order (status definition id, then hit index) at
resolution time — after all combat dice are collected.

## Admin dashboard

Set `ADMIN_IDS` to a comma-separated list of Discord user ids. Admins
get an **Admin** button in `/rpg`; every `admin:*` interaction
re-checks membership server-side (the button is cosmetic).

Flow: **Status Definitions** (list/create/edit/toggle/delete;
behavior and policy via selects, fields via modals) →
**Character Rules** (pick a character → pick a scope → per-status
rule editor with chance/duration/stacks/timing/conditions →
enable/disable/delete) → **Precedence preview** shows the effective
governing rule per action, marked inherited vs overridden.

## Migration

`npm run migrate` — idempotent `MIGRATION_SQL`, safe to re-run.
Creates `status_definitions` + `status_rules` (FK cascade to
characters, unique rule per character/status/scope/key, CHECK
constraints for enums and ranges) and seeds the six default
definitions. No existing data is touched.

## Player-facing UI

The battle panel shows each fighter's active statuses
(`Burn ×2 (2t)`). Battle logs record applications, ticks, skips,
and expirations; missed chances stay silent to avoid spam.

## Limitations

- Battles and their statuses are in-memory — a restart loses them
  (roll buttons then fail safely as stale).
- Status damage is not an "attack" — no COST/EX rewards by design.
- `clearStatus` is a hook for future cleanse mechanics; nothing in
  combat calls it yet.
