#!/usr/bin/env node
/**
 * ══════════════════════════════════════════════════════════════
 *  AUTO APPROVAL BOT — Telekaf Rich Messages Edition
 *  Telegraf (from @icanseeuanywhere/telekaf) + RichMessage cards
 *
 *  • Approves join requests for the private channel only after the
 *    user joins all configured force-subscribe channels/groups
 *  • Real RichMessage cards (headings, tables, task lists, footer)
 *  • Super reactions on user messages and on the bot's own replies
 *  • Built-in keep-alive HTTP server for Render + UptimeRobot
 *    (/ , /ping , /health)
 *
 *  Setup:
 *    1. npm install
 *    2. cp .env.example .env   (or export environment variables)
 *    3. npm start
 * ══════════════════════════════════════════════════════════════
 */

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { Telegraf, RichMessage } = require('@icanseeuanywhere/telekaf');

const RH = RichMessage.RichHTMLBuilder;

// ───────────────── .env loader (no dependency) ─────────────────
(function loadEnv(file = '.env') {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
})();

// ───────────────── Config ─────────────────
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const OWNER_ID = Number(process.env.OWNER_ID || 0);
const BRAND_NAME = process.env.BRAND_NAME || 'AUTO APPROVAL BOT';
const BRAND_LINK = process.env.BRAND_LINK || '';
const DEV_TAG = process.env.DEV_TAG || '';
const REACTIONS = ['1', 'true', 'yes', 'on'].includes(String(process.env.REACTIONS || 'on').toLowerCase());
const PORT = Number(process.env.PORT || 3000);
const SELF_PING_URL = process.env.SELF_PING_URL || '';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'fsub_data.json');

if (!BOT_TOKEN) { console.error('❌ Missing BOT_TOKEN'); process.exit(1); }
if (!OWNER_ID) { console.error('❌ Missing OWNER_ID'); process.exit(1); }

const START_TS = Date.now();
const DIVIDER = '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯';

// ✦ Super reaction pool — fired on user messages and the bot's own replies
const REACTION_POOL = ['🔥', '⚡', '👑', '💎', '✨', '🚀', '💥', '⭐', '❤️‍🔥', '🫡'];
const pickReaction = () => REACTION_POOL[Math.floor(Math.random() * REACTION_POOL.length)];

const htmlEsc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function log(type, ...msg) {
  console.log(`[${new Date().toISOString()}] [${String(type).toUpperCase()}]`, ...msg);
}

function getRuntime() {
  const d = Math.floor((Date.now() - START_TS) / 1000);
  const days = Math.floor(d / 86400);
  const hours = Math.floor((d % 86400) / 3600);
  const mins = Math.floor((d % 3600) / 60);
  return `${days}d ${hours}h ${mins}m`;
}

// ───────────────── Persistence ─────────────────
// DB.forceSub: { "<chatId>": { title, username|null } }
// DB.pending:  { "<userId>": ["<chatId>", ...] }
function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { forceSub: {}, pending: {} };
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return { forceSub: raw.forceSub || {}, pending: raw.pending || {} };
  } catch (e) {
    log('error', 'Failed to load data file:', e.message);
    return { forceSub: {}, pending: {} };
  }
}

const DB = loadData();

