const payout = require('../handlers/payoutHandlers');
const bank = require('../handlers/bankHandlers');

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    try {
      // ---------------- SLASH COMMANDS ----------------
      if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (!command) return;
        return command.execute(interaction);
      }

      const id = interaction.customId;

      // ---------------- BOUTONS ----------------
      if (interaction.isButton()) {
        if (id === 'payout_launch') return payout.handleLaunchButton(interaction);
        if (id.startsWith('payout_signup_')) return payout.handleSignupButton(interaction, idSuffix(id, 'payout_signup_'));
        if (id.startsWith('payout_unsignup_')) return payout.handleUnsignupButton(interaction, idSuffix(id, 'payout_unsignup_'));
        if (id.startsWith('payout_close_')) return payout.handleCloseButton(interaction, idSuffix(id, 'payout_close_'));
        if (id.startsWith('payout_enterloot_')) return payout.handleEnterLootButton(interaction, idSuffix(id, 'payout_enterloot_'));

        if (id === 'bank_mybalance') return bank.handleMyBalance(interaction);
        if (id === 'bank_withdraw_perso') return bank.handleWithdrawPersoButton(interaction);
        if (id === 'bank_deposit') return bank.handleDepositButton(interaction);
        if (id === 'bank_withdraw_guild') return bank.handleGuildWithdrawButton(interaction);
        if (id === 'bank_refresh') return bank.handleRefreshButton(interaction);
        if (id.startsWith('bank_paid_')) return bank.handleMarkPaid(interaction, idSuffix(id, 'bank_paid_'));
        if (id.startsWith('bank_cancel_')) return bank.handleCancelWithdrawal(interaction, idSuffix(id, 'bank_cancel_'));
      }

      // ---------------- SELECT MENUS ----------------
      if (interaction.isStringSelectMenu()) {
        if (id === 'payout_select_type') return payout.handleTypeSelect(interaction);
        if (id.startsWith('payout_splitmode_')) return payout.handleSplitModeSelect(interaction, idSuffix(id, 'payout_splitmode_'));
      }

      // ---------------- MODALS ----------------
      if (interaction.isModalSubmit()) {
        if (id.startsWith('payout_lootmodal_')) return payout.handleLootModalSubmit(interaction, idSuffix(id, 'payout_lootmodal_'));
        if (id.startsWith('payout_customsplit_')) return payout.handleCustomSplitModalSubmit(interaction, idSuffix(id, 'payout_customsplit_'));

        if (id === 'bank_withdraw_perso_modal') return bank.handleWithdrawPersoModalSubmit(interaction);
        if (id === 'bank_deposit_modal') return bank.handleDepositModalSubmit(interaction);
        if (id === 'bank_guild_withdraw_modal') return bank.handleGuildWithdrawModalSubmit(interaction);
      }
    } catch (err) {
      console.error('Erreur interactionCreate:', err);
      const payload = { content: '❌ Une erreur est survenue, regarde les logs du bot.', ephemeral: true };
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch {}
    }
  }
};

function idSuffix(customId, prefix) {
  return customId.slice(prefix.length);
}
