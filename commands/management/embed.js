/**
 * /embed create | edit | post | image | rename | list | delete
 * -----------------------------------------------------------------------
 * Custom embed builder, entirely inside Discord. Build an embed with a live
 * preview, save it, post it anywhere, and edit it later - every posted copy
 * is updated automatically.
 *
 * Hidden from non-admins (default member permissions 0) and checked again
 * in code: server Administrators or EMBED_BUILDER level only.
 *
 * Custom ID prefixes (both stateless - everything is read from the DB):
 *   ceb:<embedId>:<action>[:<extra>]   builder controls (admins only)
 *   ce:<embedId>:b:<i> / ce:<embedId>:m public buttons & menu on posted embeds
 * Rendering, validation, images and sync live in services/customEmbeds.js.
 * -----------------------------------------------------------------------
 */

const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const { REQUIRED_LEVEL, COLORS } = require('../../config');
const db = require('../../database/db');
const { hasPermission, isServerAdmin } = require('../../utils/permissions');
const { replyNoPermission, replyError } = require('../../utils/replies');
const { baseEmbed } = require('../../utils/embeds');
const { requestConfirmation } = require('../../utils/confirmation');
const { logManagement } = require('../../utils/logger');
const { ts, truncate, isValidUrl } = require('../../utils/format');
const ce = require('../../services/customEmbeds');

const ACTIONS = [
  { value: 'text', label: 'Title, text, footer & colour', emoji: '✏️' },
  { value: 'top_image', label: 'Top image', emoji: '🖼️', description: 'Small image shown above the embed' },
  { value: 'bottom_image', label: 'Bottom image', emoji: '🖼️', description: 'Big image inside the embed' },
  { value: 'add_field', label: 'Add a field', emoji: '➕' },
  { value: 'remove_field', label: 'Remove a field', emoji: '➖' },
  { value: 'add_link', label: 'Add a link button', emoji: '🔗', description: 'Opens a website or jumps to a channel' },
  { value: 'add_reply', label: 'Add a hidden-reply button', emoji: '➕', description: 'Shows a private message to whoever clicks' },
  { value: 'reply_extras', label: 'Reply page extras', emoji: '🧩', description: "Footer, image & links for a hidden reply" },
  { value: 'remove_button', label: 'Remove a button', emoji: '➖' },
  { value: 'menu_placeholder', label: 'Menu placeholder text', emoji: '📋' },
  { value: 'add_option', label: 'Add a menu option', emoji: '➕' },
  { value: 'remove_option', label: 'Remove a menu option', emoji: '➖' },
];

const canUse = (member) => isServerAdmin(member) || hasPermission(member, REQUIRED_LEVEL.EMBED_BUILDER);
const clean = (value) => (value && value.trim() ? value.trim() : null);

// ---------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------
function summaryLine(record) {
  const d = ce.normalize(record.data);
  return [
    `🛠️ **Embed builder — \`${record.name}\`** · changes save instantly`,
    `Buttons **${d.buttons.length}/${ce.LIMITS.BUTTONS}** · Menu options **${d.menu?.options.length || 0}/${ce.LIMITS.OPTIONS}** · Fields **${d.fields.length}/${ce.LIMITS.FIELDS}** · Posted copies **${db.getCustomEmbedPosts(record.id).length}**`,
    `Top image: ${ce.imageLabel(d.topImage)} · Bottom image: ${ce.imageLabel(d.bottomImage)}`,
  ].join('\n');
}

function builderPayload(record, notice) {
  const view = ce.renderEmbed(record, { preview: true });
  const actionRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`ceb:${record.id}:act`)
      .setPlaceholder('Choose what to change…')
      .addOptions(ACTIONS.map((a) => ({ label: a.label, value: a.value, emoji: a.emoji, ...(a.description ? { description: a.description } : {}) })))
  );
  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ceb:${record.id}:post`).setLabel('Post').setEmoji('📤').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ceb:${record.id}:done`).setLabel('Done').setStyle(ButtonStyle.Secondary)
  );
  return {
    content: [notice, summaryLine(record)].filter(Boolean).join('\n'),
    embeds: view.embeds,
    components: [...view.components, actionRow, controls],
    files: view.files,
  };
}