function saveData() {
  try {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(DB, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    log('error', 'Failed to save data:', e.message);
  }
}

// ───────────────── Rich card helpers ─────────────────
function footerHtml() {
  const brand = BRAND_LINK
    ? `<a href="${BRAND_LINK}">${htmlEsc(BRAND_NAME)}</a>`
    : `<b>${htmlEsc(BRAND_NAME)}</b>`;
  return `✦ ${brand}${DEV_TAG ? '  •  ⚡ ' + htmlEsc(DEV_TAG) : ''} ✦`;
}

function cardShell(title, bodyHtml) {
  return (
    `<b>╭${'━'.repeat(26)}╮</b>\n   ${title}\n<b>╰${'━'.repeat(26)}╯</b>\n\n` +
    `<blockquote>${bodyHtml}</blockquote>`
  );
}

const fallbackSuccess = (title, body) =>
  cardShell(`✅  <b>${htmlEsc(title)}</b>`, body) + `\n\n${footerHtml()}`;
const fallbackError = (title, body) =>
  cardShell(`🚫  <b>${htmlEsc(title)}</b>`, body) + `\n\n${footerHtml()}`;
const fallbackWarn = (title, body) =>
  cardShell(`⚠️  <b>${htmlEsc(title)}</b>`, body) + `\n\n${footerHtml()}`;
const fallbackInfo = (title, body) =>
  cardShell(`◆  <b>${htmlEsc(title)}</b>`, body) + `\n\n${footerHtml()}`;

async function sendRichCard(ctx, chatId, built, fallbackHtml, extra = {}) {
  try {
    if (ctx.telegram.sendRichMessage) return await ctx.telegram.sendRichMessage(chatId, built, extra);
    throw new Error('sendRichMessage unavailable');
  } catch (e) {
    try {
      return await ctx.telegram.sendMessage(chatId, fallbackHtml, { parse_mode: 'HTML', ...extra });
    } catch (e2) {
      try {
        return await ctx.telegram.sendMessage(chatId, fallbackHtml.replace(/<[^>]+>/g, ''), extra);
      } catch (e3) {
        log('error', 'Could not send message:', e3.message);
        return null;
      }
    }
  }
}

async function react(ctx, chatId, messageId, emoji) {
  if (!REACTIONS) return;
  try {
    await ctx.telegram.callApi('setMessageReaction', {
      chat_id: chatId,
      message_id: messageId,
      reaction: [{ type: 'emoji', emoji: emoji || pickReaction() }],
    });
  } catch (e) {
    log('debug', `reaction skipped (${emoji}):`, e.message);
  }
}

// React to a message the bot just sent (its own replies)
async function reactToOwn(ctx, msg, emoji) {
  if (msg && msg.message_id && ctx.chat && ctx.chat.id) react(ctx, ctx.chat.id, msg.message_id, emoji || pickReaction());
}

const inviteCache = new Map();
async function getInviteLink(telegram, chatId, username) {
  if (username) return `https://t.me/${username}`;
  if (inviteCache.has(chatId)) return inviteCache.get(chatId);
  const link = await telegram.callApi('exportChatInviteLink', { chat_id: Number(chatId) });
  inviteCache.set(chatId, link);
  return link;
}

async function membershipOk(telegram, userId) {
  const ids = Object.keys(DB.forceSub);
  if (ids.length === 0) return true;
  for (const id of ids) {
    try {
      const m = await telegram.callApi('getChatMember', { chat_id: Number(id), user_id: Number(userId) });
      const ok = ['creator', 'administrator', 'member'].includes(m.status);
      const restrictedOk = m.status === 'restricted' && m.is_member === true;
      if (!ok && !restrictedOk) return false;
    } catch (e) {
      log('warn', `membership check failed for chat ${id}:`, e.message);
      return false;
    }
  }
  return true;
}

const listChannels = () => Object.entries(DB.forceSub).map(([id, ch]) => ({ id, ...ch }));

const buildWelcome = (name) => ({
  built: new RH()
    .heading(1, '⏤ AUTO APPROVAL BOT')
    .paragraph(
      `Welcome <b>${name}</b>, to <b>${htmlEsc(BRAND_NAME)}</b> — the Premium Auto Approval Engine. ` +
      `Send a join request to the private channel, complete verification and get approved.`
    )
    .divider()
    .heading(2, '📌 HOW IT WORKS')
    .taskList(
      { text: 'Send a join request to the private channel', checked: true },
      { text: 'Join all the required channels below', checked: true },
      { text: 'Tap ✅ VERIFY', checked: true },
      { text: 'Your request gets approved 🎉', checked: true }
    )
    .paragraph('<i>Verification takes less than a minute.</i>')
    .footer(footerHtml())
    .build(),
  fallback:
    `<b>『 AUTO APPROVAL BOT 』</b>\n${DIVIDER}\n\n` +
    `👑 <b>Hello ${name}!</b>\n\n` +
    `🤖 I'm the <b>Auto Approval Bot</b> — I verify and approve join requests for the private channel.\n\n` +
    cardShell('📌  <b>HOW IT WORKS</b>',
      '1️⃣ Send a join request to the private channel\n' +
      '2️⃣ Join the channels/groups below\n' +
      '3️⃣ Tap the <b>✅ VERIFY</b> button\n' +
      '4️⃣ Your request gets approved 🎉') +
    `\n\n<blockquote>⚡ Fast  •  🔒 Secure  •  🟢 24/7 Online</blockquote>\n\n${footerHtml()}`,
});

const buildVerify = (name) => ({
  built: new RH()
    .heading(2, '⚠️ VERIFICATION REQUIRED')
    .blockQuote('◆ Join all the channels below\n◆ Then tap the ✅ VERIFY button')
    .divider()
    .heading(3, '📢 CHANNELS')
    .ul(...listChannels().map((c, i) => `${i + 1}. ${htmlEsc(c.title)}`))
    .details('Important', 'If verification fails, make sure you joined EVERY channel/group listed and the bot has permission to check your membership.')
    .footer(footerHtml())
    .build(),
  fallback:
    `<b>🔒 ${name}, your request is pending</b>\n\n` +
    cardShell('📢  <b>VERIFICATION REQUIRED</b>',
      '◆ Join all the channels below\n' +
      '◆ Then tap the <b>✅ VERIFY</b> button') +
    `\n\n<blockquote>${listChannels().map((c, i) => `◆ ${i + 1}. ${htmlEsc(c.title)}`).join('\n')}</blockquote>\n\n${footerHtml()}`,
});

const buildApproved = () => ({
  built: new RH()
    .heading(2, '✅ CONGRATULATIONS')
    .blockQuote('All requirements are complete — your join request has been <b>approved</b>.')
    .taskList(
      { text: 'Required channels joined', checked: true },
      { text: 'Verification passed', checked: true },
      { text: 'Join request approved', checked: true }
    )
    .paragraph('You can now enter the private channel and enjoy the content.')
    .footer(footerHtml())
    .build(),
  fallback: fallbackSuccess(
    'APPROVED 🎉',
    'All requirements are complete.<br>Your join request has been <b>approved</b> — you can now enter the private channel.'
  ),
});

async function buildVerifyKeyboard(telegram) {
  const buttons = [];
  for (const [id, ch] of Object.entries(DB.forceSub)) {
    try {
      const url = await getInviteLink(telegram, Number(id), ch.username);
      buttons.push([{ text: `🔗 ${String(ch.title).slice(0, 38)}`, url }]);
    } catch (e) {
      log('warn', `Could not export invite link for ${id}:`, e.message);
      buttons.push([{ text: `⚠️ ${String(ch.title).slice(0, 38)} (link error)`, callback_data: 'noop' }]);
    }
  }
  buttons.push([{ text: '✅ VERIFY  ◆', callback_data: 'verify_join' }]);
  return { inline_keyboard: buttons };
}

// ───────────────── Bot ─────────────────
const bot = new Telegraf(BOT_TOKEN);

bot.catch((err) => log('error', 'Telegraf error:', err && err.message ? err.message : err));

// ✦ Super reactions on every user message (private chats)
bot.use(async (ctx, next) => {
  try {
    const msg = ctx.message;
    if (msg && msg.message_id && ctx.chat && ctx.chat.type === 'private' && !msg.from?.is_bot) {
      react(ctx, ctx.chat.id, msg.message_id, pickReaction());
    }
  } catch (e) { /* silent */ }
  return next();
});

// /start — premium welcome card
bot.start(async (ctx) => {
  const name = htmlEsc((ctx.from && ctx.from.first_name) || 'User');
  const { built, fallback } = buildWelcome(name);
  const msg = await sendRichCard(ctx, ctx.chat.id, built, fallback);
  if (msg && msg.message_id) react(ctx, ctx.chat.id, msg.message_id, pickReaction());
});

// /help — command list
bot.help(async (ctx) => {
  const text =
    cardShell('📖  <b>HELP</b>',
      '<code>/start</code> — welcome card\n' +
      '<code>/addchat @username|id</code> — register a force-sub channel (owner)\n' +
      '<code>/delchat id</code> — remove a force-sub channel (owner)\n' +
      '<code>/listchat</code> — list force-sub channels (owner)') +
    `\n\n${footerHtml()}`;
  const msg = await ctx.replyWithHTML(text);
  reactToOwn(ctx, msg, '⚡');
});

// /addchat — owner registers a force-sub channel/group
bot.command('addchat', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return;
  const arg = (ctx.message.text.split(/\s+/)[1] || '').trim();
  if (!arg) {
    const msg = await ctx.replyWithHTML(fallbackWarn('USAGE', 'Usage: <code>/addchat @username</code>  or  <code>/addchat -1001234567890</code>'));
    return reactToOwn(ctx, msg, '⚠️');
  }
  const chatId = /^-?\d+$/.test(arg) ? Number(arg) : (arg.startsWith('@') ? arg : `@${arg}`);
  try {
    const chat = await ctx.telegram.callApi('getChat', { chat_id: chatId });
    DB.forceSub[String(chat.id)] = {
      title: chat.title || String(chat.id),
      username: chat.username || null,
    };
    saveData();
    const msg = await ctx.replyWithHTML(
      fallbackSuccess('CHANNEL ADDED', `<b>${htmlEsc(chat.title || String(chat.id))}</b>\n<code>${chat.id}</code> is now a force-subscribe channel.`)
    );
    reactToOwn(ctx, msg, '👑');
  } catch (e) {
    const msg = await ctx.replyWithHTML(fallbackError('FAILED', `Could not resolve that chat.\nMake sure the bot is a member/admin there.\n\n<code>${htmlEsc(e.message)}</code>`));
    reactToOwn(ctx, msg, '🚫');
  }
});

