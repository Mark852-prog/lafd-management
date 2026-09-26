const { Events } = require('discord.js');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`[LAFD Management] Logged in as ${client.user.tag}`);
    console.log(`[LAFD Management] Serving guild ID: ${process.env.GUILD_ID}`);
  },
};