function pickerPayload(record, text, pickerComponent) {
  const view = ce.renderEmbed(record, { preview: true });
  return {
    content: `${text}\n-# Editing \`${record.name}\``,
    embeds: view.embeds,
    components: [
      new ActionRowBuilder().addComponents(pickerComponent),
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ceb:${record.id}:back`).setLabel('Back').setEmoji('↩️').setStyle(ButtonStyle.Secondary)),
    ],
    files: view.files,
  };
}

/** Shows a payload on the builder message, whatever kind of interaction we have. */
function show(interaction, payload) {
  if (interaction.isChatInputCommand()) {
    if (interaction.deferred || interaction.replied) return interaction.editReply({ ...payload, attachments: [] });
    return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  }
  if (interaction.deferred || interaction.replied) return interaction.editReply({ ...payload, attachments: [] });
  return interaction.update({ ...payload, attachments: [] });
}

const showBuilder = (interaction, record, notice) => show(interaction, builderPayload(record, notice));

/** Applies a change, validates, saves, refreshes the builder and syncs posted copies. */
async function applyChange(interaction, record, mutate) {
  const data = ce.normalize(structuredClone(record.data));
  const notice = mutate(data);
  if (notice?.startsWith('⚠️')) return showBuilder(interaction, record, notice);
  if (ce.textLength(data) > ce.LIMITS.TOTAL_CHARS) {
    return showBuilder(interaction, record, `⚠️ Too much text — Discord embeds allow about ${ce.LIMITS.TOTAL_CHARS} characters in total. Nothing was changed.`);
  }
  const saved = db.saveCustomEmbedData(record.id, data);
  ce.pruneUploads(record.id, data);
  await showBuilder(interaction, saved, notice || '✅ Saved.');
  ce.scheduleSync(interaction.client, record.id);
}

// ---------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------
function input(id, label, style, { required = false, max, value, placeholder } = {}) {
  const field = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
  if (max) field.setMaxLength(max);
  if (placeholder) field.setPlaceholder(placeholder);
  if (value) field.setValue(String(value).slice(0, max || 4000));
  return new ActionRowBuilder().addComponents(field);
}

function modal(customId, title, rows) {
  return new ModalBuilder().setCustomId(customId).setTitle(title.slice(0, 45)).addComponents(rows);
}

const REPLY_TEXT_HINT = 'Shown privately to whoever clicks';

function modalFor(record, kind, extra) {
  const d = ce.normalize(record.data);
  const id = `ceb:${record.id}:${kind}${extra !== undefined ? `:${extra}` : ''}`;
  const S = TextInputStyle.Short;
  const P = TextInputStyle.Paragraph;

  switch (kind) {
    case 'm_text':
      return modal(id, 'Title, text, footer & colour', [
        input('title', 'Title', S, { max: 256, value: d.title }),
        input('description', 'Text (markdown supported)', P, { max: 4000, value: d.description }),
        input('footer', 'Footer', S, { max: 2048, value: d.footer }),
        input('color', 'Colour (hex, e.g. #9E1B1B)', S, { max: 7, value: d.color, required: true }),
      ]);
    case 'm_field':
      return modal(id, 'Add a field', [
        input('name', 'Field name', S, { max: 256, required: true }),
        input('value', 'Field text', P, { max: 1024, required: true }),
        input('inline', 'Side by side with other fields? (yes/no)', S, { max: 3, value: 'no' }),
      ]);
    case 'm_link':
      return modal(id, 'Add a link button', [
        input('label', 'Button label', S, { max: 80, required: true }),
        input('emoji', 'Emoji (optional)', S, { max: 64, placeholder: '🔗 or <:name:id>' }),
        input('target', 'Website URL, #channel or channel ID', S, { max: 512, placeholder: 'Leave empty to pick a channel next' }),
      ]);
    case 'm_reply':
      return modal(id, 'Add a hidden-reply button', [
        input('label', 'Button label', S, { max: 80, required: true }),
        input('emoji', 'Emoji (optional)', S, { max: 64 }),
        input('style', 'Colour: primary / secondary / success / danger', S, { max: 9, value: 'primary' }),
        input('reply_title', 'Reply title (optional)', S, { max: 256 }),
        input('reply_text', `Reply text — ${REPLY_TEXT_HINT}`, P, { max: 4000, required: true }),
      ]);
    case 'm_placeholder':
      return modal(id, 'Menu placeholder text', [input('placeholder', 'Placeholder', S, { max: 150, value: d.menu?.placeholder, placeholder: 'Select an option…' })]);
    case 'm_option':
      return modal(id, 'Add a menu option', [
        input('label', 'Option label', S, { max: 100, required: true }),
        input('description', 'Small description (optional)', S, { max: 100 }),
        input('emoji', 'Emoji (optional)', S, { max: 64 }),
        input('reply_title', 'Reply title (optional)', S, { max: 256 }),
        input('reply_text', `Reply text — ${REPLY_TEXT_HINT}`, P, { max: 4000, required: true }),
      ]);
    case 'm_imgurl':
      return modal(id, `${extra === 'top' ? 'Top' : 'Bottom'} image from a URL`, [input('url', 'Direct image URL (https://…)', S, { max: 512, required: true })]);
    case 'm_extras': {
      const reply = replyTarget(d, extra)?.reply || {};
      return modal(id, 'Reply page extras', [
        input('footer', 'Reply footer', S, { max: 2048, value: reply.footer }),
        input('image', 'Reply image: https URL or preset key', S, { max: 512, value: reply.image?.startsWith('url:') ? reply.image.slice(4) : reply.image }),
        input('links', 'Links: one per line → Label | URL or #channel', P, {
          max: 1500,
          value: (reply.links || []).map((l) => `${l.label} | ${l.url}`).join('\n'),
          placeholder: 'Rules | https://example.com\nApply | #applications',
        }),
      ]);
    }
    default:
      return null;
  }
}

/** 'b3' -> buttons[3], 'o2' -> menu.options[2] */
function replyTarget(d, key) {
  const index = Number(String(key).slice(1));
  if (String(key).startsWith('b')) return d.buttons[index]?.action === 'reply' ? d.buttons[index] : null;
  return d.menu?.options[index] || null;
}

// ---------------------------------------------------------------------
// Pickers
// ---------------------------------------------------------------------
function imagePicker(record, where) {
  const options = [{ label: 'None', value: 'none', emoji: '🚫' }];
  for (const [key, preset] of Object.entries(ce.getImagePresets())) options.push({ label: preset.name.slice(0, 100), value: `preset:${key}`, emoji: '⭐' });
  for (const file of ce.uploadedFiles(record.id).slice(0, 15)) options.push({ label: `Uploaded: ${file}`.slice(0, 100), value: `upload:${file}`.slice(0, 100), emoji: '📁' });
  options.push({ label: 'Use an image URL…', value: 'url', emoji: '🌐' });
  options.push({ label: 'Upload a new image…', value: 'upload_new', emoji: '📤', description: 'Use /embed image to upload from your device' });
  return new StringSelectMenuBuilder().setCustomId(`ceb:${record.id}:img:${where}`).setPlaceholder(`Choose the ${where} image`).addOptions(options.slice(0, 25));
}

function listPicker(record, action, placeholder, items) {
  return new StringSelectMenuBuilder()
    .setCustomId(`ceb:${record.id}:${action}`)
    .setPlaceholder(placeholder)
    .addOptions(items.slice(0, 25).map((it) => ({ label: truncate(it.label, 100), value: it.value, ...(it.description ? { description: truncate(it.description, 100) } : {}) })));
}

function channelPicker(customId, placeholder) {
  return new ChannelSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
}

// ---------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------
const nameOption = (o, description = 'Saved embed') => o.setName('name').setDescription(description).setRequired(true).setAutocomplete(true);

module.exports = {
  category: 'Management',
  level: REQUIRED_LEVEL.EMBED_BUILDER,
  componentPrefix: ['ceb', 'ce'],
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Build, save, post and edit custom embeds.')
    .setDefaultMemberPermissions(0)
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Start a new saved embed and open the builder.')
        .addStringOption((o) => o.setName('name').setDescription('A name to find it by later').setRequired(true).setMaxLength(50))
    )
    .addSubcommand((s) => s.setName('edit').setDescription('Reopen the builder for a saved embed.').addStringOption((o) => nameOption(o)))
    .addSubcommand((s) =>
      s
        .setName('post')
        .setDescription('Post a saved embed.')
        .addStringOption((o) => nameOption(o))
        .addChannelOption((o) => o.setName('channel').setDescription('Channel (default: this one)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    )
    .addSubcommand((s) =>
      s
        .setName('image')
        .setDescription('Upload your own image (PNG/JPG/GIF/WEBP, max 8 MB).')
        .addStringOption((o) => nameOption(o))
        .addStringOption((o) =>
          o.setName('where').setDescription('Where the image goes').setRequired(true).addChoices({ name: 'Top image', value: 'top' }, { name: 'Bottom image', value: 'bottom' })
        )
        .addAttachmentOption((o) => o.setName('file').setDescription('The image').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('rename')
        .setDescription('Rename a saved embed.')
        .addStringOption((o) => nameOption(o))
        .addStringOption((o) => o.setName('new_name').setDescription('New name').setRequired(true).setMaxLength(50))
    )
    .addSubcommand((s) => s.setName('list').setDescription('List all saved embeds.'))
    .addSubcommand((s) => s.setName('delete').setDescription('Delete a saved embed.').addStringOption((o) => nameOption(o))),

  async autocomplete(interaction) {
    if (!canUse(interaction.member)) return interaction.respond([]);
    const query = interaction.options.getFocused().toLowerCase();
    const choices = db
      .getAllCustomEmbeds()
      .filter((e) => e.name.toLowerCase().includes(query))
      .slice(0, 25)
      .map((e) => ({ name: e.name, value: e.name }));
    return interaction.respond(choices);
  },

  async execute(interaction) {
    if (!canUse(interaction.member)) return replyNoPermission(interaction, REQUIRED_LEVEL.EMBED_BUILDER);
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const name = interaction.options.getString('name').trim();
      if (!name) return replyError(interaction, 'Give the embed a name.');
      if (db.getCustomEmbedByName(name)) return replyError(interaction, `An embed called \`${name}\` already exists. Use \`/embed edit\`.`);
      const record = db.createCustomEmbed(name, ce.defaultData(), interaction.user.id);
      await logManagement(interaction.guild, { title: 'Custom Embed Created', staff: interaction.user, color: COLORS.INFO, fields: { Name: name } });
      return showBuilder(interaction, record, '✨ New embed created.');
    }

    if (sub === 'list') return list(interaction);

    const record = db.getCustomEmbedByName(interaction.options.getString('name'));
    if (!record) return replyError(interaction, 'No saved embed with that name. Pick one from the list.');

    if (sub === 'edit') return showBuilder(interaction, record);
    if (sub === 'post') return postCommand(interaction, record);
    if (sub === 'image') return imageCommand(interaction, record);
    if (sub === 'rename') {
      const newName = interaction.options.getString('new_name').trim();
      const existing = db.getCustomEmbedByName(newName);
      if (!newName) return replyError(interaction, 'Give the embed a name.');
      if (existing && existing.id !== record.id) return replyError(interaction, `An embed called \`${newName}\` already exists.`);
      db.renameCustomEmbed(record.id, newName);
      return interaction.reply({ content: `✅ Renamed \`${record.name}\` → \`${newName}\`.`, flags: MessageFlags.Ephemeral });
    }
    if (sub === 'delete') return deleteCommand(interaction, record);
  },

  async handleComponent(interaction, args, prefix) {
    if (prefix === 'ce') return handlePublic(interaction, args);
    return handleBuilder(interaction, args);
  },
};