// /delchat — owner removes a force-sub channel/group
bot.command('delchat', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return;
  const arg = (ctx.message.text.split(/\s+/)[1] || '').trim();
  if (!arg) {
    const msg = await ctx.replyWithHTML(fallbackWarn('USAGE', 'Usage: <code>/delchat -1001234567890</code>'));
    return reactToOwn(ctx, msg, '⚠️');
  }
  const removed = DB.forceSub[arg];
  if (!removed) {
    const msg = await ctx.replyWithHTML(fallbackWarn('NOT FOUND', 'That chat is not in the force-sub list.'));
    return reactToOwn(ctx, msg, '⚠️');
  }
  delete DB.forceSub[arg];
  saveData();
  const msg = await ctx.replyWithHTML(fallbackSuccess('REMOVED', `<b>${htmlEsc(removed.title)}</b> removed from force-subscribe.`));
  reactToOwn(ctx, msg, '💥');
});

// /listchat — owner views force-sub list (+ /fsubstatus alias)
const listChatHandler = async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return;
  const entries = listChannels();
  const pendingTotal = Object.values(DB.pending).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
  if (entries.length === 0) {
    const msg = await ctx.replyWithHTML(fallbackInfo('STATUS', `No force-sub channels configured yet.\n\n⏳ Pending users: <code>${pendingTotal}</code>`));
    return reactToOwn(ctx, msg, '✨');
  }
  const lines = entries.map((c, i) => `◆ ${i + 1}. ${htmlEsc(c.title)} <code>(${c.id})</code>`).join('\n');
  const msg = await ctx.replyWithHTML(
    fallbackInfo(`FORCE-SUB LIST (${entries.length})`, lines) +
    `\n\n⏳ Users pending verification: <code>${pendingTotal}</code>`
  );
  reactToOwn(ctx, msg, '📋');
};
bot.command(['listchat', 'fsubstatus', 'listfsub'], listChatHandler);

