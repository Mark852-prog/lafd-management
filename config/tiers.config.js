/**
 * tiers.config.js
 * -----------------------------------------------------------------------
 * Discord PERMISSION TIER roles. Each tier is a separate Discord role that
 * carries the actual server permissions (rank roles stay cosmetic).
 *
 * /setup-permissions creates any tier role that doesn't exist yet (matched
 * by name, case-insensitive), sets its permissions to EXACTLY the list
 * below, and gives every member the tier role(s) matching their rank.
 * After that, events/guildMemberUpdate.js keeps tier roles in sync
 * whenever a member's rank roles change (promote/demote/manual edits).
 *
 * `ranks` lists rank keys from roles.config.js. Rename a tier here and
 * re-run /setup-permissions - note the old role will NOT be renamed, a
 * new one is created, so rename the role in Discord as well.
 * -----------------------------------------------------------------------
 */

const { PermissionFlagsBits: P } = require('discord.js');

// Shared permission sets (copied from department policy - keep exact).
const COMMAND_TOP = [
  P.ViewChannel, P.SendMessages, P.SendMessagesInThreads, P.EmbedLinks, P.AttachFiles,
  P.AddReactions, P.UseExternalEmojis, P.UseExternalStickers, P.ReadMessageHistory,
  P.ManageMessages, P.ManageThreads, P.CreatePublicThreads, P.CreatePrivateThreads,
  P.ManageNicknames, P.MentionEveryone,
];
const COMMAND_STAFF = COMMAND_TOP.filter((p) => p !== P.MentionEveryone);
const SUPERVISORY = COMMAND_STAFF.filter((p) => p !== P.ManageNicknames);
const SENIOR_PERSONNEL = SUPERVISORY.filter((p) => p !== P.ManageMessages && p !== P.ManageThreads);
const LOW_RANK = [P.ViewChannel, P.SendMessages, P.AddReactions, P.UseExternalEmojis, P.ReadMessageHistory];

const FIRE_TIERS = [
  {
    name: 'FIRE — DEPARTMENT COMMAND',
    permissions: COMMAND_TOP,
    ranks: ['FIRE_CHIEF', 'DEPUTY_FIRE_CHIEF', 'ASSISTANT_FIRE_CHIEF'],
  },
  { name: 'FIRE — COMMAND STAFF', permissions: COMMAND_STAFF, ranks: ['HIGH_RANK', 'BATTALION_CHIEF'] },
  { name: 'FIRE — SUPERVISORY', permissions: SUPERVISORY, ranks: ['CAPTAIN', 'LIEUTENANT'] },
  {
    name: 'FIRE — SENIOR PERSONNEL',
    permissions: SENIOR_PERSONNEL,
    ranks: ['JUNIOR_ENGINEER', 'SENIOR_ENGINEER', 'ENGINEER'],
  },
  {
    name: 'FIRE — FIRE PERSONNEL',
    permissions: [
      P.ViewChannel, P.SendMessages, P.SendMessagesInThreads, P.EmbedLinks, P.AttachFiles,
      P.AddReactions, P.UseExternalEmojis, P.ReadMessageHistory, P.CreatePublicThreads,
    ],
    ranks: ['FIREFIGHTER_III', 'FIREFIGHTER_II', 'FIREFIGHTER_I'],
  },
  { name: 'FIRE — LOW RANK', permissions: LOW_RANK, ranks: ['PROBATIONARY_FIREFIGHTER'] },
].map((t) => ({ ...t, department: 'FIRE' }));

const EMS_TIERS = [
  {
    name: 'EMS — EXECUTIVE COMMAND',
    permissions: COMMAND_TOP,
    ranks: ['MEDICAL_DIRECTOR', 'DEPUTY_MEDICAL_DIRECTOR', 'ASSISTANT_MEDICAL_DIRECTOR'],
  },
  {
    name: 'EMS — COMMAND STAFF',
    permissions: COMMAND_STAFF,
    ranks: ['EMS_SENIOR_HIGH_RANK', 'EMS_HIGH_RANK', 'DIVISION_MEDICAL_OFFICER'],
  },
  {
    name: 'EMS — SUPERVISORY',
    permissions: SUPERVISORY,
    ranks: [
      'PARAMEDIC_CAPTAIN', 'PARAMEDIC_LIEUTENANT', 'EMS_SUPERVISORY',
      'SENIOR_SUPERVISORY_MEDIC', 'SUPERVISORY_MEDIC', 'JUNIOR_SUPERVISORY_MEDIC',
    ],
  },
  { name: 'EMS — SENIOR PERSONNEL', permissions: SENIOR_PERSONNEL, ranks: ['PARAMEDIC_IN_CHARGE'] },
  {
    name: 'EMS — PARAMEDIC PERSONNEL',
    permissions: [
      P.ViewChannel, P.SendMessages, P.SendMessagesInThreads, P.EmbedLinks, P.AttachFiles,
      P.AddReactions, P.UseExternalEmojis, P.UseExternalStickers, P.ReadMessageHistory, P.CreatePublicThreads,
    ],
    ranks: ['PARAMEDIC', 'JUNIOR_PARAMEDIC'],
  },
  {
    name: 'EMS — EMT PERSONNEL',
    permissions: [
      P.ViewChannel, P.SendMessages, P.SendMessagesInThreads, P.AddReactions,
      P.UseExternalEmojis, P.ReadMessageHistory, P.CreatePublicThreads,
    ],
    ranks: ['EMT'],
  },
  { name: 'EMS — LOW RANK', permissions: LOW_RANK, ranks: ['PROBATIONARY_EMT'] },
].map((t) => ({ ...t, department: 'EMS' }));

// Rank-based tiers - assigned/removed automatically from a member's rank.
const RANK_TIERS = [...FIRE_TIERS, ...EMS_TIERS];

// Standalone roles - permissions are set by /setup-permissions, but the bot
// never assigns or removes them (e.g. VERIFIED is handed out by verification).
const STANDALONE_TIERS = [
  {
    name: 'VERIFIED',
    permissions: [P.ViewChannel, P.ReadMessageHistory, P.AddReactions, P.UseExternalEmojis],
  },
];

module.exports = { FIRE_TIERS, EMS_TIERS, RANK_TIERS, STANDALONE_TIERS };
