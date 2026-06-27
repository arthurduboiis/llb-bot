const db = require('../database');
const {
  onVoiceJoin,
  onVoiceLeave,
} = require('../handlers/payoutHandlers');

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    const userId = newState.id;
    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;

    if (oldChannelId === newChannelId) return; // mute/deaf etc, on ignore

    // Le membre a quitté un channel
    if (oldChannelId) {
      const session = await db.getSessionByVoiceChannel(oldChannelId);
      if (session)
        await onVoiceLeave(session.id, userId, oldChannelId);
    }

    // Le membre a rejoint un channel
    if (newChannelId) {
      const session = await db.getSessionByVoiceChannel(newChannelId);
      if (session)
        await onVoiceJoin(session.id, userId, newChannelId);
    }
  },
};
