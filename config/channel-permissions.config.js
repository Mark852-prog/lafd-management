/**
 * channel-permissions.config.js
 * -----------------------------------------------------------------------
 * Per-channel permission overrides for tier roles, applied by
 * /setup-permissions on top of the server-wide tier permissions.
 *
 * For each tier listed, the channel gets an overwrite that ALLOWS exactly
 * the listed permissions and DENIES every other permission the tiers use,
 * so the channel ends up with exactly this access. An empty list = no
 * access at all (can't even see the channel).
 *
 * Channel lookup: set the env var (e.g. CHANNEL_TRAINING) to a channel or
 * category ID. If it's blank, the bot looks for a CATEGORY whose name
 * contains `match` and uses it plus every channel inside it; if there's no
 * such category, it uses every channel whose name contains `match`.
 *
 * `everyone: 'hidden'` also hides the channel from @everyone, so only the
 * tiers given View Channels below can see it.
 * -----------------------------------------------------------------------
 */

const { PermissionFlagsBits: P } = require('discord.js');

const TRAINING_COMMAND = [
  P.ViewChannel, P.SendMessages, P.SendMessagesInThreads, P.EmbedLinks, P.AttachFiles,
  P.AddReactions, P.ReadMessageHistory, P.ManageMessages, P.ManageThreads,
  P.CreatePublicThreads, P.CreatePrivateThreads,
];
const TRAINING_SUPERVISORY = TRAINING_COMMAND.filter((p) => p !== P.ManageMessages && p !== P.ManageThreads);
const TRAINING_VIEW_ONLY = [P.ViewChannel, P.ReadMessageHistory, P.AddReactions];
const NO_ACCESS = [];

const CHANNEL_PERMISSIONS = [
  {
    label: 'Training',
    envKey: 'CHANNEL_TRAINING',
    match: 'training',
    everyone: 'hidden',
    tiers: {
      'FIRE — DEPARTMENT COMMAND': TRAINING_COMMAND,
      'FIRE — COMMAND STAFF': TRAINING_COMMAND,
      'FIRE — SUPERVISORY': TRAINING_SUPERVISORY,
      'FIRE — SENIOR PERSONNEL': TRAINING_VIEW_ONLY,
      'FIRE — FIRE PERSONNEL': TRAINING_VIEW_ONLY,
      'FIRE — LOW RANK': TRAINING_VIEW_ONLY,
      'EMS — EXECUTIVE COMMAND': TRAINING_COMMAND,
      'EMS — COMMAND STAFF': TRAINING_COMMAND,
      'EMS — SUPERVISORY': TRAINING_SUPERVISORY,
      'EMS — SENIOR PERSONNEL': TRAINING_VIEW_ONLY,
      'EMS — PARAMEDIC PERSONNEL': TRAINING_VIEW_ONLY,
      'EMS — EMT PERSONNEL': TRAINING_VIEW_ONLY,
      'EMS — LOW RANK': TRAINING_VIEW_ONLY,
      VERIFIED: NO_ACCESS,
    },
  },
].map((c) => ({ ...c, channelId: process.env[c.envKey] || null }));

module.exports = { CHANNEL_PERMISSIONS };
