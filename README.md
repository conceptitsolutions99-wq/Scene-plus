# Partner & Agent Offers Portal — prototype

Built from the brief in `Website_idea.docx`: an internal tool for a Canadian
loyalty program ("Scene+"-style) where **partners** publish their own offers
and terms & conditions, **customer service agents** browse those offers
read‑only (and log missing‑points corrections for members), and
**admins / super admins** manage accounts and can see who did what.

> **This is a working functional prototype**, not a production system. It has
> no external dependencies (pure Node.js), stores data in a local JSON file,
> and uses simple token auth — see **Before going live** at the bottom for
> what a production build needs.

## What's included

- **Sign-in only, no self-registration** — accounts are created by an admin
  or super admin, exactly as described in the brief.
- **Partner dashboard** — a partner user can add / edit / delete offers for
  *their own* partner only (e.g. `partner.empire` can only touch Empire's
  offers).
- **Agent dashboard** — view-only across all partners and offers, with full
  terms & conditions visible for every offer (this is the piece meant to
  stop agents from having to ask members to send in T&Cs). Agents also get a
  **"Missing Points"** form to log a points-correction request for a member —
  this was the stated core reason for the site. Everything else in the
  agent view stays view-only, matching the brief.
- **Admin dashboard** — same offer-management access as a partner, but
  across *every* partner, plus a **Footprints (Audit Log)** of account
  actions, plus the ability to create/disable agent and partner accounts.
- **Super admin dashboard** — everything admin has, plus the ability to
  create/disable admin and super admin accounts and manage the partner list
  itself.
- **Partners modelled from the brief**: Empire (Sobeys, FreshCo, Foodland,
  Safeway, Co-op, Chalo FreshCo, Thrifty Foods, IGA, Rachelle Béry, Les
  Marchés Tradition, Voilà), Cineplex, Scotiabank, Shell Canada, Scene+
  Travel powered by Expedia, Home Hardware, Recipe Unlimited (Harvey's,
  Swiss Chalet, East Side Mario's, Montana's, Bier Markt, Kelseys),
  Pharmacies (Lawtons Drugs, Sobeys/FreshCo/Safeway/Thrifty Foods
  pharmacies), and Rakuten.
- **Offer categories per partner**, matching the brief: Targeted Members,
  Personalized Offers, Scene+ Offers, Partner Offers.

### About the logos

Partner and banner logos are shown from `public/img/` (referenced in
`lib/db.js`). Any partner or banner without a logo falls back to coloured
initials automatically. Make sure you have the rights to use each partner's
trademarked artwork before this goes anywhere beyond internal use.

## Demo accounts

Seeded automatically the first time the server runs (also printed in the
terminal on first boot):

| Username | Password | Role |
|---|---|---|
| `superadmin` | `SuperAdmin123!` | Super admin — full access |
| `admin1` | `Admin123!` | Admin — all partners' offers + accounts + audit log |
| `partner.empire` | `Partner123!` | Partner — Empire's offers only |
| `partner.cineplex` | `Partner123!` | Partner — Cineplex's offers only |
| `agent1` | `Agent123!` | Agent — view only + missing points requests |

**Change or remove these before any real use.**

---

## Running it in AntiGravity (Google's agentic IDE)

AntiGravity is a VS Code–style editor with an AI agent built in, so there
are two ways to get this running: let the agent do it, or do it yourself in
the terminal. Both are below.

### Option A — open the folder and run it yourself

1. **Install Node.js 18 or newer** if you don't have it — download from
   https://nodejs.org (the LTS version). This app has **zero npm
   dependencies**, so Node is the only thing you need installed.
2. **Open AntiGravity** and choose **File → Open Folder…**, then select the
   `scene-plus-portal` folder (the one this README is in).
3. Open AntiGravity's integrated terminal: **View → Terminal** (or
   `` Ctrl+` `` / `` Cmd+` ``).
