# AUTO APPROVAL BOT — Premium Verification Bot

Telegram bot that auto-approves join requests for a private channel — but only
after the requester joins every configured **force-subscribe** channel/group.
Built with **Node.js + Telegraf ([@icanseeuanywhere/telekaf](https://www.npmjs.com/package/@icanseeuanywhere/telekaf))**
using real **Rich Messages (Bot API 10.1/10.3)**.

## Features
- ✅ **Join-request auto approval** with live membership verification (`getChatMember`)
- 🛡️ **Force-sub gate** — any number of channels/groups (`/addchat`, `/delchat`, `/listchat`)
- ⏳ Requests stay pending (never declined) until the user taps **✅ VERIFY**
- 🃏 **Rich Message cards** — headings, task lists, striped tables, collapsible FAQ `<details>`,
  pull-quotes, spoilers, footers, dividers
- 🎉 **Animated message effects** on bot messages — randomized from a 20-effect pool, 🎉 celebration by default
- 🖼️ **Welcome images** — 3 separate images at top (`/welcome.jpg`, `/welcome2.jpg`, `/welcome3.jpg`), each as `<figure><img>` block
- 🎵 **Welcome Theme audio** (`/welcome.mp3`) — original Desi Dhol Beats instrumental
- 📋 **Menu inline button** → opens commands page (/menu)
- ➕ **Add Me to Channel inline button** → adds bot to your channel
- 👑 **Contact Owner inline button** → direct chat with owner (`tg://user?id=<OWNER_ID>`)
- `/menu` command — shows full commands list as rich card
- ❌ **No YouTube link** — removed per user request
- ▶️ **Official Listen button** in the welcome card (links the artist's official video — the bot never hosts copyrighted audio)
- 👑 **Super reactions** (🔥 ⚡ 👑 💎 …) on every user message and on the bot's own replies
- @️⃣ **Welcome card with @username mention**, VIP styling, and an inline **Welcome Theme** (`welcome.mp3`) — an original synthesized Haryanvi-style dhol/algoza instrumental (no copyrighted audio)
- 🔤 **Fancy Unicode fonts** (bold / sans-bold / monospace) for premium plain-text accents
- 🌐 **Keep-alive web page** (no stats, no uptime) + `/ping`, `/health`, `/welcome.mp3` endpoints

## Setup
```bash
npm install
cp .env.example .env   # fill in BOT_TOKEN + OWNER_ID
npm start
```

## Commands
| Command | Who | Description |
|---|---|---|
| `/start` | everyone | Premium welcome card + Welcome Theme music |
| `/help` | everyone | Command list |
| `/addchat @username\|id` | owner | Register a force-sub channel/group |
| `/delchat id` | owner | Remove a force-sub channel |
| `/listchat` | owner | List force-sub channels + pending count (`/fsubstatus`, `/listfsub`) |

## Environment variables
See [`.env.example`](.env.example) — branding (`BRAND_NAME`, `BRAND_LINK`, `DEV_TAG`),
toggles (`REACTIONS`, `EFFECTS`, `WELCOME_AUDIO`), `DEFAULT_CELEBRATION_EFFECT_ID`
(defaults to 🎉 `5046509860389126442`), `PUBLIC_URL` (used as the rich `<audio>` source).

## Deploy on Render (+ UptimeRobot)
1. Push to GitHub (never commit `.env`; use Render dashboard env vars).
2. Render → Web Service → Build: `npm install` → Start: `npm start`.
3. UptimeRobot → HTTP monitor → `https://<your-app>.onrender.com/ping` every 5 min.
4. Endpoints: `/` (styled page) · `/ping` (monitor) · `/health` (JSON stats) · `/welcome.mp3` (theme audio).

## Notes
- **Message effects render in private chats only** (Telegram limitation). If an effect ID is
  rejected, the bot transparently retries without it — messages are never lost.
- Force-sub channels in join-request mode are auto-approved to avoid verification deadlocks.
- `fsub_data.json` persists the force-sub list and pending requests; Render's free tier has an
  ephemeral disk — use a persistent disk or external DB for permanent storage.
