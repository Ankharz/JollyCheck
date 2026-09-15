import logger from '../utils/logger.js';

let botConfig = null;

const getMinecraftCheckConfig = () => {
  return botConfig?.minecraftCheck || {};
};

export function installMinecraftCheckConfig(config) {
  botConfig = config || {};
}

async function pluginRequest(path, body = {}) {
  const config = getMinecraftCheckConfig();

  const pluginUrl = String(config.pluginUrl || '').replace(/\/+$/, '');
  const secret = config.bridgeSecret;

  if (!pluginUrl) {
    throw new Error('MC_CHECK_PLUGIN_URL is not configured');
  }

  if (!secret) {
    throw new Error('MC_CHECK_BRIDGE_SECRET is not configured');
  }

  logger.info(`[MC-CHECK HTTP] POST ${pluginUrl}${path}`);


  const response = await fetch(`${pluginUrl}${path}`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${secret}`,
  },
  body: JSON.stringify(body),
});

const text = await response.text();

logger.info(
  `[MC-CHECK HTTP] response status=${response.status} body=${text.slice(0, 500)}`
);

let data = {};

try {
  data = text ? JSON.parse(text) : {};
} catch {
  data = { raw: text };
}

  if (!response.ok) {
    throw new Error(
      data?.error ||
      data?.message ||
      `oXCheak request failed with HTTP ${response.status}`
    );
  }

  return data;
}

export async function consumeLinkCode(code, discordId) {
  return pluginRequest('/link/consume', {
    code,
    discordId,
  });
}

export async function createCheckRoom(data, client) {
  const config = getMinecraftCheckConfig();

  const guildId = config.guildId;
  const categoryId = config.voiceCategoryId;
  const moderatorRoleId = config.moderatorRoleId;

  if (!guildId) {
    throw new Error('MC_CHECK_GUILD_ID is not configured');
  }

  if (!categoryId) {
    throw new Error('MC_CHECK_VOICE_CATEGORY_ID is not configured');
  }

  if (!moderatorRoleId) {
    throw new Error('MC_CHECK_MODERATOR_ROLE_ID is not configured');
  }

  if (!data?.discordId) {
    throw new Error('discordId is required');
  }

  const guild = await client.guilds.fetch(guildId);

  const category = await guild.channels.fetch(categoryId);

  if (!category) {
    throw new Error('Voice category was not found');
  }

  const playerName = data.player || data.playerName || 'Игрок';

  const channelName = String(
    config.channelName || 'проверка-%player%'
  ).replace(/%player%/g, playerName);

  const channel = await guild.channels.create({
    name: channelName,
    type: 2,
    parent: category.id,
    userLimit: 2,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: ['ViewChannel', 'Connect'],
      },
      {
        id: moderatorRoleId,
        allow: ['ViewChannel', 'Connect', 'Speak'],
      },
      {
        id: data.discordId,
        allow: ['ViewChannel', 'Connect', 'Speak'],
      },
    ],
  });

  let invite = null;

  try {
    invite = await channel.createInvite({
      maxAge: Number(config.inviteMaxAgeHours || 1) * 60 * 60,
      maxUses: Number(config.inviteMaxUses || 1),
      unique: true,
      reason: `oXCheak check for ${playerName}`,
    });
  } catch (error) {
    await channel.delete().catch(() => {});
    throw new Error(`Failed to create Discord invite: ${error.message}`);
  }

  try {
    const user = await client.users.fetch(data.discordId);

    await user.send(
      `🔎 **Проверка Minecraft**\n\n` +
      `Вас вызвали на проверку.\n\n` +
      `🎙️ Войдите в голосовой канал:\n${invite.url}`
    );
  } catch (error) {
    await channel.delete().catch(() => {});
    throw new Error(`Failed to DM player: ${error.message}`);
  }

  return {
    channelId: channel.id,
    inviteUrl: invite.url,
    player: playerName,
    discordId: data.discordId,
  };
}

export async function deleteCheckChannel(client, channelId) {
  if (!channelId) {
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);

  if (!channel) {
    return;
  }

  await channel.delete().catch(() => {});
}

export async function kickCheckMember(client, discordId, reason = 'Minecraft check') {
  const config = getMinecraftCheckConfig();

  if (!config.guildId || !discordId) {
    return;
  }

  const guild = await client.guilds.fetch(config.guildId);

  const member = await guild.members.fetch(discordId).catch(() => null);

  if (!member) {
    return;
  }

  await member.kick(reason);
}