// ---------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------
async function list(interaction) {
  const all = db.getAllCustomEmbeds();
  const embed = baseEmbed({
    color: COLORS.INFO,
    title: `🧱 Saved Embeds (${all.length})`,
    description: all.length
      ? all
          .slice(0, 40)
          .map((e) => {
            const d = ce.normalize(e.data);
            return `**${e.name}** · ${d.buttons.length} button(s) · ${d.menu?.options.length || 0} option(s) · ${db.getCustomEmbedPosts(e.id).length} posted · edited ${ts(e.updated_at, 'R')}`;
          })
          .join('\n')
      : 'No saved embeds yet. Start one with `/embed create`.',
  });
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function checkPostChannel(guild, channel) {
  if (!channel?.isTextBased?.()) return 'That channel cannot receive messages.';
  const perms = channel.permissionsFor(guild.members.me);
  const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles];
  if (!perms?.has(needed)) return `The bot needs View Channel, Send Messages, Embed Links and Attach Files in ${channel}.`;
  return null;
}

async function postCommand(interaction, record) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!ce.hasMainContent(ce.normalize(record.data)) && !record.data.topImage) return replyError(interaction, 'This embed is empty. Add some content with `/embed edit` first.');
  const option = interaction.options.getChannel('channel');
  const channel = option ? await interaction.guild.channels.fetch(option.id).catch(() => null) : interaction.channel;
  const problem = await checkPostChannel(interaction.guild, channel);
  if (problem) return replyError(interaction, problem);
  try {
    const message = await ce.postEmbed(record, channel);
    await logManagement(interaction.guild, { title: 'Custom Embed Posted', staff: interaction.user, color: COLORS.INFO, fields: { Name: record.name, Channel: `<#${channel.id}>` } });
    return interaction.editReply({ content: `📤 Posted \`${record.name}\`: ${message.url}\nEditing the embed later updates this message too.` });
  } catch (err) {
    console.error('[Embed] Post failed:', err);
    return replyError(interaction, `Could not post: ${err.message}`);
  }
}

