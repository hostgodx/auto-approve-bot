#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Auto-Approve Bot (Pyrogram) — Premium HTML Edition
==================================================
Approves join requests for a private channel only after the user has
joined all configured force-subscribe channels/groups.

UI: "Premium card" design built with Telegram HTML parse_mode
    (blockquote • bold • box-drawing cards • dividers • branded footer)
Server: Built-in keep-alive HTTP server for Render + UptimeRobot
    (/ , /ping , /health) — stdlib only, no extra dependencies

Setup:
  1. pip install -r requirements.txt
  2. Create a .env file (copy .env.example) or export environment variables
  3. python auto_approve_bot.py
"""

import asyncio
import html
import json
import logging
import os
import sys
import threading
import time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from pyrogram import Client, enums, filters
from pyrogram.errors import UserNotParticipant
from pyrogram.types import (
    ChatJoinRequest,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
)

# ---------------- .env loader (dependency-free) ----------------

def load_dotenv(path: str = ".env") -> None:
    p = Path(path)
    if not p.exists():
        return
    for raw in p.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


load_dotenv()

# ---------------- Configuration (from environment) ----------------

API_ID = int(os.getenv("API_ID", "0") or 0)
API_HASH = os.getenv("API_HASH", "")
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
OWNER_ID = int(os.getenv("OWNER_ID", "0") or 0)
PRIVATE_CHANNEL_ID = int(os.getenv("PRIVATE_CHANNEL_ID", "0") or 0)

# Branding (UI) — set your own brand in .env
BRAND_NAME = os.getenv("BRAND_NAME", "AUTO APPROVE")
BRAND_LINK = os.getenv("BRAND_LINK", "")          # optional, e.g. https://t.me/yourchannel
DEV_TAG = os.getenv("DEV_TAG", "")                # optional, e.g. @yourchannel
REACTIONS = os.getenv("REACTIONS", "on").lower() in ("1", "on", "true", "yes")

ITEMS_PER_PAGE = 5
DATA_FILE = Path(os.getenv("DATA_FILE", "fsub_data.json"))
PORT = int(os.getenv("PORT", "3000") or 3000)     # Render sets PORT automatically
SELF_PING_URL = os.getenv("SELF_PING_URL", "")    # optional, e.g. https://your-app.onrender.com/ping
START_TS = time.time()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
log = logging.getLogger("autoapprove")

# ---------------- State ----------------

FORCE_SUB_CHANNELS: dict = {}    # {chat_id: title}         — persisted
PENDING_REQUESTS: dict = {}      # {user_id: set(chat_id)}  — persisted
ALL_BOT_CHATS: dict = {}         # {chat_id: {"title","type","members"}} — runtime cache
MENU_STATE: dict = {}            # {owner_id: {"page": int, "search": str|None}} — runtime
INVITE_CACHE: dict = {}          # {chat_id: invite_link}   — runtime cache

app = Client("AutoApproveBot", api_id=API_ID, api_hash=API_HASH, bot_token=BOT_TOKEN)

esc = html.escape

# ══════════════════════════════════════════════════════════════════════
#  PREMIUM HTML DESIGN SYSTEM  (Telekaf-style cards, original layout)
# ══════════════════════════════════════════════════════════════════════

W = 26
def _bar(ch: str) -> str: return ch * W

def card(title_html: str, body_html: str) -> str:
    """Titled box-drawing card with a blockquote body."""
    return (
        f"<b>╭{_bar('━')}╮</b>\n"
        f"   {title_html}\n"
        f"<b>╰{_bar('━')}╯</b>\n\n"
        f"<blockquote>{body_html}</blockquote>"
    )


def divider() -> str:
    return "⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯"


def footer() -> str:
    brand = f'<a href="{BRAND_LINK}">{esc(BRAND_NAME)}</a>' if BRAND_LINK else f"<b>{esc(BRAND_NAME)}</b>"
    dev = f"  •  ⚡ {esc(DEV_TAG)}" if DEV_TAG else ""
    return f"{divider()}\n✦ {brand}{dev} ✦"


def card_success(title: str, body: str) -> str:
    return card(f"✅  <b>{esc(title)}</b>", body) + f"\n\n{footer()}"


def card_error(title: str, body: str) -> str:
    return card(f"🚫  <b>{esc(title)}</b>", body) + f"\n\n{footer()}"


def card_warn(title: str, body: str) -> str:
    return card(f"⚠️  <b>{esc(title)}</b>", body) + f"\n\n{footer()}"


def card_info(title: str, body: str) -> str:
    return card(f"◆  <b>{esc(title)}</b>", body) + f"\n\n{footer()}"


def get_runtime() -> str:
    d = int(time.time() - START_TS)
    days, rem = divmod(d, 86400)
    hours, rem = divmod(rem, 3600)
    mins, _ = divmod(rem, 60)
    return f"{days}d {hours}h {mins}m"


# ---------------- Persistence ----------------

def save_state() -> None:
    try:
        tmp = DATA_FILE.with_suffix(DATA_FILE.suffix + ".tmp")
        tmp.write_text(
            json.dumps(
                {
                    "force_sub": {str(k): v for k, v in FORCE_SUB_CHANNELS.items()},
                    "pending": {str(u): sorted(c) for u, c in PENDING_REQUESTS.items()},
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        tmp.replace(DATA_FILE)
    except Exception as e:
        log.error("Failed to save state: %s", e)


def load_state() -> None:
    if not DATA_FILE.exists():
        return
    try:
        data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        FORCE_SUB_CHANNELS.update({int(k): v for k, v in data.get("force_sub", {}).items()})
        PENDING_REQUESTS.update(
            {int(u): set(int(c) for c in v) for u, v in data.get("pending", {}).items()}
        )
        log.info(
            "State loaded: %d force-sub channels, %d pending users",
            len(FORCE_SUB_CHANNELS), len(PENDING_REQUESTS),
        )
    except Exception as e:
        log.error("Failed to load state (%s) — starting with empty state", e)


# ---------------- Helpers ----------------

async def react(client, chat_id, message_id, emoji: str):
    """Best-effort message reaction — works only where reactions are enabled."""
    if not REACTIONS:
        return
    try:
        from pyrogram.raw import functions, types as raw_types
        peer = await client.resolve_peer(chat_id)
        await client.invoke(
            functions.messages.SendReaction(
                peer=peer,
                msg_id=message_id,
                reaction=[raw_types.ReactionEmoji(emoticon=emoji)],
                add_to_recent=True,
            )
        )
    except Exception as e:
        log.debug("reaction skipped (%s): %s", emoji, e)


async def fetch_all_chats() -> None:
    """Fetches all groups/channels from the bot's dialogs."""
    ALL_BOT_CHATS.clear()
    async for dialog in app.get_dialogs():
        chat = dialog.chat
        if chat.type in (enums.ChatType.GROUP, enums.ChatType.SUPERGROUP, enums.ChatType.CHANNEL):
            chat_type = (
                "👥 Group"
                if chat.type in (enums.ChatType.GROUP, enums.ChatType.SUPERGROUP)
                else "📢 Channel"
            )
            count = getattr(chat, "members_count", None)
            members = f"{count} members" if count else "private"
            ALL_BOT_CHATS[chat.id] = {
                "title": chat.title or str(chat.id),
                "type": chat_type,
                "members": members,
            }
    log.info("fetch_all_chats: %d chats found", len(ALL_BOT_CHATS))


