# LAFD Management v2

A Discord management bot for the **Los Angeles Fire Department** ER:LC roleplay department, built on **discord.js v14**.

It runs the department end to end: hiring, promotions and the chain of command, discipline, leave, shifts and quotas, incident reports, sessions, trainings, certifications, commendations and blacklists. Every role and channel can be configured **from inside Discord** with `/config`.

---

## 1. Commands

Run `/help` in Discord to see only the commands *you* can use. Levels: **M** Member · **CO** Company Officer · **CS** Command Staff · **SS** Senior Staff · **DH** Department Head.

### General
| Command | Level | What it does |
|---|---|---|
| `/help` | M | Lists every command you have access to |
| `/status` | M | Bot health, latency, on-duty count, config completeness |

### Personnel
| Command | Level | What it does |
|---|---|---|
| `/profile [member]` | M | Full service record: ranks, callsign, status, weekly quota, certifications, commendations, rank history (+ discipline summary for SS) |
| `/roster [division] [on_duty_only]` | M | **Live** roster built from actual Discord roles, grouped by rank |
| `/rank hire` | SS | Brings someone into Fire or EMS at a starting rank (rank + division + member roles) |
| `/rank promote` / `demote` | SS | Leave `rank` empty to move exactly one step. Confirmation required |
| `/rank history` | M | Every hire/promotion/demotion for a member |
| `/callsign request` | M | Request a callsign → Approve/Deny buttons for officers (deny asks for a reason) |
| `/callsign assign` / `revoke` | CO | Direct callsign management |
| `/callsign lookup` / `list` | M | Who holds a callsign / every assigned callsign |
| `/leave request` | M | Leave of absence with optional future start date → approval buttons |
| `/leave place` | SS | Administrative leave (optionally indefinite) |
| `/leave end` / `status` / `list` | M / CO | End early, view status, list everyone on leave |
| `/cert grant` / `revoke` | CS | Certifications, with optional linked roles |
| `/cert view` / `holders` | M | A member's certifications / everyone holding one |
| `/commend` | CO | Public commendation (Lifesaving Award, Medal of Valor, …) |

### Operations
| Command | Level | What it does |
|---|---|---|
| `/shift start` / `end` | M | Clock in/out; gives/removes the On Duty role, shows weekly quota progress |
| `/shift status` / `active` | M | Your shift + recent shifts / who's on duty by division |
| `/shift force-end` | CO | End someone else's shift |
| `/incident report` | M | Opens a form → numbered report (`INC-00042`) for fires, medicals, DOAs, MCIs, rescues… |
| `/incident view` / `recent` / `stats` | M | Look up, browse, and chart incidents |
| `/incident void` | CS | Void a duplicate/incorrect report |
| `/session start` / `end` / `active` | CS | Department or division sessions with Join/End/Cancel buttons and attendance tracking |
| `/training host` | CO | Schedule a training with RSVP buttons and role ping |
| `/training log` | CO | Record pass/fail; a pass can award a certification automatically |
| `/training history` / `upcoming` | M | Training record / scheduled trainings |
| `/activity check` | M | Hours, shifts, incidents, sessions, trainings, commendations for any period |
| `/activity leaderboard` | M | Top members by hours on duty |
| `/activity quota` | CS | Who met the weekly quota — excuses members on leave/suspended or hired this week |

### Discipline
| Command | Level | What it does |
|---|---|---|
| `/discipline issue` | SS | Notice, Verbal Warning, Warning, Strike, **Suspension**, **Demotion**, **Termination** |
| `/discipline revoke` | SS | Void a record (lifts a running suspension) |
| `/discipline history` / `case` | SS | Full history / one case in detail |
| `/blacklist add` / `remove` / `check` / `list` | SS | Works for users **not** in the server (paste their ID) |

Severe actions are carried out automatically after confirmation:
- **Suspension** — `Suspended` role, shift ended, lifted automatically after `days`. Rejoining the server re-applies it.
- **Demotion** — drops one rank in the member's primary division.
- **Termination** / **Blacklist** — strips every department role, ends shift/leave, releases the callsign.
- Other types accept `days` to auto-expire the record.

### Management
| Command | Level | What it does |
|---|---|---|
| `/announce` | SS | Form-based announcement, any channel, style presets, optional role ping |
| `/config view` / `check` | DH | All settings / diagnostics (missing roles, role order, channel permissions) |
| `/config channel` / `role` / `rank` / `clear` | DH | Link features to your channels and roles — no restart needed |
| `/config autosetup` | DH | **Creates any missing channels and roles** and links them |

> Server **Administrators** and the server owner can always use `/config`, so a brand-new server can be set up before any rank is linked.

---

## 2. Chain of command

