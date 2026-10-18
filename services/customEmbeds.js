/**
 * services/customEmbeds.js
 * -----------------------------------------------------------------------
 * Storage format, validation, image handling, rendering and posted-copy
 * sync for the /embed builder.
 *
 * Saved embed data (JSON, one per embed - stored in database/db.js):
 * {
 *   color: '#hex',
 *   topImage: null | '<preset key>' | 'upload:<file>' | 'url:<https...>',  // own small embed ABOVE the main one
 *   bottomImage: same,                                                     // big image inside the main embed
 *   title, description, footer,
 *   fields:  [{ name, value, inline }],                                    // max 25
 *   buttons: [{ label, emoji, style, action: 'reply'|'link', url, reply }], // max 10
 *   menu:    { placeholder, options: [{ label, description, emoji, reply }] } | null   // max 25 options
 * }
 * reply = { title, text, image, footer, links: [{ label, url }] } - shown privately to whoever clicked.
 *
 * Interactive parts use stateless custom IDs that are looked up in the
 * database on every click, so they keep working after restarts:
 *   ce:<embedId>:b:<buttonIndex>    button with a hidden reply
 *   ce:<embedId>:m                  select menu (value = option index)
 * -----------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, AttachmentBuilder } = require('discord.js');
const { LOGO_URL } = require('../config');
const db = require('../database/db');
const { isValidUrl, truncate } = require('../utils/format');

const IMAGE_DIR = process.env.EMBED_IMAGE_DIR || path.join(__dirname, '..', 'database', 'embed-images');
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const UPLOAD_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const UPLOADS_KEPT_PER_EMBED = 10;

const LIMITS = { BUTTONS: 10, OPTIONS: 25, FIELDS: 25, TOTAL_CHARS: 5800 };
const BUTTON_STYLES = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger };

// ---------------------------------------------------------------------
// Image presets: the department logo + any set in .env as
//   EMBED_IMAGE_PRESETS=Banner|https://...png;Divider|https://...png
// ---------------------------------------------------------------------
function getImagePresets() {
  const presets = {};
  if (LOGO_URL && isValidUrl(LOGO_URL)) presets.logo = { name: 'Department logo', url: LOGO_URL };
  for (const entry of (process.env.EMBED_IMAGE_PRESETS || '').split(';')) {
    const [name, url] = entry.split('|').map((s) => s && s.trim());
    if (!name || !url || !isValidUrl(url)) continue;
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
    if (key && key !== 'none' && key !== 'url') presets[key] = { name, url };
  }
  return presets;
}

// ---------------------------------------------------------------------
// Defaults & validation
// ---------------------------------------------------------------------
function defaultData() {
  return { color: '#9E1B1B', topImage: null, bottomImage: null, title: null, description: null, footer: null, fields: [], buttons: [], menu: null };
}

/** Fills any missing keys so older/partial records always render. */
function normalize(data) {
  const d = { ...defaultData(), ...(data || {}) };
  d.fields = Array.isArray(d.fields) ? d.fields : [];
  d.buttons = Array.isArray(d.buttons) ? d.buttons : [];
  if (d.menu && !Array.isArray(d.menu.options)) d.menu.options = [];
  return d;
}

/** '#abc' / 'abc' / '#AABBCC' -> '#AABBCC', or null if invalid. */
function parseHex(input) {
  const raw = String(input || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(raw)) return `#${raw.split('').map((c) => c + c).join('').toUpperCase()}`;
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toUpperCase()}`;
  return null;
}

/** A single unicode emoji or a custom emoji like <:name:123>. Returns the emoji or null. */
function parseEmoji(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (/^<a?:\w{2,32}:\d{17,21}>$/.test(raw)) return raw;
  if (raw.length <= 16 && !/[\sA-Za-z0-9]/.test(raw) && /[\p{Extended_Pictographic}\p{Regional_Indicator}⃣]/u.test(raw)) return raw;
  return null;
}

/** Accepts https://..., a channel mention <#id>, or a raw channel ID. Returns a URL or null. */
function parseLinkTarget(input, guildId) {
  const raw = String(input || '').trim();
  const channel = /^<#(\d{17,21})>$/.exec(raw) || /^(\d{17,21})$/.exec(raw);
  if (channel) return `https://discord.com/channels/${guildId}/${channel[1]}`;
  return isValidUrl(raw) && raw.length <= 512 ? raw : null;
}

