/**
 * /config view | channel | role | rank | clear | check | autosetup
 * -----------------------------------------------------------------------
 * Configure the bot from inside Discord - no .env editing or restart.
 * Values saved here override .env. Usable by Department Heads, and by
 * server Administrators so a fresh server can be bootstrapped before any
 * rank roles are mapped.
 *
 * /config autosetup creates any MISSING channels and status/certification
 * roles (it never touches or duplicates ones that are already configured,
 * and never creates rank roles - map those with /config rank).
 * -----------------------------------------------------------------------
 */

const { SlashCommandBuilder, ChannelType, PermissionFlagsBits, OverwriteType } = require('discord.js');
const {
  REQUIRED_LEVEL,
  COLORS,
  ICONS,
  POLICY,
  CHANNEL_SETTINGS,
  ROLE_SETTINGS,
  CERTIFICATIONS,
  ALL_RANKS,
  DEPARTMENTS,
  settings,
} = require('../../config');
const { hasPermission, isServerAdmin } = require('../../utils/permissions');
const { replyNoPermission, replyError, replySuccess, deferEphemeral } = require('../../utils/replies');
const { baseEmbed, addField } = require('../../utils/embeds');
const { requestConfirmation } = require('../../utils/confirmation');
const { logManagement } = require('../../utils/logger');
const { sendPaginated } = require('../../utils/paginator');
const { chunkLines } = require('../../utils/format');

// ---------------------------------------------------------------------
// Settings registry
// ---------------------------------------------------------------------
const CHANNEL_ENTRIES = Object.entries(CHANNEL_SETTINGS).map(([key, def]) => ({ key: `channel.${key}`, id: key, kind: 'channel', label: def.label, env: def.env, def }));
const ROLE_ENTRIES = [
  ...Object.entries(ROLE_SETTINGS).map(([key, def]) => ({ key: `role.${key}`, id: key, kind: 'role', label: def.label, env: def.env, def })),
  ...CERTIFICATIONS.map((c) => ({ key: c.settingKey, id: c.key, kind: 'role', label: `Certification: ${c.name}`, env: c.env, def: { autoCreate: c.name, cert: true } })),
];
const RANK_ENTRIES = ALL_RANKS.map((r) => ({ key: r.settingKey, kind: 'rank', label: `${r.name} (${DEPARTMENTS[r.department].short})`, env: r.envName, rank: r }));
const ALL_ENTRIES = [...CHANNEL_ENTRIES, ...ROLE_ENTRIES, ...RANK_ENTRIES];
const entryByKey = (key) => ALL_ENTRIES.find((e) => e.key === key);

const ROLE_COLORS = {
  LAFD_MEMBER: COLORS.BRAND,
  FIRE_DIVISION: COLORS.FIRE,
  EMS_DIVISION: COLORS.EMS,
  ON_DUTY: COLORS.SUCCESS,
  LEAVE_OF_ABSENCE: COLORS.WARNING,
  ADMIN_LEAVE: 0xe67e22,
  SUSPENDED: 0x4a4a4a,
  SUPERVISORY_TEAM: COLORS.GOLD,
};

const CATEGORY_NAMES = { board: '📢 LAFD Department', staff: '🔒 LAFD Staff', logs: '📝 LAFD Logs' };

const BOT_CHANNEL_PERMS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory];

function canConfigure(member) {
  return hasPermission(member, REQUIRED_LEVEL.CONFIG) || isServerAdmin(member);
}

function current(entry) {
  return settings.resolveWithSource(entry.key, entry.env);
}

function sourceLabel(source) {
  return source === 'discord' ? 'set in Discord' : source === 'env' ? 'from .env' : '';
}