async function imageCommand(interaction, record) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const where = interaction.options.getString('where');
  const attachment = interaction.options.getAttachment('file');
  let result;
  try {
    result = await ce.saveUpload(record.id, where, attachment);
  } catch (err) {
    console.error('[Embed] Image upload failed:', err);
    result = { error: 'Could not save that image. Try again.' };
  }
  if (result.error) return showBuilder(interaction, record, `⚠️ ${result.error}`);
  return applyChange(interaction, record, (d) => {
    d[where === 'top' ? 'topImage' : 'bottomImage'] = result.ref;
    return `🖼️ ${where === 'top' ? 'Top' : 'Bottom'} image uploaded and saved.`;
  });
}

async function deleteCommand(interaction, record) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const posts = db.getCustomEmbedPosts(record.id).length;
  const preview = baseEmbed({
    color: COLORS.DANGER,
    title: `Delete \`${record.name}\`?`,
    description: `This removes the saved embed and its uploaded images.${posts ? `\nIts **${posts}** posted cop${posts === 1 ? 'y stays' : 'ies stay'} visible, but their buttons will answer "This embed no longer exists".` : ''}`,
  });
  const { confirmed } = await requestConfirmation(interaction, preview, { confirmLabel: 'Delete', danger: true });
  if (!confirmed) return;
  db.deleteCustomEmbed(record.id);
  ce.deleteUploads(record.id);
  await logManagement(interaction.guild, { title: 'Custom Embed Deleted', staff: interaction.user, color: COLORS.WARNING, fields: { Name: record.name } });
  return interaction.editReply({ content: `🗑️ Deleted \`${record.name}\`.`, embeds: [], components: [] });
}

