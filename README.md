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
npm test
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

Currently implemented: `/ping`.

## Database

`src/database/db.js` owns a single shared `pg.Pool` built from
`DATABASE_URL`. Repositories (`playerRepository`, `characterRepository`)
use that pool with parameterized queries only.

Apply the schema manually (never run automatically on bot startup):

```bash
npm run migrate
```

The migration is idempotent and creates `players`, `characters`, and
`battles` (including the composite FKs that keep
`players.active_character_id` and battle participants consistent with
character ownership).

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
- Minimal Discord bot (`/ping`) with graceful shutdown.

## Not implemented yet

- Player registration / character-selection commands.
- Discord commands that drive battles (`battleService` is ready for them).
- Battle persistence (HP/COST are intentionally transient).
- Leveling, EXP, buffs/debuffs, passive skills, aggro.