// ---------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------
module.exports = {
  category: 'Management',
  level: REQUIRED_LEVEL.CONFIG,
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure LAFD Management (Department Heads / server admins).')
    .addSubcommand((s) => s.setName('view').setDescription('Show every channel, role and rank setting.'))
    .addSubcommand((s) =>
      s
        .setName('channel')
        .setDescription('Link a bot feature to a channel.')
        .addStringOption((o) =>
          o
            .setName('setting')
            .setDescription('Which channel')
            .setRequired(true)
            .addChoices(...CHANNEL_ENTRIES.map((e) => ({ name: e.label, value: e.key })))
        )
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Channel').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('role')
        .setDescription('Link a status, division or certification role.')
        .addStringOption((o) =>
          o
            .setName('setting')
            .setDescription('Which role')
            .setRequired(true)
            .addChoices(...ROLE_ENTRIES.map((e) => ({ name: e.label.slice(0, 100), value: e.key })))
        )
        .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('rank')
        .setDescription('Link a rank to its Discord role.')
        .addStringOption((o) => o.setName('rank').setDescription('Rank (start typing)').setRequired(true).setAutocomplete(true))
        .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('clear')
        .setDescription('Remove a setting saved in Discord (falls back to .env).')
        .addStringOption((o) => o.setName('setting').setDescription('Setting (start typing)').setRequired(true).setAutocomplete(true))
    )
    .addSubcommand((s) => s.setName('check').setDescription('Diagnose missing settings, role order and channel permissions.'))
    .addSubcommand((s) =>
      s
        .setName('autosetup')
        .setDescription('Create any missing channels and roles automatically.')
        .addStringOption((o) =>
          o
            .setName('scope')
            .setDescription('What to create')
            .setRequired(true)
            .addChoices({ name: 'Channels and roles', value: 'all' }, { name: 'Channels only', value: 'channels' }, { name: 'Roles only', value: 'roles' })
        )
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const query = focused.value.toLowerCase();
    const pool = focused.name === 'rank' ? RANK_ENTRIES : ALL_ENTRIES.filter((e) => settings.getSetting(e.key));
    const choices = pool
      .filter((e) => e.label.toLowerCase().includes(query))
      .slice(0, 25)
      .map((e) => ({ name: e.label.slice(0, 100), value: e.key }));
    return interaction.respond(choices);
  },

  async execute(interaction) {
    if (!canConfigure(interaction.member)) return replyNoPermission(interaction, REQUIRED_LEVEL.CONFIG);
    const sub = interaction.options.getSubcommand();
    if (sub === 'view') return view(interaction);
    if (sub === 'channel') return setChannel(interaction);
    if (sub === 'role') return setRole(interaction, interaction.options.getString('setting'));
    if (sub === 'rank') return setRole(interaction, interaction.options.getString('rank'));
    if (sub === 'clear') return clear(interaction);
    if (sub === 'check') return check(interaction);
    if (sub === 'autosetup') return autosetup(interaction);
  },
};

// ---------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------
async function view(interaction) {
  const line = (entry, mention) => {
    const { value, source } = current(entry);
    if (value) return `${ICONS.APPROVE} **${entry.label}** — ${mention(value)} *(${sourceLabel(source)})*`;
    if (entry.def?.fallback) return `↪️ **${entry.label}** — uses ${CHANNEL_SETTINGS[entry.def.fallback].label}`;
    return `${ICONS.DENY} **${entry.label}** — not set`;
  };
  const sections = [
    { title: `${ICONS.CONFIG} Channels`, lines: CHANNEL_ENTRIES.map((e) => line(e, (v) => `<#${v}>`)) },
    { title: `${ICONS.CONFIG} Roles & Certifications`, lines: ROLE_ENTRIES.map((e) => line(e, (v) => `<@&${v}>`)) },
    { title: `${ICONS.FIRE} Fire Ranks`, lines: RANK_ENTRIES.filter((e) => e.rank.department === 'FIRE').map((e) => line(e, (v) => `<@&${v}>`)) },
    { title: `${ICONS.EMS} EMS Ranks`, lines: RANK_ENTRIES.filter((e) => e.rank.department === 'EMS').map((e) => line(e, (v) => `<@&${v}>`)) },
  ];
  const pages = [];
  for (const section of sections) {
    for (const chunk of chunkLines(section.lines, 3800, 25)) {
      pages.push(baseEmbed({ color: COLORS.NEUTRAL, title: section.title, description: chunk.join('\n') }));
    }
  }
  pages[0].setDescription(`Use \`/config channel\`, \`/config role\` and \`/config rank\` to change settings, \`/config check\` to diagnose problems.\n\n${pages[0].data.description}`);
  return sendPaginated(interaction, pages);
}