// ---------------------------------------------------------------------
// Public buttons / menus on posted embeds
// ---------------------------------------------------------------------
async function handlePublic(interaction, [idRaw, kind, indexRaw]) {
  const record = db.getCustomEmbed(Number(idRaw));
  if (!record) return interaction.reply({ content: 'This embed no longer exists.', flags: MessageFlags.Ephemeral });
  const d = ce.normalize(record.data);
  const index = Number(kind === 'm' ? interaction.values?.[0] : indexRaw);
  const item = kind === 'm' ? d.menu?.options[index] : d.buttons[index];
  if (!item || (kind === 'b' && item.action !== 'reply')) {
    return interaction.reply({ content: 'This option is no longer available.', flags: MessageFlags.Ephemeral });
  }
  return interaction.reply({ ...ce.renderReply(record, item.reply), flags: MessageFlags.Ephemeral });
}

// ---------------------------------------------------------------------
// Builder interactions
// ---------------------------------------------------------------------
async function handleBuilder(interaction, [idRaw, action, extra]) {
  if (!canUse(interaction.member)) return replyNoPermission(interaction, REQUIRED_LEVEL.EMBED_BUILDER);
  const record = db.getCustomEmbed(Number(idRaw));
  if (!record) {
    if (interaction.isModalSubmit() && !interaction.isFromMessage()) return replyError(interaction, 'This embed no longer exists.');
    return interaction.update({ content: '🗑️ This embed no longer exists.', embeds: [], components: [], attachments: [] });
  }
  const d = ce.normalize(record.data);

  if (interaction.isModalSubmit()) return handleModal(interaction, record, action, extra);

  switch (action) {
    case 'act':
      return handleAction(interaction, record, d, interaction.values[0]);
    case 'back':
      return showBuilder(interaction, record);
    case 'done':
      return interaction.update({ content: `✅ \`${record.name}\` is saved. Reopen it any time with \`/embed edit\`.`, embeds: [], components: [], attachments: [] });
    case 'post':
      return show(interaction, pickerPayload(record, '📤 **Where should it be posted?**', channelPicker(`ceb:${record.id}:postto`, 'Pick a channel')));
    case 'postto':
      return postFromBuilder(interaction, record);
    case 'img': {
      const choice = interaction.values[0];
      if (choice === 'url') return interaction.showModal(modalFor(record, 'm_imgurl', extra));
      if (choice === 'upload_new') {
        return showBuilder(interaction, record, `📤 Run \`/embed image name:${record.name} where:${extra === 'top' ? 'Top image' : 'Bottom image'}\` and attach your image.`);
      }
      const ref = choice === 'none' ? null : choice.startsWith('preset:') ? choice.slice(7) : choice;
      return applyChange(interaction, record, (data) => {
        data[extra === 'top' ? 'topImage' : 'bottomImage'] = ref;
        return `🖼️ ${extra === 'top' ? 'Top' : 'Bottom'} image: ${ce.imageLabel(ref)}.`;
      });
    }
    case 'rmfield':
    case 'rmbtn':
    case 'rmopt': {
      const index = Number(interaction.values[0]);
      return applyChange(interaction, record, (data) => {
        const list = action === 'rmfield' ? data.fields : action === 'rmbtn' ? data.buttons : data.menu?.options || [];
        if (!list[index]) return '⚠️ That item no longer exists.';
        list.splice(index, 1);
        if (action === 'rmopt' && data.menu && !data.menu.options.length && !data.menu.placeholder) data.menu = null;
        return '➖ Removed.';
      });
    }
    case 'extras':
      return interaction.showModal(modalFor(record, 'm_extras', interaction.values[0]));
    case 'chan': {
      const channelId = interaction.values[0];
      return applyChange(interaction, record, (data) => {
        const button = data.buttons[Number(extra)];
        if (!button) return '⚠️ That button no longer exists.';
        button.url = `https://discord.com/channels/${interaction.guildId}/${channelId}`;
        return `🔗 Button **${button.label}** now jumps to <#${channelId}>.`;
      });
    }
    default:
      return showBuilder(interaction, record);
  }
}