// noop callback
bot.action('noop', (ctx) => ctx.answerCbQuery().catch(() => {}));

// Join request handler
bot.on('chat_join_request', async (ctx) => {
  const req = ctx.chatJoinRequest;
  if (!req) return;
  const userId = req.from.id;
  const chatId = Number(req.chat.id);
  const name = htmlEsc(req.from.first_name || 'User');

  // Deadlock avoidance: a request to a force-sub channel itself cannot be
  // verified (user can't become a member without approval).
  if (DB.forceSub[String(chatId)]) {
    try {
      await ctx.telegram.callApi('approveChatJoinRequest', { chat_id: chatId, user_id: userId });
      log('info', `Force-sub channel auto-approved: chat=${chatId} user=${userId}`);
    } catch (e) {
      log('error', `Force-sub approve failed chat=${chatId} user=${userId}:`, e.message);
    }
    return;
  }

  if (await membershipOk(ctx.telegram, userId)) {
    try {
      await ctx.telegram.callApi('approveChatJoinRequest', { chat_id: chatId, user_id: userId });
      log('info', `Approved: chat=${chatId} user=${userId}`);
      const { built, fallback } = buildApproved();
      const msg = await sendRichCard(ctx, userId, built, fallback);
      if (msg && msg.message_id) react(ctx, userId, msg.message_id, '🔥');
    } catch (e) {
      log('error', `Approve failed chat=${chatId} user=${userId}:`, e.message);
    }
    return;
  }

  // Do NOT decline — the request stays pending until the user verifies
  DB.pending[String(userId)] = Array.from(new Set([...(DB.pending[String(userId)] || []), String(chatId)]));
  saveData();

  const { built, fallback } = buildVerify(name);
  const keyboard = await buildVerifyKeyboard(ctx.telegram);
  const msg = await sendRichCard(ctx, userId, built, fallback, { reply_markup: keyboard });
  if (msg && msg.message_id) react(ctx, userId, msg.message_id, '👑');
});

