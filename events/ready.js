const { Events, ActivityType } = require('discord.js');
const { GUILD_ID, DEPARTMENT_SHORT } = require('../config');
const { startScheduler } = require('../utils/scheduler');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`[LAFD Management] Logged in as ${client.user.tag}`);

    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
      console.warn(`[LAFD Management] The bot is not in guild ${GUILD_ID}. Check GUILD_ID and invite the bot to your server.`);
    } else {
      console.log(`[LAFD Management] Serving ${guild.name} (${guild.id})`);
      await guild.roles.fetch().catch(() => {});
    }

    client.user.setPresence({ activities: [{ name: `over ${DEPARTMENT_SHORT} | /help`, type: ActivityType.Watching }], status: 'online' });
    startScheduler(client);
  },
};