async function handleAction(interaction, record, d, value) {
  const replyItems = [
    ...d.buttons.map((b, i) => (b.action === 'reply' ? { label: `Button: ${b.label}`, value: `b${i}` } : null)).filter(Boolean),
    ...(d.menu?.options || []).map((o, i) => ({ label: `Menu option: ${o.label}`, value: `o${i}` })),
  ];

  switch (value) {
    case 'text':
      return interaction.showModal(modalFor(record, 'm_text'));
    case 'top_image':
    case 'bottom_image': {
      const where = value === 'top_image' ? 'top' : 'bottom';
      return show(interaction, pickerPayload(record, `🖼️ **Pick the ${where} image.** Upload your own with \`/embed image\`.`, imagePicker(record, where)));
    }
    case 'add_field':
      if (d.fields.length >= ce.LIMITS.FIELDS) return showBuilder(interaction, record, `⚠️ Embeds can have at most ${ce.LIMITS.FIELDS} fields.`);
      return interaction.showModal(modalFor(record, 'm_field'));
    case 'remove_field':
      if (!d.fields.length) return showBuilder(interaction, record, '⚠️ There are no fields to remove.');
      return show(interaction, pickerPayload(record, '➖ **Which field should be removed?**', listPicker(record, 'rmfield', 'Pick a field', d.fields.map((f, i) => ({ label: f.name, value: String(i), description: f.value })))));
    case 'add_link':
    case 'add_reply':
      if (d.buttons.length >= ce.LIMITS.BUTTONS) return showBuilder(interaction, record, `⚠️ Embeds can have at most ${ce.LIMITS.BUTTONS} buttons.`);
      return interaction.showModal(modalFor(record, value === 'add_link' ? 'm_link' : 'm_reply'));
    case 'reply_extras':
      if (!replyItems.length) return showBuilder(interaction, record, '⚠️ Add a hidden-reply button or a menu option first.');
      return show(interaction, pickerPayload(record, '🧩 **Which hidden reply do you want to extend?**', listPicker(record, 'extras', 'Pick a button or menu option', replyItems)));
    case 'remove_button':
      if (!d.buttons.length) return showBuilder(interaction, record, '⚠️ There are no buttons to remove.');
      return show(
        interaction,
        pickerPayload(record, '➖ **Which button should be removed?**', listPicker(record, 'rmbtn', 'Pick a button', d.buttons.map((b, i) => ({ label: b.label, value: String(i), description: b.action === 'link' ? b.url || 'Link (no target yet)' : 'Hidden reply' }))))
      );
    case 'menu_placeholder':
      return interaction.showModal(modalFor(record, 'm_placeholder'));
    case 'add_option':
      if ((d.menu?.options.length || 0) >= ce.LIMITS.OPTIONS) return showBuilder(interaction, record, `⚠️ Menus can have at most ${ce.LIMITS.OPTIONS} options.`);
      return interaction.showModal(modalFor(record, 'm_option'));
    case 'remove_option':
      if (!d.menu?.options.length) return showBuilder(interaction, record, '⚠️ There are no menu options to remove.');
      return show(interaction, pickerPayload(record, '➖ **Which menu option should be removed?**', listPicker(record, 'rmopt', 'Pick an option', d.menu.options.map((o, i) => ({ label: o.label, value: String(i), description: o.description })))));
    default:
      return showBuilder(interaction, record);
  }
}

