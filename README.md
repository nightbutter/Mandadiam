# Mandadiam — Discord RPG Bot

A Discord bot for turn-based RPG battles, backed by Neon PostgreSQL.

## Folder structure

```
src/
├── index.js                  # Bot entry point (npm start)
├── config/
│   └── env.js                # dotenv loading + env validation
├── bot/
│   ├── client.js             # Discord client factory + event wiring
│   ├── events/               # ready, interactionCreate
│   ├── commands/             # slash commands (ping)
│   └── deploy-commands.js    # manual slash-command registration
├── database/
│   ├── db.js                 # shared pg Pool + testConnection + closePool
│   ├── repositories/         # playerRepository, characterRepository
│   └── migrations/
│       └── migrate.js        # idempotent schema migration
├── game/
│   ├── combat.js             # damage, d20 contests, attack resolution
│   ├── cost.js               # COST (0–6) gain/spend rules
│   ├── battle.js             # battle lifecycle: turns, actions, win check
│   └── services/
│       └── battleService.js  # in-memory battle sessions per channel
└── tests/ (tests/)
    ├── unit/                 # pure game-logic tests
    ├── integration/          # DB connectivity + schema tests
    └── run.js                # test runner (npm test)
```

## Requirements

- Node.js 24.x
- A Neon PostgreSQL database
- A Discord application + bot token (for running the bot)

## Installation

```bash
npm install
cp .env.example .env   # then fill in the values
```

## Environment variables

| Variable                 | Required | Purpose                                        |
| ------------------------ | -------- | ---------------------------------------------- |
| `DATABASE_URL`           | yes*     | Neon pooled connection string (`sslmode=require`) |
| `DATABASE_URL_UNPOOLED`  | no       | Direct connection for migrations               |
| `DISCORD_TOKEN`          | yes*     | Bot token from the Discord Developer Portal    |
| `DISCORD_CLIENT_ID`      | for command registration | Application ID                    |
| `DISCORD_GUILD_ID`       | no       | Guild ID for instant dev command registration  |

\* `npm start` requires `DISCORD_TOKEN`; database-backed features require `DATABASE_URL`. The bot logs a warning and continues without it.

## Tests

```bash
npm test                # all suites
npm run test:unit       # game-logic tests only (no database needed)
npm run test:integration # database tests only (needs DATABASE_URL)
```

`tests/run.js` runs every file in `tests/unit/`. Integration tests in
`tests/integration/` run only when `DATABASE_URL` is set; otherwise they
are skipped with a notice. Individual tests can also be run directly,
e.g. `node tests/unit/test-combat.js`.

## Running the bot

```bash
npm start
```

Startup validates `DISCORD_TOKEN`, checks the database connection, and
logs in. `SIGINT`/`SIGTERM` shut down the Discord client and the
PostgreSQL pool cleanly.

## Slash commands

Commands are **not** registered automatically. To register them (guild
commands update instantly; global commands can take up to an hour):

```bash
npm run commands:register   # needs DISCORD_TOKEN + DISCORD_CLIENT_ID
```

Currently implemented:

| Command | Description |
| ------- | ----------- |
| `/ping` | Health check |
| `/register` | Register as a player (idempotent) |
| `/profile` | Show your profile and active character |
| `/characters` | List your characters |
| `/character-create` | Create a character — see creation rules below |
| `/character-select` | Set your active character by name |
| `/battle-challenge` | Challenge a player in this channel (expires in 60s) |
| `/battle-accept` | Accept a challenge issued to you |
| `/battle-status` | Show the current battle in this channel |
| `/battle-attack` | Normal attack on your turn |
| `/battle-forfeit` | Forfeit a battle or withdraw/decline a challenge |
| `/character-image` | Set a character's portrait from a file attachment |
| `/rpg` | Open the main menu dashboard (button-driven UI) |

All player commands reply ephemerally and require `DATABASE_URL`.

### `/rpg` dashboard

`/rpg` opens an **ephemeral main menu** — only you can see and click it.
Sections: Profile, My Characters, Create Character (a 5-field modal
form), Select Active (a character dropdown), Battle (an opponent picker
that sends a public challenge message with Accept/Decline buttons),
and Help/Rules. Buttons on the dashboard are verified against the
original `/rpg` invoker — other users' clicks are rejected.