4. In the terminal, run:
   ```bash
   node server.js
   ```
   You should see:
   ```
   Scene+ Partner & Agent Offers Portal running at http://localhost:3000
   ```
   (the first run also prints the demo accounts table above).
5. Open a browser to **http://localhost:3000** — AntiGravity will usually
   also pop up a "Open in Browser" / port-forward notification you can click.
6. Sign in with one of the demo accounts to try each dashboard.
7. To stop the server, click back into the terminal and press `Ctrl+C`.

Because there's no build step and no dependencies to install, this is the
whole setup — no `npm install`, no bundler, no `.env` to configure to get
it running locally.

### Option B — let the AntiGravity agent drive it

Open AntiGravity's agent chat panel and give it a prompt like:

> Open the `scene-plus-portal` folder, run `node server.js` in a terminal,
> and open the app in the browser preview so I can see it.

AntiGravity's agent can create/run terminal commands and open a browser
preview pane itself, so it will start the server and surface the running
app without you typing the commands by hand. You can then ask the agent to
make changes — e.g. *"add a new partner called Costco"* or *"change the
gold accent colour to blue"* — and it can edit the files directly since
everything is plain Node/HTML/CSS/JS with no build pipeline to fight.

### Changing the port

The server listens on port 3000 by default. To use a different port:

```bash
PORT=4000 node server.js
```

### Resetting the demo data

All data lives in `data/db.json`, created automatically on first run. To
reset everything back to the seeded demo data, stop the server and delete
that file:

```bash
rm data/db.json
```

---

## Project structure

```
scene-plus-portal/
├─ server.js              # HTTP server + all API routes (no framework)
├─ lib/
│  ├─ db.js               # JSON "database" + seed data + password hashing
│  └─ sessions.js         # in-memory bearer-token sessions
├─ data/
│  └─ db.json             # created on first run — partners, offers, users, audit log
├─ public/                # everything served to the browser
│  ├─ index.html           # sign-in page
│  ├─ app.html             # app shell (sidebar + main content)
│  ├─ css/style.css
│  └─ js/app.js            # all dashboard rendering + API calls
└─ package.json
```

## API summary

All routes except `/api/login` require `Authorization: Bearer <token>`
(the token comes back from `/api/login`).

| Method & path | Who | What |
|---|---|---|
| `POST /api/login` | anyone | sign in |
| `POST /api/logout` | signed in | invalidate the token |
| `GET /api/me` | signed in | current user |
| `GET /api/partners` | signed in | list partners |
| `POST/PUT/DELETE /api/partners` | super admin | manage the partner list |
| `GET /api/offers?partnerId=&category=` | signed in | list offers |
| `POST/PUT/DELETE /api/offers` | partner (own partner), admin, super admin | manage offers |
| `GET /api/points-requests` | signed in | agents see their own; admin/super admin see all |
| `POST /api/points-requests` | agent, admin, super admin | log a missing-points request |
| `PUT /api/points-requests/:id` | admin, super admin | approve/reject a request |
| `GET/POST/PUT/DELETE /api/users` | admin, super admin | manage accounts (admins can't touch admin/super-admin accounts) |
| `GET /api/audit` | admin, super admin | the footprints/audit log |

## Before going live

This version is a functional prototype. It has **not** been security
hardened. Before using it with real members or real partner data, you'd
want to:

- Move from the JSON file to a real database (Postgres, etc.) — the
  `lib/db.js` functions are the only place that would need to change.
- Replace the in-memory session map with a persisted session store so
  logins survive a server restart.
- Add HTTPS/TLS (put it behind a reverse proxy like nginx, or a platform
  that terminates TLS for you).
- Add rate limiting on `/api/login`, and password-strength / expiry rules.
- Change or remove the demo accounts above.
- Configure real email delivery (`SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` /
  `SMTP_PASS` / `SMTP_FROM`) so OTP codes arrive by email instead of
  printing to the console.
- Add real member lookup (currently "Member ID" on a points request is a
  free-text field — you'll want it to validate against your actual member
  database).
