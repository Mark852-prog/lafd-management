# LAFD Management

A Discord management bot built specifically for a **Los Santos Fire Department (LAFD)** ER:LC roleplay department, using **discord.js v14**.

The bot manages promotions, demotions, disciplinary records, callsigns, shifts, rosters, and announcements — all using your server's **existing** rank roles and channels. It never creates channels or rank roles. The only roles it creates are the permission tier roles made by `/setup-permissions` (see section 9.1).

---

## 1. What this bot does

| Feature | Command(s) |
|---|---|
| Request a callsign | `/request callsign` |
| Approve/deny callsigns | Buttons on the request (posted to your callsign request channel) |
| Issue a formal warning | `/warn` |
| Issue any infraction type | `/infract` |
| View disciplinary history | `/infractions` |
| Remove a disciplinary record | `/clear-infraction` |
| Promote a member | `/promote` |
| Demote a member | `/demote` |
| Post an announcement | `/announce` |
| Create permission tier roles and sync them to members | `/setup-permissions` |
| View the roster | `/roster` |
| View a member's profile | `/member` |
| Start/end a shift | `/shift start`, `/shift end` |
| View who's on duty | `/on-duty` |
| Health check | `/ping` |

Every action that matters (promotions, demotions, infractions, callsigns, shifts) is written to a local SQLite database and posted to your existing logging channels.

---

## 2. Project structure

```
lafd-management/
├── commands/
│   ├── callsign/         → /request callsign
│   ├── discipline/       → /warn, /infract, /infractions, /clear-infraction
│   ├── management/       → /promote, /demote, /announce, /setup-permissions
│   ├── roster/           → /roster, /member
│   ├── shifts/           → /shift, /on-duty
│   └── general/          → /ping
├── events/
│   ├── ready.js            Logs in and confirms the bot is online
│   ├── interactionCreate.js Routes slash commands, autocomplete, and callsign buttons
│   └── guildMemberUpdate.js Keeps permission tier roles in sync with rank roles
├── utils/
│   ├── permissions.js     Centralized rank → permission level logic
│   ├── tiers.js           Permission tier role creation + member syncing
│   ├── embeds.js          Every embed builder (promotion, infraction, callsign, etc.)
│   ├── logger.js          Sends log embeds to your configured logging channels
│   ├── confirmation.js    Reusable Confirm/Cancel button flow
│   └── replies.js         Consistent "no permission" / error replies
├── database/
│   └── db.js               SQLite schema + all queries (creates lafd.sqlite automatically)
├── config/
│   ├── roles.config.js     Fire & EMS rank ladders, mapped to your role IDs
│   ├── channels.config.js  Callsign/announcement/logging channel IDs
│   ├── permissions.config.js  Permission levels required per command
│   ├── tiers.config.js     Discord permission tier roles + which ranks get them
│   ├── branding.config.js  Colors, icons, footer text, logo URL
│   └── index.js            Barrel file + startup validation
├── deploy-commands.js     Registers slash commands with Discord
├── index.js               Bot entry point
├── package.json
├── .env.example
└── .gitignore
```

---

## 3. Requirements