// VERIFY callback
bot.action('verify_join', async (ctx) => {
  const userId = ctx.from.id;
  await ctx.answerCbQuery().catch(() => {});

  if (!(await membershipOk(ctx.telegram, userId))) {
    return ctx.answerCbQuery("❌ You haven't joined all the channels yet. Join them all first.", { show_alert: true });
  }

  const pending = DB.pending[String(userId)] || [];
  let approved = 0;
  let failed = 0;
  for (const cid of pending) {
    try {
      await ctx.telegram.callApi('approveChatJoinRequest', { chat_id: Number(cid), user_id: Number(userId) });
      approved++;
      log('info', `Approved pending: chat=${cid} user=${userId}`);
    } catch (e) {
      failed++;
      log('error', `Approve failed: chat=${cid} user=${userId}:`, e.message);
    }
  }
  delete DB.pending[String(userId)];
  saveData();

  const { built, fallback } = buildApproved();
  const chatId = ctx.chat && ctx.chat.id;
  const messageId = ctx.callbackQuery && ctx.callbackQuery.message && ctx.callbackQuery.message.message_id;

  // Replace the verify message with the approved card (edit → delete+resend)
  if (chatId && messageId) {
    try {
      await ctx.telegram.editMessageText(chatId, messageId, undefined, fallback, { parse_mode: 'HTML' });
    } catch (e) {
      try { await ctx.telegram.deleteMessage(chatId, messageId); } catch (e2) {}
    }
    // Upgrade to a real rich card silently
    try { await ctx.telegram.deleteMessage(chatId, messageId); } catch (e2) {}
    await sendRichCard(ctx, chatId, built, fallback);
    react(ctx, chatId, messageId, '🔥');
  } else if (chatId) {
    await sendRichCard(ctx, chatId, built, fallback);
  }
  if (failed > 0) log('warn', `Partial approval for user ${userId}: ${failed} failed`);
});

// ───────────────── Keep-alive server (Render + UptimeRobot) ─────────────────
const HTTP_STATS = { requests: 0 };

