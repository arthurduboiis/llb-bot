# Les Loups Blancs Payout Bot

Bot Discord (Node.js) pour gérer les payouts et la banque de guilde sur Albion Online.
Stockage 100% local en SQLite (fichier `src/data/sovereign.db`) — **aucun hébergement payant requis**, le code et la base tournent ensemble sur n'importe quelle machine (PC perso, Raspberry Pi, VPS gratuit...).

## ✨ Fonctionnalités

- **Payout** : bouton "Lancer un Payout" → choix du type (Raid Avalon / Donjon / ZvZ / Gank / Transport / Faction) → création automatique d'un channel texte + vocal → inscriptions → suivi du temps passé en vocal → clôture des inscriptions → saisie du loot → calcul automatique (taxe guilde 10% + taxe marché 6.5%) → split au choix (égal / pro-rata du temps / pourcentages custom) → crédit des soldes + DM aux joueurs → suppression auto des channels après 60s.
- **Banque** : dashboard avec trésorerie guilde, soldes joueurs, historique, boutons Mon solde / Retrait perso / Déposer / Retrait guilde (officiers) / Dashboard (refresh).
- **Retraits** : un joueur demande un retrait → la demande apparaît dans le salon banque → un officier clique "Marquer comme payé" une fois qu'il l'a payé in-game.

## 🚀 Installation

1. **Prérequis** : [Node.js](https://nodejs.org/) version 22.5 ou plus récente (toi tu as la 24, c'est parfait). La base de données utilise le module SQLite natif de Node — **aucune compilation, aucun outil supplémentaire (Python, Visual Studio Build Tools, etc.) n'est nécessaire.**

2. Installe les dépendances :

   ```
   npm install
   ```

3. Copie `.env.example` en `.env` et remplis les valeurs :

   ```
   cp .env.example .env
   ```

   - `DISCORD_TOKEN` : Developer Portal > ton appli > Bot > Reset Token
   - `CLIENT_ID` : Developer Portal > ton appli > General Information > Application ID
   - `GUILD_ID` : clic droit sur ton serveur Discord > Copier l'ID (active le mode développeur dans Discord > Paramètres > Avancés)
   - `OFFICER_ROLE_ID` : clic droit sur le rôle "Officier" > Copier l'ID
   - `BANK_CHANNEL_ID` : clic droit sur le salon #banque > Copier l'ID
   - `PAYOUT_CATEGORY_ID` : laisse vide, le bot crée automatiquement une catégorie "📦 Payouts en cours"

4. **Invite le bot sur ton serveur** depuis le Developer Portal > OAuth2 > URL Generator :
   - Scopes : `bot`, `applications.commands`
   - Permissions : `Manage Channels`, `Send Messages`, `Embed Links`, `Manage Messages`, `Move Members` (optionnel), `View Channels`, `Connect`

5. **Active les intents privilégiés** : Developer Portal > ton appli > Bot > active "Server Members Intent" (nécessaire pour reconnaître les pseudos dans le split custom).

6. Déploie les commandes slash sur ton serveur :

   ```
   npm run deploy
   ```

7. Lance le bot :
   ```
   npm start
   ```

## 🕹️ Utilisation

1. Dans le salon où tu veux le système de payout, tape `/setup-payout` (admin uniquement). Le message avec le bouton "Lancer un Payout" est posté.
2. Dans ton salon #banque, tape `/setup-bank`. Le dashboard est posté avec les boutons.
3. Pour donner les droits "officier" (clôturer un payout autre que le sien, valider les retraits, gérer la trésorerie), assigne le rôle correspondant à `OFFICER_ROLE_ID` aux bons membres.

## ⚠️ Limites de cette première version (à garder en tête)

- Le **suivi du temps en vocal** est gardé en mémoire pendant que le bot tourne : si tu redémarres le bot pendant qu'un payout est en cours, le temps déjà passé en vocal pour cette session sera perdu (il faudra relancer le payout). Pas de souci pour les payouts terminés (le résultat est en base).
- Le **split custom** identifie les joueurs par pseudo (username ou surnom du serveur) — vérifie l'orthographe exacte si tu utilises cette option.
- Si un joueur a les **DM fermés**, il ne recevra pas le message de notification mais son solde sera bien crédité.

## 📁 Structure du projet

```
discord-bot/
├── index.js                  # point d'entrée
├── deploy-commands.js        # script pour enregistrer les slash commands
├── .env                       # tes secrets (à créer, non commité)
├── src/
│   ├── config.js              # taxes, types de payout, IDs
│   ├── database.js            # toutes les requêtes SQLite
│   ├── commands/               # /setup-payout, /setup-bank
│   ├── events/                  # ready, interactionCreate, voiceStateUpdate
│   ├── handlers/                 # logique métier payout / banque
│   ├── utils/                     # embeds, formatage, permissions
│   └── data/                       # sovereign.db (créée automatiquement)
```

## 🔧 Personnaliser

- Taux de taxes, types de payout, délai avant suppression des channels → `src/config.js`
- Style des embeds (couleurs, textes) → `src/utils/embeds.js`
