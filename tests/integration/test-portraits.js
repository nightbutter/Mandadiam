const assert = require("node:assert/strict");
const { pool } = require("../../src/database/db");
const playerService = require("../../src/services/playerService");
const characterService = require("../../src/services/characterService");
const bs = require("../../src/game/services/battleService");
const { buildBattleEmbed } = require("../../src/bot/battleFormat");

// Portrait persistence + ownership + render integration on real Neon.

const TAG = `__img_test_${Date.now()}__`;
const P1 = `${TAG}_p1`;
const P2 = `${TAG}_p2`;
const CDN = "https://cdn.discordapp.com/attachments/9/9/portrait.png";

function test(title, result) {
    assert(result, title);
    console.log(`PASS: ${title}`);
}

(async () => {
    try {
        console.log("=== Portrait Integration Tests ===");

        await playerService.registerPlayer(P1, "img_one");
        await playerService.registerPlayer(P2, "img_two");
        await characterService.createCharacter(
            P1, { name: "Knight", maxHp: 100, atk: 20, def: 15, spe: 15 }
        );
        await characterService.createCharacter(
            P2, { name: "Rogue", maxHp: 90, atk: 25, def: 20, spe: 15 }
        );

        const { characters: [knight] } =
            await characterService.listCharacters(P1);
        const { characters: [rogue] } =
            await characterService.listCharacters(P2);

        // Existing characters start with no image → default behavior.
        test("new character has no image", knight.image_url === null);

        // --- set image ---

        const set = await characterService.setCharacterImage(
            P1, knight.id, CDN
        );
        test("owner can set portrait", set.ok);
        test(
            "portrait URL stored",
            set.character.image_url === CDN
        );

        const { rows: [raw] } = await pool.query(
            `SELECT image_url FROM characters WHERE id = $1`,
            [knight.id]
        );
        test("row persists image_url", raw.image_url === CDN);

        // Stats untouched by image update.
        const { rows: [stats] } = await pool.query(
            `SELECT name, max_hp, atk, def, spe
             FROM characters WHERE id = $1`,
            [knight.id]
        );
        test(
            "stats unchanged after image update",
            stats.name === "Knight" && stats.max_hp === 100 &&
            stats.atk === 20
        );

        // --- ownership ---

        const steal = await characterService.setCharacterImage(
            P2, knight.id, CDN
        );
        test(
            "another user cannot set the portrait",
            !steal.ok && steal.error === "not_found"
        );

        const { rows: [still] } = await pool.query(
            `SELECT image_url FROM characters WHERE id = $1`,
            [knight.id]
        );
        test("rejected write leaves row untouched",
            still.image_url === CDN);

        const stealClear = await characterService.clearCharacterImage(
            P2, knight.id
        );
        test(
            "another user cannot remove the portrait",
            !stealClear.ok
        );

        // --- url validation at service level ---

        const badUrl = await characterService.setCharacterImage(
            P1, knight.id, "https://evil.example.com/x.png"
        );
        test(
            "non-CDN https URL rejected at service level",
            !badUrl.ok && badUrl.error === "invalid_url"
        );

        const httpUrl = await characterService.setCharacterImage(
            P1, knight.id, "http://cdn.discordapp.com/x.png"
        );
        test("plain http rejected", !httpUrl.ok);

        // --- render integration ---

        // Select characters first — the second player needs one too.
        await characterService.selectCharacter(P1, "Knight");
        await characterService.selectCharacter(P2, "Rogue");
        const loaded =
            await characterService.getActiveBattleCharacter(P1);
        test(
            "battle character carries imageUrl",
            loaded.character.imageUrl === CDN
        );

        // Battle embed shows portraits.
        const c2 = await characterService.getActiveBattleCharacter(P2);
        const session = bs.startBattle(
            `${TAG}_chan`,
            { discordId: P1, character: loaded.character },
            { discordId: P2, character: c2.character },
            { firstRolls: [18], secondRolls: [5] }
        ).session;

        const embed = buildBattleEmbed(session).toJSON();
        const portraits = [embed.thumbnail?.url, embed.author?.icon_url];
        test(
            "battle embed includes a participant portrait",
            portraits.includes(CDN)
        );

        const s2 = bs.getSession(`${TAG}_chan`);
        bs.forfeit(s2, P1);

        // --- remove image restores default ---

        const cleared = await characterService.clearCharacterImage(
            P1, knight.id
        );
        test("owner can remove portrait", cleared.ok);
        test(
            "row returns to NULL image",
            cleared.character.image_url === null
        );

        // --- existing data untouched ---

        const { rows: [noctis] } = await pool.query(
            `SELECT name, image_url FROM characters
             WHERE name = 'noctis' LIMIT 1`
        );
        if (noctis) {
            test(
                "existing 'noctis' record untouched (image NULL)",
                noctis.image_url === null
            );
        }

        console.log("\nPortrait integration tests passed.");
    } finally {
        const session = bs.getSession(`${TAG}_chan`);
        if (session) {
            bs.forfeit(session, session.players[0].discordId);
        }
        await pool.query(
            `DELETE FROM players WHERE discord_id LIKE $1`, [`${TAG}%`]
        );
        await pool.end();
    }
})().catch(err => {
    console.error("FAIL:", err);
    process.exit(1);
});