async function setChannel(interaction) {
  const entry = entryByKey(interaction.options.getString('setting'));
  const channel = interaction.options.getChannel('channel');
  const perms = channel.permissionsFor(interaction.guild.members.me);
  const missing = perms ? BOT_CHANNEL_PERMS.filter((p) => !perms.has(p)) : BOT_CHANNEL_PERMS;

  settings.setSetting(entry.key, channel.id);
  await logManagement(interaction.guild, { title: 'Config Changed', staff: interaction.user, color: COLORS.INFO, fields: { Setting: entry.label, Value: `<#${channel.id}>` } });
  return replySuccess(
    interaction,
    'Channel Saved',
    `**${entry.label}** → ${channel}${missing.length ? `\n\n⚠️ The bot is missing **${missing.map(permName).join(', ')}** in that channel. Fix its permissions or posts will fail.` : ''}`
  );
}

async function setRole(interaction, settingKey) {
  const entry = entryByKey(settingKey);
  if (!entry || entry.kind === 'channel') return replyError(interaction, 'Pick a setting from the list.');
  const role = interaction.options.getRole('role');
  if (role.id === interaction.guild.id) return replyError(interaction, 'You cannot use @everyone here.');
  if (role.managed) return replyError(interaction, `${role} is managed by an integration/bot and cannot be assigned.`);

  const duplicate = ALL_ENTRIES.find((e) => e.key !== entry.key && e.kind !== 'channel' && current(e).value === role.id);
  if (duplicate && (entry.kind === 'rank' || duplicate.kind === 'rank')) {
    return replyError(interaction, `${role} is already linked to **${duplicate.label}**. Each rank needs its own role.`);
  }

  settings.setSetting(entry.key, role.id);
  const fullRole = interaction.guild.roles.cache.get(role.id);
  const warnings = [];
  if (fullRole && !fullRole.editable) warnings.push(`⚠️ ${role} is **above the bot's role**. Move the bot's role higher in Server Settings → Roles, or the bot cannot give/remove it.`);
  if (duplicate) warnings.push(`ℹ️ This role is also linked to **${duplicate.label}**.`);

  await logManagement(interaction.guild, { title: 'Config Changed', staff: interaction.user, color: COLORS.INFO, fields: { Setting: entry.label, Value: `<@&${role.id}>` } });
  return replySuccess(interaction, 'Role Saved', `**${entry.label}** → ${role}${warnings.length ? `\n\n${warnings.join('\n')}` : ''}`);
}

async function clear(interaction) {
  const entry = entryByKey(interaction.options.getString('setting'));
  if (!entry) return replyError(interaction, 'Pick a setting from the list.');
  if (!settings.getSetting(entry.key)) return replyError(interaction, `**${entry.label}** has no value saved in Discord.`);
  settings.clearSetting(entry.key);
  const fallback = current(entry);
  await logManagement(interaction.guild, { title: 'Config Cleared', staff: interaction.user, color: COLORS.WARNING, fields: { Setting: entry.label } });
  return replySuccess(interaction, 'Setting Cleared', `**${entry.label}** ${fallback.value ? 'now uses the value from .env.' : 'is no longer set.'}`);
}