/** "Label | target" per line -> [{ label, url }] plus a list of rejected lines. */
function parseLinkLines(text, guildId) {
  const links = [];
  const rejected = [];
  for (const line of String(text || '').split('\n').map((l) => l.trim()).filter(Boolean)) {
    const [label, target] = line.split('|').map((s) => s && s.trim());
    const url = parseLinkTarget(target, guildId);
    if (label && url && links.length < 5) links.push({ label: label.slice(0, 80), url });
    else rejected.push(line);
  }
  return { links, rejected };
}

function textLength(d) {
  return [d.title, d.description, d.footer, ...d.fields.flatMap((f) => [f.name, f.value])].reduce((n, s) => n + (s ? String(s).length : 0), 0);
}

function hasMainContent(d) {
  return Boolean(d.title || d.description || d.footer || d.fields.length || d.bottomImage);
}

// ---------------------------------------------------------------------
// Uploaded images (saved on the bot's disk - Discord CDN links expire)
// ---------------------------------------------------------------------
function uploadedFiles(embedId) {
  if (!fs.existsSync(IMAGE_DIR)) return [];
  return fs
    .readdirSync(IMAGE_DIR)
    .filter((f) => f.startsWith(`ce${embedId}-`))
    .sort()
    .reverse();
}

/** Downloads a Discord attachment to disk. Returns { ref } or { error }. */
async function saveUpload(embedId, where, attachment) {
  const ext = UPLOAD_TYPES[(attachment.contentType || '').split(';')[0]];
  if (!ext) return { error: 'Only PNG, JPG, GIF or WEBP images can be uploaded.' };
  if (attachment.size > MAX_UPLOAD_BYTES) return { error: 'That image is larger than 8 MB.' };

  const res = await fetch(attachment.url);
  if (!res.ok) return { error: `Could not download the image (HTTP ${res.status}).` };
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_UPLOAD_BYTES) return { error: 'That image is larger than 8 MB.' };

  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const file = `ce${embedId}-${where}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(IMAGE_DIR, file), buffer);
  return { ref: `upload:${file}` };
}

/** Keeps the newest uploads per embed, never deleting one still in use. */
function pruneUploads(embedId, data) {
  const inUse = new Set([data.topImage, data.bottomImage, ...data.buttons.map((b) => b.reply?.image), ...(data.menu?.options || []).map((o) => o.reply?.image)].filter(Boolean));
  for (const file of uploadedFiles(embedId).slice(UPLOADS_KEPT_PER_EMBED)) {
    if (!inUse.has(`upload:${file}`)) fs.rmSync(path.join(IMAGE_DIR, file), { force: true });
  }
}

function deleteUploads(embedId) {
  for (const file of uploadedFiles(embedId)) fs.rmSync(path.join(IMAGE_DIR, file), { force: true });
}

function imageLabel(ref) {
  if (!ref) return 'None';
  if (ref.startsWith('upload:')) return `Uploaded image (${ref.slice(7)})`;
  if (ref.startsWith('url:')) return 'Image URL';
  return getImagePresets()[ref]?.name || `Missing preset "${ref}"`;
}

/** Resolves an image ref to something an embed can use, collecting files to attach. */
function resolveImage(ref, files) {
  if (!ref) return null;
  if (ref.startsWith('url:')) return ref.slice(4);
  if (ref.startsWith('upload:')) {
    const file = path.basename(ref.slice(7));
    const full = path.join(IMAGE_DIR, file);
    if (!fs.existsSync(full)) return null;
    if (!files.some((f) => f.name === file)) files.push(new AttachmentBuilder(full, { name: file }));
    return `attachment://${file}`;
  }
  return getImagePresets()[ref]?.url || null;
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------
function colorInt(hex) {
  return Number.parseInt((parseHex(hex) || '#9E1B1B').slice(1), 16);
}

/**
 * Builds the message payload for an embed.
 * preview=true shows placeholders for empty parts and unfinished buttons.
 */
