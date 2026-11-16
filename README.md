# Auto-Approve Bot — Setup Guide (Premium HTML Edition)

## 1. Install
```bash
pip install -r requirements.txt
cp .env.example .env   # then fill in your values
python auto_approve_bot.py
```

## 2. Premium HTML Look
- All bot messages use **Telegram HTML parse_mode** — `<b>`, `<u>`, `<blockquote>`, `<a href>`, `<code>`, etc.
- **Design system**: `card()` / `card_success()` / `card_error()` / `card_warn()` / `card_info()` helpers —
  box-drawing borders, divider lines and a branded footer (`✦ BRAND ✦`).
- **Branding**: set `BRAND_NAME`, `BRAND_LINK` (footer link) and `DEV_TAG` in `.env`.
- **Reactions**: `REACTIONS=on` (default) — ⚡ on /start, 🔥 on verified (best-effort; chat must allow reactions).
- Telegram Premium custom-emoji IDs are intentionally not used — they only work for Premium bot accounts.

## 3. Deploy on Render (+ UptimeRobot)
1. Push this code to a GitHub repository (**never commit `.env`** — put secrets in the Render dashboard).
2. Render → **New Web Service** → select the repo.
   - Build command: `pip install -r requirements.txt`
   - Start command: `python auto_approve_bot.py`
   - Add environment variables from `.env.example` in the Render dashboard (`API_ID`, `API_HASH`, `BOT_TOKEN`, `OWNER_ID`, …).
3. Render sets `PORT` automatically — the code binds to `0.0.0.0:$PORT`.
4. UptimeRobot → **New Monitor** → Type: HTTP(s) → URL: `https://<your-app>.onrender.com/ping` → Interval: 5 minutes.
   - This stops the free-tier service from spinning down.
5. Endpoints:
   - `/` — styled HTML status page (open in a browser)
   - `/ping` — JSON `{status, uptime, timestamp}` (use for UptimeRobot)
   - `/health` — JSON with uptime, request counter and pending-request count

**Self-ping (optional)**: set `SELF_PING_URL=https://<your-app>.onrender.com/ping` to ping yourself every 14 minutes.

## 4. Required Permissions
- **Target private channel**: the bot must be admin with join-request approval permission.
- **Every force-sub channel/group**: the bot must be a member (admin recommended).
- Users must **/start the bot first**, otherwise the bot cannot DM them.

## 5. Commands
| Command | Who | Description |
|---|---|---|
| `/start` | everyone | Premium welcome card |
| `/set` | owner | Force-subscribe channel picker |
| `/search <name>` | owner | Filter channels/groups by name |
| `/fsubstatus` | owner | List force-sub channels + pending count |

## 6. Data
Force-sub list and pending requests persist in `fsub_data.json`.

## 7. Notes
- Prefer normal/public invite links for force-sub channels; join-request-mode force-sub channels are handled automatically to avoid deadlocks.
- `approve_chat_join_request` requires Pyrogram ≥ 2.0.106.
- Render free tier has an ephemeral filesystem — `fsub_data.json` may reset on redeploy. For permanent storage, use a Render persistent disk or an external database.