async function check(interaction) {
  await deferEphemeral(interaction);
  const guild = interaction.guild;
  await guild.roles.fetch().catch(() => {});
  const me = guild.members.me;
  const errors = [];
  const warnings = [];
  const ok = [];

  // Bot server permissions
  const needed = [
    [PermissionFlagsBits.ManageRoles, 'Manage Roles', 'needed for ranks, duty/leave/suspension roles'],
    [PermissionFlagsBits.SendMessages, 'Send Messages'],
    [PermissionFlagsBits.EmbedLinks, 'Embed Links'],
  ];
  for (const [flag, name, why] of needed) {
    if (me.permissions.has(flag)) ok.push(`Bot has **${name}**`);
    else errors.push(`Bot is missing **${name}**${why ? ` (${why})` : ''}.`);
  }
  if (POLICY.BLACKLIST_ACTION === 'kick' && !me.permissions.has(PermissionFlagsBits.KickMembers)) errors.push('BLACKLIST_ACTION=kick but the bot lacks **Kick Members**.');
  if (POLICY.BLACKLIST_ACTION === 'ban' && !me.permissions.has(PermissionFlagsBits.BanMembers)) errors.push('BLACKLIST_ACTION=ban but the bot lacks **Ban Members**.');

  // Roles
  const unconfiguredRanks = RANK_ENTRIES.filter((e) => !current(e).value);
  if (unconfiguredRanks.length === RANK_ENTRIES.length) errors.push('**No rank roles are linked.** Use `/config rank` for each rank.');
  else if (unconfiguredRanks.length) warnings.push(`${unconfiguredRanks.length} rank(s) not linked: ${unconfiguredRanks.map((e) => e.rank.name).join(', ')}`);
  else ok.push('All ranks linked');

  const aboveBot = [];
  for (const entry of [...RANK_ENTRIES, ...ROLE_ENTRIES]) {
    const { value } = current(entry);
    if (!value) continue;
    const role = guild.roles.cache.get(value);
    if (!role) errors.push(`**${entry.label}** points to a role that no longer exists (\`${value}\`).`);
    else if (!role.editable) aboveBot.push(role.name);
  }
  if (aboveBot.length) errors.push(`The bot's role is **below** these roles, so it cannot assign them: ${aboveBot.join(', ')}. Drag the bot's role above them.`);

  const missingRoles = ROLE_ENTRIES.filter((e) => !current(e).value);
  if (missingRoles.length) warnings.push(`Optional roles not set: ${missingRoles.map((e) => e.label.replace('Certification: ', '')).join(', ')} — \`/config autosetup\` can create them.`);

  // Channels
  for (const entry of CHANNEL_ENTRIES) {
    const { value } = current(entry);
    if (!value) {
      if (!entry.def.fallback) warnings.push(`Channel **${entry.label}** is not set.`);
      continue;
    }
    const channel = await guild.channels.fetch(value).catch(() => null);
    if (!channel) {
      errors.push(`Channel **${entry.label}** points to a channel that no longer exists (\`${value}\`).`);
      continue;
    }
    const perms = channel.permissionsFor(me);
    const missing = BOT_CHANNEL_PERMS.filter((p) => !perms?.has(p));
    if (missing.length) errors.push(`Bot is missing **${missing.map(permName).join(', ')}** in ${channel} (${entry.label}).`);
  }

  const embed = baseEmbed({
    color: errors.length ? COLORS.DANGER : warnings.length ? COLORS.WARNING : COLORS.SUCCESS,
    title: `${ICONS.CONFIG} Configuration Check`,
    description: errors.length ? `Found **${errors.length}** problem(s) that will break features.` : warnings.length ? 'Everything critical works. Some optional features are not set up yet.' : 'Everything is configured correctly. 🎉',
  });
  addField(embed, `${ICONS.DENY} Problems (${errors.length})`, errors.join('\n') || 'None');
  addField(embed, `⚠️ Warnings (${warnings.length})`, warnings.join('\n') || 'None');
  addField(embed, `${ICONS.APPROVE} OK`, ok.join(' • '));
  return interaction.editReply({ embeds: [embed] });
}