Permissions come from the rank roles a member holds (never Discord's Administrator permission, except for `/config`). On top of the level checks:

- You can only act on members **ranked below you** (level first, then position in the same ladder).
- You can only assign ranks **below your own authority** — a Deputy Chief can promote to Assistant Chief, but not to Deputy Chief.
- Nobody can promote, discipline, or approve requests for **themselves**.
- Promote must move up, demote must move down.

| Level | Ranks |
|---|---|
| 4 — Department Head | Fire Chief, Medical Director |
| 3 — Senior Staff | Assistant/Deputy Fire Chief, Assistant/Deputy Medical Director |
| 2 — Command Staff | Battalion Chief, High Rank, Division Medical Officer, EMS (Senior) High Rank |
| 1 — Company Officer | Lieutenant, Captain, Paramedic Lieutenant, Paramedic Captain, **Supervisory Team** role |
| 0 — Member | Everyone else |

Change who can do what in `config/permissions.config.js`.

---

## 3. Setup

### Requirements
- Node.js 18+
- A Discord application with a bot user

### Install
```
npm install
cp .env.example .env     # fill in DISCORD_TOKEN, CLIENT_ID, GUILD_ID
```

### Developer Portal
1. **Bot → Privileged Gateway Intents → enable “Server Members Intent”.** (Required for the live roster, quota checks and blacklist enforcement. The bot tells you if it's missing.)
2. **OAuth2 → URL Generator** — scopes `bot` + `applications.commands`; permissions **Manage Roles, Manage Channels, Send Messages, Embed Links, Read Message History** (+ Kick/Ban Members if you use `BLACKLIST_ACTION=kick|ban`).
3. Invite the bot, then in **Server Settings → Roles** drag the bot's role **above every rank/status role** it manages.

### Start
- **Windows:** double-click `start.bat`. **Mac/Linux:** run `./start.sh`. (Both install dependencies and auto-restart the bot if it crashes.)
- Or manually: `npm start`

Slash commands are registered automatically on every start (old v1 commands are replaced). `npm run deploy` still works if you prefer doing it by hand.

### Configure from Discord
1. `/config rank` — link each rank to its role (or fill `FIRE_ROLE_*` / `EMS_ROLE_*` in `.env`).
2. `/config autosetup scope:Channels and roles` — creates any missing channels/roles, **or** link existing ones with `/config channel` and `/config role`.
3. `/config check` — confirms role order and channel permissions are correct.

---

## 4. Automation

A background job runs every minute:
- Shifts longer than `SHIFT_MAX_HOURS` (default 12) are closed and the member is DM'd — no more forgotten shifts inflating hours.
- Scheduled leaves start, finished leaves end (roles applied/removed, member DM'd).
- Suspensions are lifted and time-limited infractions expire.

Event hooks:
- A **blacklisted** user joining triggers a discipline-log alert (or kick/ban per `BLACKLIST_ACTION`).
- A **suspended** member who rejoins gets the Suspended role back.
- A member who leaves mid-shift has their shift closed.

---

## 5. Project structure
```
commands/
  general/      help, status
  personnel/    profile, roster, rank, callsign, leave, cert, commend
  operations/   shift, incident, session, training, activity
  discipline/   discipline, blacklist
  management/   announce, config
services/       shared business logic (shifts, leave, discipline, sessions/trainings)
events/         ready, interactionCreate (router), guildMemberAdd, guildMemberRemove
utils/          permissions, embeds, members (safe role changes), logger, paginator, scheduler, …
config/         ranks & roles, channels, permissions, department policy, branding, settings layer
database/db.js  SQLite schema, in-place migrations, all queries
```

**Adding a command:** drop a file in `commands/<category>/` exporting `{ category, level, data, execute }` (optionally `levels` per subcommand, `autocomplete`, and `componentPrefix` + `handleComponent` for persistent buttons), then `npm run deploy`.

---

## 6. Upgrading from v1

- Your existing `database/lafd.sqlite` is upgraded automatically on first start — no data is lost.
- Your existing `.env` keeps working. `SPECIAL_ROLE_APPARATUS_OPERATOR` and `SPECIAL_ROLE_SUPERVISORY_TEAM` are still read.
- Old callsign request buttons still work.
- Run `npm run deploy` once — old commands are replaced:

| v1 | v2 |
|---|---|
| `/promote`, `/demote` | `/rank promote`, `/rank demote` |
| `/warn`, `/infract` | `/discipline issue` |
| `/infractions` | `/discipline history` |
| `/clear-infraction` | `/discipline revoke` |
| `/member` | `/profile` |
| `/on-duty` | `/shift active` |
| `/request callsign` | `/callsign request` |
| `/ping` | `/status` |

- **Rank order fix:** the Fire ladder is now Junior Engineer → Engineer → Senior Engineer (v1 had Junior Engineer above Senior Engineer).
