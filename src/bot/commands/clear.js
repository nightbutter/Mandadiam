const {
    SlashCommandBuilder,
    PermissionFlagsBits
} = require("discord.js");

// /clear amount:<1-100> — bulk-delete recent messages in the current
// guild channel only. Discord's bulkDelete refuses messages older
// than 14 days, so filterOld drops them before the request.
module.exports = {
    data: new SlashCommandBuilder()
        .setName("clear")
        .setDescription("Delete recent messages in this channel")
        .addIntegerOption(option =>
            option
                .setName("amount")
                .setDescription("Messages to delete (1-100)")
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDMPermission(false),

    async execute(interaction) {
        const channel = interaction.channel;

        if (
            !interaction.inGuild() ||
            typeof channel?.bulkDelete !== "function"
        ) {
            await interaction.reply({
                content:
                    "/clear only works in guild text channels.",
                ephemeral: true
            });
            return;
        }

        // Server-side check — default member permissions are only a
        // client hint; the bot must not trust them.
        if (
            !interaction.memberPermissions?.has(
                PermissionFlagsBits.ManageMessages
            )
        ) {
            await interaction.reply({
                content:
                    "You need the Manage Messages permission to " +
                    "use /clear.",
                ephemeral: true
            });
            return;
        }

        const botPerms = channel.permissionsFor(
            interaction.guild.members.me
        );
        const needed = [
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.ReadMessageHistory
        ];

        if (!botPerms?.has(needed)) {
            await interaction.reply({
                content:
                    "I need Manage Messages and Read Message " +
                    "History in this channel.",
                ephemeral: true
            });
            return;
        }

        const amount = interaction.options.getInteger("amount");

        if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
            await interaction.reply({
                content: "Amount must be an integer from 1 to 100.",
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // filterOld: true — Discord rejects messages older than
            // 14 days; they are filtered out rather than retried.
            const deleted = await channel.bulkDelete(amount, true);
            const count = deleted?.size ?? 0;

            await interaction.editReply(
                count > 0
                    ? `ลบข้อความสำเร็จ ${count} ข้อความ`
                    : "ไม่มีข้อความที่ลบได้ — messages older than " +
                        "14 days can't be bulk-deleted."
            );
        } catch (err) {
            console.warn(
                `[clear] bulk delete failed in ` +
                `${channel.id}: ${err?.code ?? err?.message ?? err}`
            );
            await interaction.editReply(
                "Couldn't delete messages — check my channel " +
                "permissions and try again."
            );
        }
    }
};