async function autosetup(interaction) {
  const scope = interaction.options.getString('scope');
  const guild = interaction.guild;
  const me = guild.members.me;

  const logDefaultSet = Boolean(current(entryByKey('channel.LOG_DEFAULT')).value);
  const channelsToCreate =
    scope === 'roles'
      ? []
      : CHANNEL_ENTRIES.filter((e) => !current(e).value).filter((e) => !(e.def.fallback === 'LOG_DEFAULT' && logDefaultSet));
  const rolesToCreate = scope === 'channels' ? [] : ROLE_ENTRIES.filter((e) => !current(e).value);

  if (!channelsToCreate.length && !rolesToCreate.length) return replySuccess(interaction, 'Nothing to Create', 'Everything in that scope is already configured.');
  if (channelsToCreate.length && !me.permissions.has(PermissionFlagsBits.ManageChannels)) return replyError(interaction, 'The bot needs **Manage Channels** to create channels.');
  if (rolesToCreate.length && !me.permissions.has(PermissionFlagsBits.ManageRoles)) return replyError(interaction, 'The bot needs **Manage Roles** to create roles.');

  await deferEphemeral(interaction);
  const preview = baseEmbed({
    color: COLORS.WARNING,
    title: `${ICONS.CONFIG} Auto-Setup Preview`,
    description: 'The following will be **created** and linked automatically. Existing settings are not changed. Rank roles are never created.',
  });
  if (channelsToCreate.length) addField(preview, `Channels (${channelsToCreate.length})`, channelsToCreate.map((e) => `#${e.def.autoCreate} — ${e.label} (${e.def.visibility === 'staff' ? 'staff only' : 'public, read-only'})`).join('\n'));
  if (rolesToCreate.length) addField(preview, `Roles (${rolesToCreate.length})`, rolesToCreate.map((e) => `@${e.def.autoCreate}`).join(', '));
  const { confirmed } = await requestConfirmation(interaction, preview, { confirmLabel: 'Create Everything', timeoutMs: 120000 });
  if (!confirmed) return;

  const created = [];
  const failed = [];

  for (const entry of rolesToCreate) {
    try {
      const role = await guild.roles.create({
        name: entry.def.autoCreate,
        color: ROLE_COLORS[entry.id] ?? (entry.def.cert ? 0x7f8c8d : 0),
        mentionable: entry.id === 'SESSION_PING' || entry.id === 'TRAINING_PING',
        hoist: entry.id === 'ON_DUTY',
        reason: `LAFD Management autosetup by ${interaction.user.tag}`,
      });
      settings.setSetting(entry.key, role.id);
      created.push(`${role}`);
    } catch (err) {
      failed.push(`@${entry.def.autoCreate}: ${err.message}`);
    }
  }

  if (channelsToCreate.length) {
    const staffRoleIds = [
      ...ALL_RANKS.filter((r) => r.level >= 1).map((r) => r.roleId),
      ...Object.entries(ROLE_SETTINGS)
        .filter(([, def]) => def.level >= 1)
        .map(([key]) => settings.resolve(`role.${key}`, ROLE_SETTINGS[key].env)),
    ].filter((id) => id && guild.roles.cache.has(id));
    const botAllow = [...BOT_CHANNEL_PERMS, PermissionFlagsBits.ManageMessages];
    const categories = {};

    for (const entry of channelsToCreate) {
      try {
        const categoryName = CATEGORY_NAMES[entry.def.category];
        if (!categories[categoryName]) {
          categories[categoryName] =
            guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === categoryName) ||
            (await guild.channels.create({
              name: categoryName,
              type: ChannelType.GuildCategory,
              permissionOverwrites:
                entry.def.visibility === 'staff'
                  ? [
                      { id: guild.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
                      { id: me.id, type: OverwriteType.Member, allow: botAllow },
                    ]
                  : [],
              reason: 'LAFD Management autosetup',
            }));
        }

        const overwrites =
          entry.def.visibility === 'staff'
            ? [
                { id: guild.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
                ...staffRoleIds.map((id) => ({ id, type: OverwriteType.Role, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] })),
                { id: me.id, type: OverwriteType.Member, allow: botAllow },
              ]
            : [
                { id: guild.id, type: OverwriteType.Role, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
                { id: me.id, type: OverwriteType.Member, allow: botAllow },
              ];

        const channel = await guild.channels.create({
          name: entry.def.autoCreate,
          type: ChannelType.GuildText,
          parent: categories[categoryName].id,
          topic: `LAFD Management • ${entry.def.description}`,
          permissionOverwrites: overwrites,
          reason: `LAFD Management autosetup by ${interaction.user.tag}`,
        });
        settings.setSetting(entry.key, channel.id);
        created.push(`${channel}`);
      } catch (err) {
        failed.push(`#${entry.def.autoCreate}: ${err.message}`);
      }
    }
  }

  const result = baseEmbed({
    color: failed.length ? COLORS.WARNING : COLORS.SUCCESS,
    title: `${ICONS.CONFIG} Auto-Setup Complete`,
    description: `Created and linked **${created.length}** item(s).${channelsToCreate.some((e) => e.def.visibility === 'staff') ? '\nStaff channels are visible to Company Officer ranks and above.' : ''}`,
  });
  addField(result, 'Created', created.join(' ').slice(0, 1024) || 'Nothing');
  addField(result, 'Failed', failed.join('\n'));
  addField(result, 'Next Step', 'Run `/config check` to confirm everything is healthy.');
  await interaction.editReply({ content: null, embeds: [result], components: [] });

  await logManagement(guild, {
    title: 'Auto-Setup Ran',
    staff: interaction.user,
    color: COLORS.INFO,
    fields: { Created: created.join(' ').slice(0, 1000) || 'Nothing', Failed: failed.join('\n').slice(0, 1000) },
  });
}

function permName(flag) {
  return Object.entries(PermissionFlagsBits).find(([, v]) => v === flag)?.[0].replace(/([a-z])([A-Z])/g, '$1 $2') || String(flag);
}