function renderEmbed(record, { preview = false } = {}) {
  const d = normalize(record.data);
  const files = [];
  const embeds = [];

  const top = resolveImage(d.topImage, files);
  if (top) embeds.push(new EmbedBuilder().setColor(colorInt(d.color)).setImage(top));

  const main = new EmbedBuilder().setColor(colorInt(d.color));
  if (d.title) main.setTitle(truncate(d.title, 256));
  if (d.description) main.setDescription(truncate(d.description, 4096));
  if (d.footer) main.setFooter({ text: truncate(d.footer, 2048) });
  for (const f of d.fields.slice(0, LIMITS.FIELDS)) main.addFields({ name: truncate(f.name, 256), value: truncate(f.value, 1024), inline: Boolean(f.inline) });
  const bottom = resolveImage(d.bottomImage, files);
  if (bottom) main.setImage(bottom);
  if (!main.data.title && !main.data.description && !main.data.fields?.length && !main.data.footer && !main.data.image) {
    main.setDescription(preview ? '*This embed is empty — use **✏️ Title, text, footer & colour** to add content.*' : '​');
  }
  embeds.push(main);

  const components = [];
  const buttons = d.buttons
    .slice(0, LIMITS.BUTTONS)
    .map((b, i) => {
      const button = new ButtonBuilder().setLabel(truncate(b.label || 'Button', 80));
      const emoji = parseEmoji(b.emoji);
      if (emoji) button.setEmoji(emoji);
      if (b.action === 'link') {
        if (!b.url) return preview ? button.setCustomId(`ceb:${record.id}:pending:${i}`).setStyle(ButtonStyle.Secondary).setDisabled(true) : null;
        return button.setStyle(ButtonStyle.Link).setURL(b.url);
      }
      return button.setCustomId(`ce:${record.id}:b:${i}`).setStyle(BUTTON_STYLES[b.style] || ButtonStyle.Primary);
    })
    .filter(Boolean);
  for (let i = 0; i < buttons.length; i += 5) components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));

  const options = (d.menu?.options || []).slice(0, LIMITS.OPTIONS);
  if (options.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`ce:${record.id}:m`)
      .setPlaceholder(truncate(d.menu.placeholder || 'Select an option…', 150))
      .addOptions(
        options.map((o, i) => {
          const opt = { label: truncate(o.label || `Option ${i + 1}`, 100), value: String(i) };
          if (o.description) opt.description = truncate(o.description, 100);
          const emoji = parseEmoji(o.emoji);
          if (emoji) opt.emoji = emoji;
          return opt;
        })
      );
    components.push(new ActionRowBuilder().addComponents(menu));
  }

  return { embeds, components, files };
}

/** The private message shown to someone who clicked a reply button / picked a menu option. */
function renderReply(record, reply) {
  const d = normalize(record.data);
  const files = [];
  const r = reply || {};
  const embed = new EmbedBuilder().setColor(colorInt(d.color)).setDescription(truncate(r.text || '​', 4096));
  if (r.title) embed.setTitle(truncate(r.title, 256));
  if (r.footer) embed.setFooter({ text: truncate(r.footer, 2048) });
  const image = resolveImage(r.image, files);
  if (image) embed.setImage(image);
  const links = (r.links || []).filter((l) => l.label && isValidUrl(l.url)).slice(0, 5);
  const components = links.length
    ? [new ActionRowBuilder().addComponents(links.map((l) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(truncate(l.label, 80)).setURL(l.url)))]
    : [];
  return { embeds: [embed], components, files };
}

// ---------------------------------------------------------------------
// Posting & keeping posted copies in sync
// ---------------------------------------------------------------------
const GONE_CODES = new Set([10003, 10008, 50001]); // unknown channel, unknown message, missing access

async function postEmbed(record, channel) {
  const message = await channel.send({ ...renderEmbed(record), allowedMentions: { parse: [] } });
  db.addCustomEmbedPost(record.id, channel.id, message.id);
  return message;
}

/** Updates every posted copy of an embed. Deleted messages are forgotten quietly. */
async function syncPosts(client, embedId) {
  const record = db.getCustomEmbed(embedId);
  if (!record) return;
  for (const post of db.getCustomEmbedPosts(embedId)) {
    try {
      const channel = await client.channels.fetch(post.channel_id);
      const message = await channel.messages.fetch(post.message_id);
      await message.edit({ ...renderEmbed(record), attachments: [] });
    } catch (err) {
      if (GONE_CODES.has(err.code)) db.removeCustomEmbedPost(embedId, post.message_id);
      else console.warn(`[CustomEmbeds] Could not update posted copy ${post.message_id} of embed #${embedId}: ${err.message}`);
    }
  }
}

/** Fire-and-forget sync so interactions never wait on it. */
function scheduleSync(client, embedId) {
  syncPosts(client, embedId).catch((err) => console.error('[CustomEmbeds] Sync failed:', err));
}

module.exports = {
  LIMITS,
  BUTTON_STYLES,
  MAX_UPLOAD_BYTES,
  getImagePresets,
  defaultData,
  normalize,
  parseHex,
  parseEmoji,
  parseLinkTarget,
  parseLinkLines,
  textLength,
  hasMainContent,
  uploadedFiles,
  saveUpload,
  pruneUploads,
  deleteUploads,
  imageLabel,
  renderEmbed,
  renderReply,
  postEmbed,
  syncPosts,
  scheduleSync,
};