- [Node.js](https://nodejs.org/) version 18 or newer
- A Discord bot application (created at https://discord.com/developers/applications)
- Your existing LAFD Discord server, with its roles and channels already created

---

## 4. Installation

Open a terminal in the `lafd-management` folder and run:

```
npm install
```

This installs `discord.js`, `better-sqlite3`, and `dotenv`.

---

## 5. Configure the bot

1. Copy `.env.example` to a new file named `.env`.
2. Fill in every value described below.

### 5.1 Core bot settings

| Variable | Where to find it |
|---|---|
| `DISCORD_TOKEN` | Discord Developer Portal → your application → **Bot** → Reset Token |
| `CLIENT_ID` | Discord Developer Portal → your application → **General Information** → Application ID |
| `GUILD_ID` | Right-click your LAFD server icon in Discord (with Developer Mode on) → Copy Server ID |

> **Never share your bot token or commit your `.env` file.** `.gitignore` already excludes it.

To enable Developer Mode in Discord: **User Settings → Advanced → Developer Mode**. Once enabled, you can right-click any server, channel, or role and select "Copy ID".

### 5.2 Fire & EMS rank role IDs

For every rank listed in `.env.example` (e.g. `FIRE_ROLE_FIREFIGHTER_I`), right-click the matching **existing** role in your server's Role list (Server Settings → Roles) and paste its ID.

Ranks you leave blank simply won't be usable for promotions/demotions until configured — the bot will still run.

### 5.3 Special roles

`SPECIAL_ROLE_APPARATUS_OPERATOR` and `SPECIAL_ROLE_SUPERVISORY_TEAM` are **not** part of the rank ladder and are never touched by promotion/demotion. They're included for future features.

### 5.4 Channels

| Variable | Purpose |
|---|---|
| `CHANNEL_CALLSIGN_REQUESTS` | Where `/request callsign` posts its approval embed |
| `CHANNEL_ANNOUNCEMENTS` | Where `/announce` posts |
| `LOG_CHANNEL_DEFAULT` | Fallback log channel used if a specific one below isn't set |
| `LOG_CHANNEL_MANAGEMENT` | Promotions, demotions, announcements |
| `LOG_CHANNEL_DISCIPLINE` | Warnings, infractions, infraction removals |
| `LOG_CHANNEL_CALLSIGNS` | Callsign approvals/denials |
| `LOG_CHANNEL_SHIFTS` | Shift starts/ends |

### 5.5 Branding

`LAFD_LOGO_URL` — a direct image URL (must end in `.png`/`.jpg`/etc., e.g. hosted on Discord or Imgur) used as the thumbnail across every embed. Optional but recommended.

The bot's **avatar** itself is set separately in the Discord Developer Portal (Bot → App Icon) — upload the same LAFD logo there.

---

## 6. Invite the bot to your server

In the Developer Portal, go to **OAuth2 → URL Generator**:
- Scopes: `bot`, `applications.commands`
- Bot Permissions: `Manage Roles`, `View Channels`, `Send Messages`, `Send Messages in Threads`, `Embed Links`, `Attach Files`, `Add Reactions`, `Use External Emojis`, `Use External Stickers`, `Read Message History`, `Manage Messages`, `Manage Threads`, `Create Public Threads`, `Create Private Threads`, `Manage Nicknames`, `Mention @everyone, @here, and All Roles`, `Use Slash Commands`

  (Discord only lets a bot grant permissions it has itself, so `/setup-permissions` needs every permission used by the tier roles.)

Then in **Bot → Privileged Gateway Intents**, turn on **Server Members Intent**. The bot will fail to log in without it.

Open the generated URL and invite the bot to your **existing** LAFD server.

**Important:** In Server Settings → Roles, drag the bot's role **above** every Fire/EMS rank role it needs to assign. Discord bots can only manage roles positioned below their own highest role.

---

## 7. Register slash commands

Every time you add a command or change its options, run:

```
npm run deploy
```

(This calls `deploy-commands.js`, which registers commands to your `GUILD_ID` so they show up instantly.)

---

## 8. Start the bot

```
npm start
```

You should see:
```
[LAFD Management] Loaded 14 command(s).
[LAFD Management] Logged in as YourBot#0000
```

---

## 9. Permission system

Permissions are based entirely on the **existing rank role** a member holds — never Discord's Administrator permission. This is centralized in `config/permissions.config.js` and `utils/permissions.js`, so you can change who can do what in one place.

| Level | Ranks | Can do |
|---|---|---|
| 4 — Department Head | Fire Chief, Medical Director | Everything |
| 3 — Senior Staff | Deputy/Assistant Fire Chief, Assistant Medical Director | Promote, demote, infract, announce, callsigns, roster |
| 2 — Command Staff | High Rank, EMS High Rank, EMS Senior High Rank, Battalion Chief, Division Medical Officer | Callsigns, roster, department management |
| 1 — Company Officer | Lieutenant, Captain, Paramedic Lieutenant, Paramedic Captain | Callsigns, roster, shifts |
| 0 — Member | Everyone else | View roster, own profile, own shifts |

Levels are **cumulative** — a level 3 staffer can do everything a level 1 staffer can.

### 9.1 Discord permission tiers (`/setup-permissions`)

Bot command access (above) is separate from the **Discord server permissions** members get. Those come from permission tier roles defined in `config/tiers.config.js`. A Department Head runs `/setup-permissions` once, and it:

1. Creates any tier role that doesn't exist yet (matched by name, case-insensitive) and sets each tier role's permissions to **exactly** the department policy.
2. Gives every member the tier role for their rank and removes tier roles that don't match.

After that, tier roles update automatically whenever someone's rank role changes (`/promote`, `/demote`, or a manual role edit). It's safe to re-run `/setup-permissions` any time, e.g. after editing `tiers.config.js`.

| Tier role | Ranks |
|---|---|
| FIRE — DEPARTMENT COMMAND | Fire Chief, Deputy Fire Chief, Assistant Fire Chief |
| FIRE — COMMAND STAFF | High Rank, Battalion Chief |
| FIRE — SUPERVISORY | Captain, Lieutenant |
| FIRE — SENIOR PERSONNEL | Junior Engineer, Senior Engineer, Engineer |
| FIRE — FIRE PERSONNEL | Firefighter III, Firefighter II, Firefighter I |
| FIRE — LOW RANK | Probationary Firefighter |
| EMS — EXECUTIVE COMMAND | Medical Director, Deputy Medical Director, Assistant Medical Director |
| EMS — COMMAND STAFF | EMS Senior High Rank, EMS High Rank, Division Medical Officer |
| EMS — SUPERVISORY | Paramedic Captain, Paramedic Lieutenant, EMS Supervisory, Senior/Supervisory/Junior Supervisory Medic |
| EMS — SENIOR PERSONNEL | Paramedic in Charge |
| EMS — PARAMEDIC PERSONNEL | Paramedic, Junior Paramedic |
| EMS — EMT PERSONNEL | EMT |
| EMS — LOW RANK | Probationary EMT |
| VERIFIED | Permissions set only; never assigned or removed by the bot |

Notes:
- New tier roles are created at the bottom of the role list, so your rank roles' colors still show. The bot's role must be **above** the tier roles.
- `@everyone`, rank roles, and channel permission overwrites are never changed. If `@everyone` already grants a permission, members keep it regardless of tier.
- Tier roles are managed by the bot: a tier role given by hand to someone without the matching rank is removed the next time their rank changes or `/setup-permissions` runs.

---

## 10. Database

Uses **SQLite** via `better-sqlite3` — a single file (`database/lafd.sqlite`) that's created automatically the first time the bot runs. No external database server needed. It's excluded from git via `.gitignore`.

Tables: `members`, `shifts`, `discipline`, `history`, `callsign_requests`. See the top of `database/db.js` for the full schema.

---

## 11. Tickets

Your server's existing ticket system was **not** replaced or duplicated — I don't have access to its specific bot/API to integrate directly. The codebase is structured so ticket integration can be added later (e.g. a new `commands/tickets/` folder and a `utils/tickets.js` helper) once you tell the next developer which ticket bot/system you're using.

---

## 12. What you still need to provide

- [ ] `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`
- [ ] All `FIRE_ROLE_*` and `EMS_ROLE_*` role IDs you want active
- [ ] `SPECIAL_ROLE_APPARATUS_OPERATOR`, `SPECIAL_ROLE_SUPERVISORY_TEAM` (optional, for future use)
- [ ] `CHANNEL_CALLSIGN_REQUESTS`, `CHANNEL_ANNOUNCEMENTS`
- [ ] `LOG_CHANNEL_*` channel IDs
- [ ] `LAFD_LOGO_URL` (optional but recommended)
- [ ] Invite the bot and move its role above the rank roles
- [ ] Run `npm install` → `npm run deploy` → `npm start`

---

## 13. Continuing development

This project is intentionally modular so another developer (or AI) can extend it easily:

- **New command?** Add a file to the right subfolder in `commands/`, export `{ data, execute }`, run `npm run deploy`.
- **New permission rule?** Edit `config/permissions.config.js` only.
- **New embed style?** Add a builder function to `utils/embeds.js`.
- **New rank/role?** Add it to `config/roles.config.js` and `.env.example`.
- **Ticket system integration:** see section 11 above.

No IDs are hardcoded anywhere in command logic — everything server-specific lives in `config/` and `.env`.