const KEEPALIVE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEsc(BRAND_NAME)} — ONLINE</title>
<style>
  :root { --glow:#7c5cff; --bg:#0b0b14; --txt:#f2f0ff; --dim:#8a87a8; --ok:#35e0a1; }
  * { margin:0; padding:0; box-sizing:border-box; font-family:'Segoe UI',system-ui,-apple-system,sans-serif; }
  body { min-height:100vh; background:radial-gradient(1200px 600px at 50% -10%, #241a4d 0%, var(--bg) 60%); color:var(--txt);
         display:flex; align-items:center; justify-content:center; overflow:hidden; }
  .orb { position:fixed; border-radius:50%; filter:blur(90px); opacity:.45; z-index:0; animation:drift 12s ease-in-out infinite alternate; }
  .orb.a { width:340px; height:340px; background:#5a2bff; top:-80px; left:-80px; }
  .orb.b { width:300px; height:300px; background:#b03bff; bottom:-70px; right:-70px; animation-delay:-6s; }
  @keyframes drift { from{transform:translate(0,0) scale(1)} to{transform:translate(60px,40px) scale(1.15)} }
  .card { position:relative; z-index:1; background:rgba(20,20,31,.82); border:1px solid rgba(124,92,255,.35); border-radius:22px;
          padding:48px 52px; text-align:center; max-width:460px; width:92%;
          box-shadow:0 0 60px rgba(124,92,255,.35), inset 0 0 40px rgba(124,92,255,.08); backdrop-filter:blur(12px); }
  .badge { display:inline-flex; align-items:center; gap:8px; font-size:12px; letter-spacing:2px; color:var(--ok);
           border:1px solid rgba(53,224,161,.4); background:rgba(53,224,161,.08); padding:6px 16px; border-radius:999px; margin-bottom:26px; }
  .dot { width:9px; height:9px; border-radius:50%; background:var(--ok); box-shadow:0 0 12px var(--ok); animation:pulse 1.4s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
  h1 { font-size:29px; font-weight:800; letter-spacing:1px; line-height:1.25;
       background:linear-gradient(135deg,#c9b8ff 0%,#7c5cff 45%,#b03bff 100%);
       -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; margin-bottom:10px; }
  .sub { color:var(--dim); font-size:12px; letter-spacing:3px; text-transform:uppercase; margin-bottom:26px; }
  .bar { height:4px; border-radius:4px; background:rgba(255,255,255,.06); overflow:hidden; margin-bottom:22px; }
  .bar > div { height:100%; width:40%; background:linear-gradient(90deg,#7c5cff,#b03bff); animation:slide 2.4s ease-in-out infinite; }
  @keyframes slide { 0%{transform:translateX(-100%)} 100%{transform:translateX(350%)} }
  .foot { color:var(--dim); font-size:11px; letter-spacing:2px; }
  .foot b { color:#a99ee8; }
</style>
</head>
<body>
  <div class="orb a"></div><div class="orb b"></div>
  <div class="card">
    <div class="badge"><span class="dot"></span>ONLINE</div>
    <h1>『 AUTO APPROVAL BOT 』</h1>
    <div class="sub">Premium Verification Bot</div>
    <div class="bar"><div></div></div>
    <div class="foot">✦ <b>AUTO APPROVAL BOT</b> • SECURE • VERIFIED ✦</div>
  </div>
</body>
</html>`;

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => { HTTP_STATS.requests++; next(); });

app.get('/', (req, res) => res.status(200).type('html').send(KEEPALIVE_HTML));

app.get('/ping', (req, res) =>
  res.status(200).json({ status: 'alive', uptime: getRuntime(), timestamp: Date.now() })
);

app.get('/health', (req, res) =>
  res.status(200).json({
    status: 'ok',
    uptime: getRuntime(),
    requests: HTTP_STATS.requests,
    force_sub_channels: Object.keys(DB.forceSub).length,
    pending_requests: Object.values(DB.pending).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0),
  })
);

const server = app.listen(PORT, '0.0.0.0', () =>
  log('success', `Keep-alive server listening on 0.0.0.0:${PORT}  (/ping, /health)`)
);

// Optional self-ping (UptimeRobot is recommended instead)
if (SELF_PING_URL) {
  const http = require('http');
  const https = require('https');
  setInterval(() => {
    const client = SELF_PING_URL.startsWith('https') ? https : http;
    client.get(SELF_PING_URL, (res) => log('info', `self-ping → ${res.statusCode}`)).on('error', (e) => log('warn', 'self-ping failed:', e.message));
  }, 14 * 60 * 1000);
}

// ───────────────── Launch ─────────────────
bot.launch({ drop_pending_updates: false })
  .then(() => log('success', `Bot is polling… (brand: ${BRAND_NAME})`))
  .catch((e) => { log('error', 'Launch failed:', e.message || e); process.exit(1); });

process.once('SIGINT', () => { log('warn', 'SIGINT — shutting down'); bot.stop('SIGINT'); server.close(() => process.exit(0)); });
process.once('SIGTERM', () => { log('warn', 'SIGTERM — shutting down'); bot.stop('SIGTERM'); server.close(() => process.exit(0)); });

process.on('unhandledRejection', (reason) => {
  const msg = (reason && reason.message) || String(reason);
  log('error', 'Unhandled rejection:', msg);
});
process.on('uncaughtException', (err) => {
  const msg = (err && err.message) || String(err);
  log('error', 'Uncaught exception:', msg);
});
