const { Events } = require('discord.js');
const { REQUIRED_LEVEL, getMemberRank } = require('../config');
const { hasPermission } = require('../utils/permissions');
const { callsignApprovedEmbed, callsignDeniedEmbed, errorEmbed } = require('../utils/embeds');
const { getCallsignRequest, decideCallsignRequest, setMemberCallsign, addHistoryEntry, upsertMember } = require('../database/db');
const { logCallsigns } = require('../utils/logger');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // ---------------------------------------------------------------
    // Slash commands
    // ---------------------------------------------------------------
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (err) {
        console.error(`Error executing /${interaction.commandName}:`, err);
        const payload = { content: 'Something went wrong while running that command.', embeds: [], components: [], ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply(payload).catch(() => {});
        } else {
          await interaction.reply(payload).catch(() => {});
        }
      }
      return;
    }

    // ---------------------------------------------------------------
    // Autocomplete
    // ---------------------------------------------------------------
    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command || !command.autocomplete) return;
      try {
        await command.autocomplete(interaction);
      } catch (err) {
        console.error(`Error in autocomplete for /${interaction.commandName}:`, err);
      }
      return;
    }

    // ---------------------------------------------------------------
    // Callsign approve/deny buttons
    // (Confirmation buttons for promote/demote/infract are handled
    // inline by utils/confirmation.js via awaitMessageComponent.)
    // ---------------------------------------------------------------
    if (interaction.isButton()) {
      const [scope, action, requestIdRaw] = interaction.customId.split('_');
      if (scope !== 'callsign') return;

      if (!hasPermission(interaction.member, REQUIRED_LEVEL.CALLSIGN_APPROVE)) {
        return interaction.reply({
          embeds: [errorEmbed('You do not have permission to approve or deny callsign requests.')],
          ephemeral: true,
        });
      }

      const requestId = Number(requestIdRaw);
      const request = getCallsignRequest(requestId);
      if (!request) {
        return interaction.reply({ embeds: [errorEmbed('This callsign request no longer exists.')], ephemeral: true });
      }
      if (request.status !== 'PENDING') {
        return interaction.reply({ embeds: [errorEmbed(`This request has already been ${request.status.toLowerCase()}.`)], ephemeral: true });
      }

      const targetMember = await interaction.guild.members.fetch(request.discord_id).catch(() => null);
      if (!targetMember) {
        return interaction.reply({ embeds: [errorEmbed('That member could not be found in this server.')], ephemeral: true });
      }

      if (action === 'approve') {
        decideCallsignRequest(requestId, 'APPROVED', interaction.user.id);
        setMemberCallsign(targetMember.id, request.requested_callsign);
        const rank = getMemberRank(targetMember);
        upsertMember({ discordId: targetMember.id, username: targetMember.user.username, department: rank?.department, rankRoleId: rank?.roleId });
        addHistoryEntry({
          discordId: targetMember.id,
          actionType: 'CALLSIGN_REQUEST',
          oldValue: null,
          newValue: request.requested_callsign,
          actorId: interaction.user.id,
          reason: 'Approved',
        });

        const embed = callsignApprovedEmbed({ member: targetMember, callsign: request.requested_callsign, approvedBy: interaction.user });
        await interaction.update({ embeds: [embed], components: [] });

        await logCallsigns(interaction.guild, {
          action: 'Callsign Approved',
          member: targetMember,
          staff: interaction.user,
          details: { Callsign: request.requested_callsign },
        });

        targetMember.send({ embeds: [embed] }).catch(() => {});
      } else if (action === 'deny') {
        decideCallsignRequest(requestId, 'DENIED', interaction.user.id);

        const embed = callsignDeniedEmbed({
          member: targetMember,
          callsign: request.requested_callsign,
          deniedBy: interaction.user,
          reason: 'Denied by LAFD management.',
        });
        await interaction.update({ embeds: [embed], components: [] });

        await logCallsigns(interaction.guild, {
          action: 'Callsign Denied',
          member: targetMember,
          staff: interaction.user,
          details: { 'Requested Callsign': request.requested_callsign },
        });

        targetMember.send({ embeds: [embed] }).catch(() => {});
      }
    }
  },
};