def _filtered_chat_ids(search_query):
    ids = list(ALL_BOT_CHATS.keys())
    if search_query:
        q = search_query.lower()
        ids = [cid for cid in ids if q in ALL_BOT_CHATS[cid]["title"].lower()]
    return ids


def generate_chat_keyboard(page: int = 0, search_query: str = None):
    chats_to_show = _filtered_chat_ids(search_query)

    total_pages = max(1, (len(chats_to_show) + ITEMS_PER_PAGE - 1) // ITEMS_PER_PAGE)
    page = max(0, min(page, total_pages - 1))

    current = chats_to_show[page * ITEMS_PER_PAGE: page * ITEMS_PER_PAGE + ITEMS_PER_PAGE]

    keyboard = []
    for chat_id in current:
        info = ALL_BOT_CHATS[chat_id]
        check = "✅" if chat_id in FORCE_SUB_CHANNELS else "⬜"
        label = f"{check} {info['title']} | {info['type']} • {info['members']}"
        if len(label) > 60:
            label = label[:57] + "..."
        keyboard.append([InlineKeyboardButton(label, callback_data=f"fsub:toggle:{chat_id}")])

    nav = []
    if page > 0:
        nav.append(InlineKeyboardButton("⬅️ Back", callback_data=f"fsub:page:{page - 1}"))
    nav.append(InlineKeyboardButton(f"📄 {page + 1}/{total_pages}", callback_data="fsub:noop"))
    if page < total_pages - 1:
        nav.append(InlineKeyboardButton("Next ➡️", callback_data=f"fsub:page:{page + 1}"))
    if nav:
        keyboard.append(nav)

    keyboard.append([
        InlineKeyboardButton("💾 Save", callback_data="fsub:save"),
        InlineKeyboardButton("🗑️ Clear", callback_data="fsub:clear"),
    ])

    return InlineKeyboardMarkup(keyboard), len(chats_to_show), page


async def get_invite_link(chat_id: int):
    if chat_id in INVITE_CACHE:
        return INVITE_CACHE[chat_id]
    link = await app.export_chat_invite_link(chat_id)
    INVITE_CACHE[chat_id] = link
    return link


async def get_force_sub_list():
    lines = []
    buttons = []
    for idx, (chat_id, title) in enumerate(FORCE_SUB_CHANNELS.items(), start=1):
        safe_title = esc(title)
        lines.append(f"◆ {idx}. {safe_title}")
        try:
            link = await get_invite_link(chat_id)
            buttons.append([InlineKeyboardButton(f"🔗 {idx}. {title[:40]}", url=link)])
        except Exception as e:
            log.warning("Could not export invite link for %s (%s): %s", chat_id, title, e)
            buttons.append([InlineKeyboardButton(f"⚠️ {idx}. {title[:40]} (link error)", callback_data="fsub:noop")])

    buttons.append([InlineKeyboardButton("✅ VERIFY  ◆", callback_data="verify_join")])
    body = "\n".join(lines) if lines else "—"
    text = (
        card("📢  <b>VERIFICATION REQUIRED</b>",
             "◆ Join all the channels below\n"
             "◆ Then tap the <b>✅ VERIFY</b> button")
        + "\n\n"
        + f"<blockquote>{body}</blockquote>\n\n"
        + footer()
    )
    return text, InlineKeyboardMarkup(buttons)


async def check_user_joined(client, user_id: int) -> bool:
    if not FORCE_SUB_CHANNELS:
        return True
    for chat_id, title in FORCE_SUB_CHANNELS.items():
        try:
            member = await client.get_chat_member(chat_id, user_id)
            status = member.status
            if status in (enums.ChatMemberStatus.LEFT, enums.ChatMemberStatus.BANNED):
                return False
            if status == enums.ChatMemberStatus.RESTRICTED and not getattr(member, "is_member", True):
                return False
        except UserNotParticipant:
            return False
        except Exception as e:
            log.error("membership check failed [%s (%s)] user=%s: %s", title, chat_id, user_id, e)
            return False
    return True


def is_owner(user_id: int) -> bool:
    return user_id == OWNER_ID


# ---------------- Commands ----------------

@app.on_message(filters.command("start") & filters.private)
async def start_command(client, message):
    user_name = esc(message.from_user.first_name or "User")
    brand = esc(BRAND_NAME)
    text = (
        f"<b>『 {brand} 』</b>\n"
        f"{divider()}\n\n"
        f"👑 <b>Hello {user_name}!</b>\n\n"
        "🤖 I'm the <b>Auto Approval Bot</b> — I verify and approve "
        "join requests for the private channel.\n\n"
        + card("📌  <b>HOW IT WORKS</b>",
               "1️⃣ Send a join request to the private channel\n"
               "2️⃣ Join the channels/groups below\n"
               "3️⃣ Tap the <b>✅ VERIFY</b> button\n"
               "4️⃣ Your request gets approved 🎉")
        + "\n\n<blockquote>⚡ Fast  •  🔒 Secure  •  🟢 24/7 Online</blockquote>\n\n"
        + footer()
    )
    m = await message.reply_text(text, parse_mode=enums.ParseMode.HTML)
    mid = getattr(m, "id", None) or getattr(m, "message_id", 0)
    await react(client, message.chat.id, mid, "⚡")


@app.on_message(filters.command("set") & filters.user(OWNER_ID) & filters.private)
async def set_channels_command(client, message):
    msg = await message.reply_text(
        card_info("FETCHING CHATS…", "⏳ Fetching all groups and channels the bot is in…\nPlease wait a moment."),
        parse_mode=enums.ParseMode.HTML,
    )
    await fetch_all_chats()

    if not ALL_BOT_CHATS:
        return await msg.edit_text(
            card_error("NO CHATS FOUND", "No groups or channels found!\nMake the bot an admin in a group/channel first."),
            parse_mode=enums.ParseMode.HTML,
        )

    MENU_STATE[OWNER_ID] = {"page": 0, "search": None}
    keyboard, total, page = generate_chat_keyboard(page=0)
    await msg.edit_text(
        card("⚙️  <b>FORCE-SUB SETTINGS</b>",
             f"📦 Total chats: <code>{total}</code>   •   ✅ Selected: <code>{len(FORCE_SUB_CHANNELS)}</code>\n\n"
             "◆ Pick chats from the list below\n"
             "◆ ✅ = selected, ⬜ = not selected\n\n"
             "💡 List too long? Use <code>/search name</code>")
        + "\n\n" + footer(),
        reply_markup=keyboard,
        parse_mode=enums.ParseMode.HTML,
    )


@app.on_message(filters.command("search") & filters.user(OWNER_ID) & filters.private)
async def search_command(client, message):
    parts = message.text.split(" ", 1)
    if len(parts) < 2 or not parts[1].strip():
        return await message.reply_text(
            card_warn("USAGE", "Usage: <code>/search OTP</code>\nType the group/channel name."),
            parse_mode=enums.ParseMode.HTML,
        )

    search_query = parts[1].strip()
    if not ALL_BOT_CHATS:
        await fetch_all_chats()

    MENU_STATE[OWNER_ID] = {"page": 0, "search": search_query}
    keyboard, total, page = generate_chat_keyboard(page=0, search_query=search_query)

    if total == 0:
        return await message.reply_text(
            card_error("NOT FOUND", f"No group/channel found matching <b>'{esc(search_query)}'</b>."),
            parse_mode=enums.ParseMode.HTML,
        )

    await message.reply_text(
        card_info("SEARCH RESULTS",
                  f"🔍 <b>'{esc(search_query)}'</b>\n✅ {total} match(es) found"),
        reply_markup=keyboard,
        parse_mode=enums.ParseMode.HTML,
    )


@app.on_message(filters.command("fsubstatus") & filters.user(OWNER_ID) & filters.private)
async def fsub_status_command(client, message):
    pending_total = sum(len(v) for v in PENDING_REQUESTS.values())
    if FORCE_SUB_CHANNELS:
        lines = "\n".join(f"◆ {esc(t)} <code>({cid})</code>" for cid, t in FORCE_SUB_CHANNELS.items())
        text = card_info(
            f"FORCE-SUB LIST ({len(FORCE_SUB_CHANNELS)})", lines
        ) + f"\n\n⏳ Users pending verification: <code>{pending_total}</code>"
    else:
        text = card_info("STATUS", f"No force-sub channels configured yet.\n\n⏳ Pending users: <code>{pending_total}</code>")
    await message.reply_text(text, parse_mode=enums.ParseMode.HTML)


# ---------------- Callback: fsub menu ----------------

@app.on_callback_query(filters.regex(r"^fsub:"))
async def fsub_menu_callback(client, callback_query):
    if not is_owner(callback_query.from_user.id):
        return await callback_query.answer("❌ Owner only.", show_alert=True)

    parts = callback_query.data.split(":")
    action = parts[1] if len(parts) > 1 else "noop"
    state = MENU_STATE.get(OWNER_ID, {"page": 0, "search": None})

    if action == "noop":
        return await callback_query.answer()

    if action == "toggle":
        chat_id = int(parts[2])
        title = ALL_BOT_CHATS.get(chat_id, {}).get("title", str(chat_id))
        if chat_id in FORCE_SUB_CHANNELS:
            del FORCE_SUB_CHANNELS[chat_id]
        else:
            FORCE_SUB_CHANNELS[chat_id] = title
        save_state()
        keyboard, _, _ = generate_chat_keyboard(state["page"], state["search"])
        try:
            await callback_query.edit_message_reply_markup(reply_markup=keyboard)
        except Exception as e:
            log.debug("markup edit skipped: %s", e)
        return await callback_query.answer("✅ Updated!")

    if action == "page":
        page = int(parts[2])
        state["page"] = page
        MENU_STATE[OWNER_ID] = state
        keyboard, _, _ = generate_chat_keyboard(page, state["search"])
        try:
            await callback_query.edit_message_reply_markup(reply_markup=keyboard)
        except Exception as e:
            log.debug("page edit skipped: %s", e)
        return await callback_query.answer()

    if action == "save":
        save_state()
        return await callback_query.edit_message_text(
            card_success("SAVED", f"A total of <b>{len(FORCE_SUB_CHANNELS)}</b> channel(s)/group(s) are now force-subscribed.\nUsers must join them to get approved."),
            parse_mode=enums.ParseMode.HTML,
        )

    if action == "clear":
        FORCE_SUB_CHANNELS.clear()
        save_state()
        return await callback_query.edit_message_text(
            card_warn("CLEARED", "All force-subscribe channels have been removed."),
            parse_mode=enums.ParseMode.HTML,
        )

    await callback_query.answer()


# ---------------- Callback: verify ----------------

@app.on_callback_query(filters.regex(r"^verify_join$"))
async def verify_join_callback(client, callback_query):
    user = callback_query.from_user
    user_id = user.id

    is_joined = await check_user_joined(client, user_id)

    if not is_joined:
        return await callback_query.answer(
            "❌ You haven't joined all the channels yet. Join them all first.",
            show_alert=True,
        )

    pending = PENDING_REQUESTS.pop(user_id, set())
    approved, failed = [], []
    for cid in pending:
        try:
            await client.approve_chat_join_request(cid, user_id)
            approved.append(cid)
            log.info("Approved join request: chat=%s user=%s", cid, user_id)
        except Exception as e:
            failed.append(cid)
            log.error("Approve failed: chat=%s user=%s err=%s", cid, user_id, e)
    save_state()

    await callback_query.answer("✅ Verification passed!", show_alert=True)
    await react(client, callback_query.message.chat.id, callback_query.message.id, "🔥")

    if failed:
        await callback_query.edit_message_text(
            card_warn("PARTIAL APPROVAL",
                      f"Verification passed, but <b>{len(failed)}</b> request(s) could not be approved.\n"
                      "Check the bot's admin permissions (Add Members / Approve Join Requests) and try again."),
            parse_mode=enums.ParseMode.HTML,
        )
    elif approved:
        await callback_query.edit_message_text(
            card_success("APPROVED 🎉",
                         "All requirements are complete.\n"
                         "Your join request has been <b>approved</b> —\n"
                         "you can now access the private channel."),
            parse_mode=enums.ParseMode.HTML,
        )
    else:
        await callback_query.edit_message_text(
            card_success("VERIFIED",
                         "No pending join request found for your account.\n"
                         "If you haven't entered the channel yet, send a join request again."),
            parse_mode=enums.ParseMode.HTML,
        )


# ---------------- Join request handler ----------------

@app.on_chat_join_request()
async def handle_join_request(client, request: ChatJoinRequest):
    user = request.from_user
    user_id = user.id
    user_name = esc(user.first_name or "User")
    target_chat = getattr(request, "chat", None)
    target_id = target_chat.id if target_chat else None

    # Deadlock avoidance: a join request to a force-sub channel itself can
    # never be verified (user cannot become a member without approval).
    if target_id and target_id in FORCE_SUB_CHANNELS:
        try:
            await request.approve()
            log.info("Auto-approved force-sub channel request: chat=%s user=%s", target_id, user_id)
        except Exception as e:
            log.error("Force-sub approve failed chat=%s user=%s: %s", target_id, user_id, e)
        return

    is_joined = await check_user_joined(client, user_id)

    if is_joined:
        try:
            await request.approve()
            log.info("Approved: chat=%s user=%s", target_id, user_id)
            try:
                dm = await client.send_message(
                    user_id,
                    card_success("CONGRATULATIONS",
                                 f"Congratulations <b>{user_name}</b>!\n"
                                 "Your join request has been approved.\n"
                                 "You can now access the private channel. 🎉"),
                    parse_mode=enums.ParseMode.HTML,
                )
                mid = getattr(dm, "id", None) or getattr(dm, "message_id", 0)
                await react(client, user_id, mid, "🔥")
            except Exception as e:
                log.warning("Could not DM user %s: %s", user_id, e)
        except Exception as e:
            log.error("Approve failed chat=%s user=%s: %s", target_id, user_id, e)
        return

    # ❗ Do NOT decline — the request stays pending and is approved after verification
    if target_id:
        PENDING_REQUESTS.setdefault(user_id, set()).add(target_id)
        save_state()

    text, keyboard = await get_force_sub_list()
    try:
        dm = await client.send_message(
            user_id,
            f"<b>🔒 {user_name}, your request is pending</b>\n\n" + text,
            reply_markup=keyboard,
            parse_mode=enums.ParseMode.HTML,
        )
        mid = getattr(dm, "id", None) or getattr(dm, "message_id", 0)
        await react(client, user_id, mid, "💤")
    except Exception as e:
        log.warning("Could not DM user %s (user may not have started the bot): %s", user_id, e)


# ══════════════════════════════════════════════════════════════════════
#  KEEP-ALIVE SERVER  (Render + UptimeRobot) — stdlib, no dependencies
# ══════════════════════════════════════════════════════════════════════

_HTTP_STATS = {"requests": 0, "started": START_TS}

_KEEPALIVE_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__BRAND__ — ONLINE</title>
<style>
  :root { --glow: #7c5cff; --bg: #0b0b14; --txt: #f2f0ff; --dim: #8a87a8; --ok: #35e0a1; }
  * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
  body { min-height: 100vh; background: radial-gradient(1200px 600px at 50% -10%, #241a4d 0%, var(--bg) 60%); color: var(--txt);
         display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .orb { position: fixed; border-radius: 50%; filter: blur(90px); opacity: .45; z-index: 0; animation: drift 12s ease-in-out infinite alternate; }
  .orb.a { width: 340px; height: 340px; background: #5a2bff; top: -80px; left: -80px; }
  .orb.b { width: 300px; height: 300px; background: #b03bff; bottom: -70px; right: -70px; animation-delay: -6s; }
  @keyframes drift { from { transform: translate(0,0) scale(1); } to { transform: translate(60px,40px) scale(1.15); } }
  .card { position: relative; z-index: 1; background: rgba(20,20,31,.82); border: 1px solid rgba(124,92,255,.35);
          border-radius: 22px; padding: 42px 48px; text-align: center; max-width: 480px; width: 92%;
          box-shadow: 0 0 60px rgba(124,92,255,.35), inset 0 0 40px rgba(124,92,255,.08); backdrop-filter: blur(12px); }
  .badge { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; letter-spacing: 2px; color: var(--ok);
           border: 1px solid rgba(53,224,161,.4); background: rgba(53,224,161,.08); padding: 6px 16px; border-radius: 999px; margin-bottom: 22px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 12px var(--ok); animation: pulse 1.4s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
  h1 { font-size: 30px; font-weight: 800; letter-spacing: 1px;
       background: linear-gradient(135deg, #c9b8ff 0%, #7c5cff 45%, #b03bff 100%);
       -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 6px; }
  .sub { color: var(--dim); font-size: 13px; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 26px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
  .stat { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06); border-radius: 14px; padding: 14px 8px; }
  .stat .v { font-size: 18px; font-weight: 700; color: #d9d2ff; font-variant-numeric: tabular-nums; }
  .stat .k { font-size: 10px; color: var(--dim); letter-spacing: 1.5px; text-transform: uppercase; margin-top: 4px; }
  .bar { height: 4px; border-radius: 4px; background: rgba(255,255,255,.06); overflow: hidden; margin-bottom: 18px; }
  .bar > div { height: 100%; width: 40%; background: linear-gradient(90deg, #7c5cff, #b03bff); animation: slide 2.4s ease-in-out infinite; }
  @keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }
  .foot { color: var(--dim); font-size: 11px; letter-spacing: 2px; }
  .foot b { color: #a99ee8; }
</style>
</head>
<body>
  <div class="orb a"></div><div class="orb b"></div>
  <div class="card">
    <div class="badge"><span class="dot"></span>ONLINE</div>
    <h1>『 __BRAND__ 』</h1>
    <div class="sub">Auto Approval Engine</div>
    <div class="grid">
      <div class="stat"><div class="v" id="uptime">—</div><div class="k">Uptime</div></div>
      <div class="stat"><div class="v" id="hits">—</div><div class="k">Pings</div></div>
      <div class="stat"><div class="v" id="status">OK</div><div class="k">Status</div></div>
    </div>
    <div class="bar"><div></div></div>
    <div class="foot">✦ <b>__BRAND__</b> • SECURE • VERIFIED ✦</div>
  </div>
<script>
  async function tick() {
    try {
      const r = await fetch('/health'); const d = await r.json();
      document.getElementById('uptime').textContent = d.uptime;
      document.getElementById('hits').textContent = d.requests;
      document.getElementById('status').textContent = 'OK';
    } catch (e) { document.getElementById('status').textContent = 'DOWN'; }
  }
  tick(); setInterval(tick, 15000);
</script>
</body>
</html>""".replace("__BRAND__", esc(BRAND_NAME))


class _KeepAliveHandler(BaseHTTPRequestHandler):
    def _send(self, code, body, content_type="text/plain; charset=utf-8"):
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj), "application/json")

    def do_GET(self):
        _HTTP_STATS["requests"] += 1
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        if path == "/":
            self._send(200, _KEEPALIVE_HTML, "text/html; charset=utf-8")
        elif path == "/ping":
            self._json(200, {"status": "alive", "uptime": get_runtime(), "timestamp": int(time.time())})
        elif path == "/health":
            self._json(200, {
                "status": "ok", "uptime": get_runtime(),
                "requests": _HTTP_STATS["requests"],
                "force_sub_channels": len(FORCE_SUB_CHANNELS),
                "pending_requests": sum(len(v) for v in PENDING_REQUESTS.values()),
            })
        else:
            self._send(404, "not found")

    def log_message(self, *args):  # silence access logs
        pass


def start_keep_alive_server() -> None:
    try:
        server = ThreadingHTTPServer(("0.0.0.0", PORT), _KeepAliveHandler)
        t = threading.Thread(target=server.serve_forever, daemon=True, name="keepalive")
        t.start()
        log.info("📡 Keep-alive server listening on 0.0.0.0:%d  (/ping, /health)", PORT)
    except Exception as e:
        log.error("Keep-alive server failed to start: %s", e)


def start_self_ping() -> None:
    """If SELF_PING_URL is set, GET it every 14 minutes (in addition to UptimeRobot)."""
    if not SELF_PING_URL:
        return
    import urllib.request

    def _loop():
        while True:
            time.sleep(14 * 60)
            try:
                with urllib.request.urlopen(SELF_PING_URL, timeout=10) as r:
                    log.info("🏓 self-ping → %s", r.status)
            except Exception as e:
                log.warning("self-ping failed: %s", e)

    threading.Thread(target=_loop, daemon=True, name="selfping").start()
    log.info("🏓 Self-ping enabled: %s (every 14 min)", SELF_PING_URL)


# ---------------- Entry point ----------------

def validate_config() -> None:
    problems = []
    if API_ID == 0:
        problems.append("API_ID")
    if not API_HASH:
        problems.append("API_HASH")
    if not BOT_TOKEN:
        problems.append("BOT_TOKEN")
    if OWNER_ID == 0:
        problems.append("OWNER_ID")
    if problems:
        print("❌ Missing required environment variables: " + ", ".join(problems))
        print("Create a .env file (see .env.example) or export them, then run again.")
        sys.exit(1)


if __name__ == "__main__":
    validate_config()
    load_state()
    start_keep_alive_server()
    start_self_ping()
    log.info("🚀 Bot starting… (brand: %s)", BRAND_NAME)
    app.run()