Dashboard menu buttons are stateless (they re-read the database on each
click), so they **survive bot restarts**. Battle and challenge buttons
do **not** — they depend on in-memory sessions (see below).

### Character portraits

Each character has a nullable `image_url`. Portraits appear on the
main menu, profile, character detail view, and the battle panel
(thumbnail = the fighter to act, author icon = the other participant).

Two ways to set an image — **neither requires sending a channel
message**:

- **Dashboard**: My Characters → pick a character → **🖼️ Set Image**
  opens Discord's native file-upload modal — choose the file, submit,
  and the detail view refreshes.
- **`/character-image`** — attach a PNG/JPEG/WebP file (max 5 MB),
  optionally naming a character (defaults to the active one).

Images are stored as **Discord CDN attachment URLs** — they remain
available while the upload message exists. This is **not permanent
hosting**: if the message is deleted the portrait breaks. Validation
accepts only `https` URLs on `cdn.discordapp.com` /
`media.discordapp.net` with PNG/JPEG/WebP MIME + extension and ≤ 5 MB.

### Skills

Every character owns its own persisted skill records in
`character_skills` (`character_id → skill_key`, `ON DELETE CASCADE`,
composite PK prevents duplicates). The initial catalog has exactly
three definitions in `src/game/skills.js`, so **every character's
starting loadout is the same three skills** — the per-character rows
exist so future catalogs can offer different loadouts. New characters
are provisioned on creation; pre-skill characters are backfilled by the
migration and lazily on first battle use.

| Skill | COST | Condition | Cooldown |
|---|---|---|---|
| **Power Strike** | 3 | none | 2 of your turns |
| **Piercing Strike** | 2 | target HP ≤ 50% of max | 3 of your turns |
| **Desperation Burst** | 2 | your HP ≤ 40% of max | 3 of your turns |

All skills resolve through the same combat engine as normal attacks
(`max(0, d8 + ATK + SPE − DEF)`, d20 contests, double attack,
reflection, crits — nothing duplicated). COST is spent exactly once per
accepted action by `performAction`; a failed condition or insufficient
COST rejects the action without touching HP, COST, dice, or the turn.

**Cooldowns**: each skill tracks its own per-battle counter on the
fighter (`character.cooldowns`, in-memory like COST/EX). A successful
use arms the counter to the catalog value *after* the turn ends, so
the use-turn never consumes it; the counter ticks down at the end of
each of the fighter's own turns (opponent turns never touch it) and
the skill is usable again the turn the counter reaches 0. Rejected
activations arm nothing. The picker shows `⏳ Cooldown: N of your
turns`, `✓ ready`, or the blocking condition; stale selections are
re-validated server-side and rejected safely.

**Using a skill**: on your turn in the battle panel, press
**✨ Skills** → an ephemeral picker lists your skills with their COST
and current availability (✓ ready / reason why not) → pick one. The
panel updates in place with the result; spectators and out-of-turn
clicks are rejected ephemerally. There is no skill slash command —
the panel is the interface.

**Battle end**: a knockout or confirmed forfeit finalizes the session
exactly once — the panel edits in place to `🏆 Battle Finished` with
all action buttons removed, and a dedicated result card (winner,
loser, reason, final HP/COST, turn count) posts to the channel.
Further clicks on the dead panel or stale ephemeral pickers get a
safe "no longer active" rejection — a finished battle can never be
re-finalized or act again. Multi-hit EX stops applying hits the
moment the defender drops.

Not implemented yet: skill assignment/editing UI, character-unique
loadouts, status effects.

### EX Skills (Ultimates)

Each character owns one persisted EX assignment in `character_ex`
(one row per character, `ON DELETE CASCADE`). The gauge itself is
**in-memory battle state** (0–100) and is lost on restart — see
`docs/EX_SKILL_SYSTEM.md` for the full specification.

- Gain: **+20** per successful attack action (once, even on double
  attacks), **+10** per actual damage instance received.
- Activation needs a full gauge (exactly 100), the declared COST
  (default 4), your turn, a live target, and a valid assignment.
- Formula: `max(0, floor((d8 + ATK + SPE) × mult) − effDef)` —
  same d20 contest/reflect/double rules as normal attacks.