async function handleModal(interaction, record, kind, extra) {
  const get = (id) => {
    try {
      return clean(interaction.fields.getTextInputValue(id));
    } catch {
      return null;
    }
  };

  switch (kind) {
    case 'm_text':
      return applyChange(interaction, record, (d) => {
        d.title = get('title');
        d.description = get('description');
        d.footer = get('footer');
        const color = ce.parseHex(get('color'));
        if (color) d.color = color;
        return color ? '✏️ Text & colour saved.' : `✏️ Text saved. ⚠️ "${get('color')}" isn't a valid hex colour (use something like #9E1B1B), so the colour wasn't changed.`;
      });

    case 'm_field':
      return applyChange(interaction, record, (d) => {
        if (d.fields.length >= ce.LIMITS.FIELDS) return `⚠️ Embeds can have at most ${ce.LIMITS.FIELDS} fields.`;
        d.fields.push({ name: get('name'), value: get('value'), inline: /^y/i.test(get('inline') || '') });
        return '➕ Field added.';
      });

    case 'm_link': {
      const emojiRaw = get('emoji');
      const emoji = ce.parseEmoji(emojiRaw);
      const targetRaw = get('target');
      const url = targetRaw ? ce.parseLinkTarget(targetRaw, interaction.guildId) : null;
      if (targetRaw && !url) return showBuilder(interaction, record, `⚠️ "${truncate(targetRaw, 80)}" isn't a valid https:// URL, #channel or channel ID. Nothing was added.`);
      const data = ce.normalize(structuredClone(record.data));
      if (data.buttons.length >= ce.LIMITS.BUTTONS) return showBuilder(interaction, record, `⚠️ Embeds can have at most ${ce.LIMITS.BUTTONS} buttons.`);
      data.buttons.push({ label: get('label'), emoji, style: 'secondary', action: 'link', url, reply: null });
      const saved = db.saveCustomEmbedData(record.id, data);
      const emojiWarning = emojiRaw && !emoji ? ` ⚠️ "${truncate(emojiRaw, 40)}" isn't a valid emoji, so it was left out.` : '';
      if (url) {
        await showBuilder(interaction, saved, `🔗 Link button added.${emojiWarning}`);
        return ce.scheduleSync(interaction.client, record.id);
      }
      return show(interaction, pickerPayload(saved, `🔗 **Which channel should "${get('label')}" jump to?**${emojiWarning}`, channelPicker(`ceb:${record.id}:chan:${data.buttons.length - 1}`, 'Pick a channel')));
    }

    case 'm_reply':
    case 'm_option':
      return applyChange(interaction, record, (d) => {
        const emojiRaw = get('emoji');
        const emoji = ce.parseEmoji(emojiRaw);
        const reply = { title: get('reply_title'), text: get('reply_text'), image: null, footer: null, links: [] };
        let warning = emojiRaw && !emoji ? ` ⚠️ "${truncate(emojiRaw, 40)}" isn't a valid emoji, so it was left out.` : '';
        if (kind === 'm_reply') {
          if (d.buttons.length >= ce.LIMITS.BUTTONS) return `⚠️ Embeds can have at most ${ce.LIMITS.BUTTONS} buttons.`;
          const styleRaw = (get('style') || 'primary').toLowerCase();
          const style = ce.BUTTON_STYLES[styleRaw] ? styleRaw : 'primary';
          if (style !== styleRaw) warning += ` ⚠️ Unknown colour "${truncate(styleRaw, 20)}" — used primary.`;
          d.buttons.push({ label: get('label'), emoji, style, action: 'reply', url: null, reply });
          return `➕ Hidden-reply button added.${warning}`;
        }
        if (!d.menu) d.menu = { placeholder: null, options: [] };
        if (d.menu.options.length >= ce.LIMITS.OPTIONS) return `⚠️ Menus can have at most ${ce.LIMITS.OPTIONS} options.`;
        d.menu.options.push({ label: get('label'), description: get('description'), emoji, reply });
        return `➕ Menu option added.${warning}`;
      });

    case 'm_placeholder':
      return applyChange(interaction, record, (d) => {
        if (!d.menu) d.menu = { placeholder: null, options: [] };
        d.menu.placeholder = get('placeholder');
        return d.menu.options.length ? '📋 Placeholder saved.' : '📋 Placeholder saved. The menu appears once you add an option.';
      });

    case 'm_imgurl': {
      const url = get('url');
      if (!isValidUrl(url)) return showBuilder(interaction, record, `⚠️ "${truncate(url, 80)}" isn't a valid https:// URL. Nothing was changed.`);
      return applyChange(interaction, record, (d) => {
        d[extra === 'top' ? 'topImage' : 'bottomImage'] = `url:${url}`;
        return '🖼️ Image saved. Tip: links from Discord messages expire — upload with `/embed image` instead.';
      });
    }

    case 'm_extras':
      return applyChange(interaction, record, (d) => {
        const target = replyTarget(d, extra);
        if (!target) return '⚠️ That button or option no longer exists.';
        const warnings = [];
        const imageRaw = get('image');
        let image = null;
        if (imageRaw) {
          if (ce.getImagePresets()[imageRaw]) image = imageRaw;
          else if (imageRaw.startsWith('upload:') && ce.uploadedFiles(record.id).includes(imageRaw.slice(7))) image = imageRaw;
          else if (isValidUrl(imageRaw)) image = `url:${imageRaw}`;
          else warnings.push(`"${truncate(imageRaw, 60)}" isn't a valid image URL or preset`);
        }
        const { links, rejected } = ce.parseLinkLines(get('links'), interaction.guildId);
        if (rejected.length) warnings.push(`skipped ${rejected.length} link line(s) — use "Label | https://…" or "Label | #channel" (max 5)`);
        target.reply = { ...(target.reply || {}), footer: get('footer'), image, links };
        return `🧩 Reply extras saved.${warnings.length ? ` ⚠️ ${warnings.join('; ')}.` : ''}`;
      });

    default:
      return showBuilder(interaction, record);
  }
}

async function postFromBuilder(interaction, record) {
  await interaction.deferUpdate();
  const channel = await interaction.guild.channels.fetch(interaction.values[0]).catch(() => null);
  const d = ce.normalize(record.data);
  if (!ce.hasMainContent(d) && !d.topImage) return showBuilder(interaction, record, '⚠️ This embed is empty — add some content before posting.');
  const problem = await checkPostChannel(interaction.guild, channel);
  if (problem) return showBuilder(interaction, record, `⚠️ ${problem}`);
  try {
    const message = await ce.postEmbed(record, channel);
    await logManagement(interaction.guild, { title: 'Custom Embed Posted', staff: interaction.user, color: COLORS.INFO, fields: { Name: record.name, Channel: `<#${channel.id}>` } });
    return showBuilder(interaction, record, `📤 Posted in ${channel}: ${message.url}`);
  } catch (err) {
    console.error('[Embed] Post failed:', err);
    return showBuilder(interaction, record, `⚠️ Could not post: ${truncate(err.message, 200)}`);
  }
}