### Status Effects

Reusable, admin-configured status system — DB-backed definitions
(`status_definitions`) plus per-character action rules
(`status_rules`), active instances held in memory like COST/EX.
Admins configure it via the **Admin** panel in `/rpg`
(`ADMIN_IDS` env). See `docs/STATUS_SYSTEM.md` for the full
specification.
- Initial catalog: **Oblivion Edge** (2.5× heavy), **Void Piercer**
  (2×, pierces 50% DEF), **Fang Barrage** (3×1 hits), **Last Light**
  (1.5×, 3× at ≤40% HP). Assignment is deterministic per character.
- Use: battle panel → **💥 Ultimate** → ephemeral detail/confirm.

### Character creation rules

New characters use a single **point-buy budget of 150** shared across
`max_hp + atk + def + spe`:

- `max_hp`: 50–150 (costs 1 point per hit point)
- `atk`, `def`, `spe`: 0–30 each
- `name`: 1–30 characters, unique per player

Validation runs server-side in `characterService` regardless of the
Discord option bounds. Characters created before these rules (e.g. the
intentional `noctis` test character) are grandfathered and unchanged.

## Database

`src/database/db.js` owns a single shared `pg.Pool` built from
`DATABASE_URL`. Repositories (`playerRepository`, `characterRepository`)
use that pool with parameterized queries only.

Apply the schema manually (never run automatically on bot startup):

```bash
npm run migrate
```

The migration is idempotent and creates `players`, `characters`,
`battles` (including the composite FKs that keep
`players.active_character_id` and battle participants consistent with
character ownership), and `character_skills` (per-character equipped
skills with a backfill for existing rows).

## Implemented

- Turn-based battle engine: initiative d20 contests with tie rerolls,
  hit / double-attack (attacker d20 = 20) / reflection (defender d20 = 20)
  resolution.
- Damage: `max(0, d8 + ATK - DEF)` normal, `+ SPE` for skills, `d8 = 8`
  critical doubles raw damage before DEF.
- COST system (0–6): +1 on turn start, +1 on a successful attack (once per
  turn, even on double attacks), +1 per instance of damage taken; skills
  spend COST and fail without deducting when insufficient.
- Battle controller: turn start/end, one action per turn, battle end and
  winner detection.
- Neon PostgreSQL schema + repositories for players and characters.
- Player registration and character management commands
  (`/register`, `/profile`, `/characters`, `/character-create`,
  `/character-select`) — services in `src/services/` keep SQL out of
  command code; ownership is enforced by the composite FK.
- Minimal Discord bot (`/ping`) with graceful shutdown.
- Two-player PvP battles over Discord: challenges (60s expiry,
  opponent-only accept), turn-based normal attacks with full combat
  mechanics (d20 contests, double attack on 20, reflect on defender 20,
  COST gains), and forfeit with a confirmation step.
- Button-driven UI: `/rpg` dashboard (profile, character list, modal
  character creation, select-menu activation, opponent picker), a
  public challenge message with Accept/Decline buttons, and a
  persistent battle panel (HP bars, stats, COST, turn, recent log)
  with Attack/✨ Skills/Refresh/Forfeit buttons. Slash commands remain
  as fallback and keep the panel in sync.
- Character-owned skills: three-skill catalog (Power Strike,
  Piercing Strike, Desperation Burst) persisted per character in
  `character_skills`, equipped via an ephemeral select menu on the
  battle panel.
- Character-specific EX Ultimates: per-character `character_ex`
  assignment, in-memory 0–100 gauge charged by attacking and taking
  damage, and a 💥 Ultimate panel button with a confirm step that
  resolves through the dedicated EX combat path.

### Battle state is in-memory

Active battles and pending challenges live in process memory only
(`src/game/services/battleService.js`). Character `hp`/`cost` mutate
the in-memory battle copy — **nothing is written back to the database**,
and the `battles` table is not wired to the live flow yet. Consequences:

- **Restarting the bot loses all active battles and challenges.**
- A single bot process is required — running multiple instances would
  give each its own independent battle state.

## Not implemented yet
- Battle persistence (HP/COST are intentionally transient).
- Leveling, EXP, buffs/debuffs, passive skills, aggro.
