#!/usr/bin/env node
/**
 * ══════════════════════════════════════════════════════════════
 *  AUTO APPROVAL BOT — Telekaf Rich Messages Edition
 *  Telegraf (from @icanseeuanywhere/telekaf) + RichMessage cards
 *
 *  • Approves join requests for the private channel only after the
 *    user joins all configured force-subscribe channels/groups
 *  • Real RichMessage cards (headings, tables, task lists, footer)
 *  • Animated message effects (multiple emoji effects, celebration default)
 *  • Super reactions on user messages and on the bot's own replies
 *  • Premium welcome card: @username mention, music theme, rich features
 *  • Built-in keep-alive HTTP server for Render + UptimeRobot
 *    (/ , /ping , /health , /welcome.mp3)
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
const DEV_TAG = process.env.DEV_TAG || '@DEV_AI_REMASTERED';
const REACTIONS = ['1', 'true', 'yes', 'on'].includes(String(process.env.REACTIONS || 'on').toLowerCase());
const EFFECTS = ['1', 'true', 'yes', 'on'].includes(String(process.env.EFFECTS || 'on').toLowerCase());
const WELCOME_AUDIO = ['1', 'true', 'yes', 'on'].includes(String(process.env.WELCOME_AUDIO || 'on').toLowerCase());
const PORT = Number(process.env.PORT || 3000);
const SELF_PING_URL = process.env.SELF_PING_URL || '';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'fsub_data.json');
const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://auto-approve-bot-m60r.onrender.com').replace(/\/+$/, '');
const WELCOME_AUDIO_URL = process.env.WELCOME_AUDIO_URL || `${PUBLIC_URL}/welcome.mp3`;
const WELCOME_AUDIO_FILE = path.join(__dirname, 'assets', 'welcome.mp3');
const WELCOME_IMAGE = ['1', 'true', 'yes', 'on'].includes(String(process.env.WELCOME_IMAGE || 'on').toLowerCase());
const WELCOME_IMAGE_URL = process.env.WELCOME_IMAGE_URL || 'https://files.catbox.moe/h5wvi8.webp';
const WELCOME_IMAGE_FILE = path.join(__dirname, 'assets', 'welcome.jpg');
const WELCOME_IMAGE2_URL = process.env.WELCOME_IMAGE2_URL || `${PUBLIC_URL}/welcome2.jpg`;
const WELCOME_IMAGE2_FILE = path.join(__dirname, 'assets', 'welcome2.jpg');
const WELCOME_IMAGE3_URL = process.env.WELCOME_IMAGE3_URL || `${PUBLIC_URL}/welcome3.jpg`;
const WELCOME_IMAGE3_FILE = path.join(__dirname, 'assets', 'welcome3.jpg');
// Official listening link (we don't host copyrighted audio — we link the official source)
const LISTEN_LINK = ['1', 'true', 'yes', 'on'].includes(String(process.env.LISTEN_LINK || 'on').toLowerCase());
const OFFICIAL_LISTEN_URL = process.env.OFFICIAL_LISTEN_URL || 'https://www.youtube.com/watch?v=ZE0vLQ9nZH4';

if (!BOT_TOKEN) { console.error('❌ Missing BOT_TOKEN'); process.exit(1); }
if (!OWNER_ID) { console.error('❌ Missing OWNER_ID'); process.exit(1); }

const START_TS = Date.now();
const DIVIDER = '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯';

// ✦ Super reaction pool — fired on user messages and the bot's own replies
const REACTION_POOL = ['🔥', '⚡', '👑', '💎', '✨', '🚀', '💥', '⭐', '❤️‍🔥', '🫡'];
const pickReaction = () => REACTION_POOL[Math.floor(Math.random() * REACTION_POOL.length)];

// ✦ Animated message effects (decorate bot messages — NOT reaction counts).
//    IDs are community-documented Telegram effect IDs; effects only render
//    in private chats. If Telegram rejects one, we transparently retry without.
const DEFAULT_CELEBRATION_EFFECT_ID = process.env.DEFAULT_CELEBRATION_EFFECT_ID || '5046509860389126442';
const EFFECT_POOL = [
  { id: DEFAULT_CELEBRATION_EFFECT_ID, emoji: '🎉', name: 'celebration' },
  { id: '5104841245755180586', emoji: '🔥', name: 'fire' },
  { id: '5159385139981059251', emoji: '❤️', name: 'heart' },
  { id: '5170166362592510656', emoji: '👏', name: 'clap' },
  { id: '5089343350188802996', emoji: '🥳', name: 'party' },
  { id: '5161554034041029689', emoji: '🤩', name: 'starstruck' },
  { id: '4962976753686414048', emoji: '💯', name: 'hundred' },
  { id: '5123236135417415011', emoji: '⚡', name: 'zap' },
  { id: '5123046001510188023', emoji: '🏆', name: 'trophy' },
  { id: '4961122255527478034', emoji: '🍾', name: 'champagne' },
  { id: '5089422278802801345', emoji: '👑', name: 'crown' },
  { id: '4965608262968804599', emoji: '💎', name: 'gem' },
  { id: '5121096477199827757', emoji: '💥', name: 'boom' },
  { id: '5089460564141278042', emoji: '✨', name: 'sparkles' },
  { id: '5041819580008236993', emoji: '🎊', name: 'tada' },
  { id: '5044101728060834560', emoji: '🎆', name: 'fireworks' },
  { id: '4913930782671635058', emoji: '🫡', name: 'salute' },
  { id: '5048771083361059460', emoji: '😁', name: 'grin' },
  { id: '5066779159678682060', emoji: '😍', name: 'love' },
  { id: '5170169077011841524', emoji: '🥰', name: 'inlove' },
];
const pickEffect = (preferCelebration = false) => {
  if (!EFFECTS) return null;
  if (preferCelebration) return DEFAULT_CELEBRATION_EFFECT_ID;
  return EFFECT_POOL[Math.floor(Math.random() * EFFECT_POOL.length)].id;
};

// ✦ Fancy Unicode fonts for premium-looking plain-text accents
const FANCY = (() => {
  const build = (up, low, dig) => {
    const map = {};
    for (let i = 0; i < 26; i++) {
      map[String.fromCharCode(65 + i)] = String.fromCodePoint(up + i);
      map[String.fromCharCode(97 + i)] = String.fromCodePoint(low + i);
    }
    for (let i = 0; i < 10; i++) map[String.fromCharCode(48 + i)] = String.fromCodePoint(dig + i);
    return map;
  };
  const fonts = {
    bold: build(0x1D400, 0x1D41A, 0x1D7CE),   // 𝗦𝗘𝗥𝗜𝗙 𝗕𝗢𝗟𝗗
    sans: build(0x1D5D4, 0x1D5EE, 0x1D7EC),   // 𝗦𝗔𝗡𝗦 𝗕𝗢𝗟𝗗
    mono: build(0x1D670, 0x1D68A, 0x1D7F6),   // 𝚖𝚘𝚗𝚘𝚜𝚙𝚊𝚌𝚎
    script: build(0x1D4D0, 0x1D4EA, 0x1D7CE), // 𝓈𝖼𝗋𝗂𝗉𝗍
    fraktur: build(0x1D504, 0x1D51E, 0x1D7CE),// 𝔣𝔯𝔞𝔨𝔱𝔲𝔯
    double: build(0x1D538, 0x1D552, 0x1D7CE), // 𝕕𝕠𝕦𝕓𝕝𝕖 𝕤𝕥𝕣𝕦𝕔𝕜
    bfractur: build(0x1D56C, 0x1D586, 0x1D7CE),// 𝖇𝖔𝖑𝖉 𝖋𝖗𝖆𝖐𝖙𝖚𝖗
  };
  return (text, font = 'bold') => {
    const m = fonts[font] || fonts.sans;
    return String(text).split('').map((c) => m[c] || c).join('');
  };
})();

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
  const brandText = FANCY(htmlEsc(BRAND_NAME).toUpperCase(), 'bold');
  const brand = BRAND_LINK
    ? `<a href="${BRAND_LINK}">${brandText}</a>`
    : `<b>${brandText}</b>`;
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

async function sendRichCard(ctx, chatId, built, fallbackHtml, extra = {}, opts = {}) {
  const tg = ctx.telegram;
  const preferCelebration = !!opts.celebration;
  const effectId = pickEffect(preferCelebration);
  const attempt = async (label, fn) => {
    try {
      return await fn();
    } catch (e) {
      log('warn', `${label} failed for chat ${chatId}:`, e && e.message ? e.message : e);
      return null;
    }
  };

  if (tg.sendRichMessage) {
    // 1) rich card with animated effect (private chats)
    if (effectId) {
      const withEffect = await attempt('rich+effect', () =>
        tg.sendRichMessage(chatId, built, { ...extra, message_effect_id: effectId })
      );
      if (withEffect) return withEffect;
    }
    // 2) rich card without effect (effect rejected / unsupported)
    const plainRich = await attempt('rich', () => tg.sendRichMessage(chatId, built, extra));
    if (plainRich) return plainRich;
  }
  // 3) styled HTML fallback
  const htmlMsg = await attempt('html', () =>
    tg.sendMessage(chatId, fallbackHtml, { parse_mode: 'HTML', ...extra })
  );
  if (htmlMsg) return htmlMsg;
  // 4) plain text last resort
  const plainMsg = await attempt('plain', () =>
    tg.sendMessage(chatId, fallbackHtml.replace(/<[^>]+>/g, ''), extra)
  );
  if (!plainMsg) log('error', 'Could not deliver message to chat', chatId);
  return plainMsg;
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
    log('warn', `reaction failed (${emoji}):`, e.message);
  }
}

// sendAudio with effect → transparent retry without effect (private chats only)
async function sendAudioSafe(telegram, chatId, baseOpts, effectId) {
  const file = { source: WELCOME_AUDIO_FILE, filename: 'auto-approval-bot-welcome-theme.mp3' };
  try {
    const opts = effectId ? { ...baseOpts, message_effect_id: effectId } : baseOpts;
    return await telegram.sendAudio(chatId, file, opts);
  } catch (e) {
    log('warn', 'sendAudio (with effect) failed, retrying plain:', e.message);
    try {
      return await telegram.sendAudio(chatId, file, baseOpts);
    } catch (e2) {
      log('warn', 'sendAudio failed:', e2.message);
      return null;
    }
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

const buildWelcome = (user) => {
  const userId = user && user.id;
  const name = htmlEsc((user && user.first_name) || 'User');
  const mention = userId ? `<a href="tg://user?id=${userId}">${name}</a>` : name;

  const rich = new RH()
    .heading(1, `👑 ${FANCY(htmlEsc(BRAND_NAME).toUpperCase(), 'bold')}`)
    .paragraph(`Welcome, ${mention} 🎉`)
    .paragraph(RH.italic(FANCY('Premium auto-approval engine for exclusive channels — built for VIPs.', 'bold')));
  if (WELCOME_IMAGE && WELCOME_IMAGE_URL) rich.photo(WELCOME_IMAGE_URL, `👑  ${htmlEsc(BRAND_NAME)}`);
  if (WELCOME_AUDIO && WELCOME_AUDIO_URL) rich.audio(WELCOME_AUDIO_URL, '🎵  Welcome Theme — Desi Dhol Beats');
  rich
    .divider()
    .heading(2, '◆ HOW IT WORKS')
    .taskList(
      { text: 'Send a join request to the private channel', checked: true },
      { text: 'Join all the required channels below', checked: true },
      { text: 'Tap ✅ VERIFY', checked: true },
      { text: 'Your request gets approved 🎉', checked: true }
    )
    .divider()
    .heading(2, '◆ WHY YOU’LL LOVE IT')
    .table(
      [
        ['Feature', 'Status'],
        ['Auto Approval', '⚡ Instant'],
        ['Force-Sub Gate', '🛡️ Multi-channel'],
        ['Uptime', '🟢 24/7'],
        ['Support', DEV_TAG ? htmlEsc(DEV_TAG) : 'In-bot'],
      ],
      { bordered: true, striped: true, hasHeader: true, compact: true }
    )
    .details('❓ FAQ & RULES',
      '<p><b>1.</b> Send a join request to the private channel.</p>' +
      '<p><b>2.</b> Join EVERY force-subscribe channel/group listed by the bot.</p>' +
      '<p><b>3.</b> Tap <b>✅ VERIFY</b> — you are approved the moment membership is detected.</p>' +
      '<p>⚠️ Requests from users who never tap VERIFY stay pending forever.</p>' +
      '<p>⚠️ Faking membership is impossible — the bot verifies it live.</p>')
    .paragraph('🎁 ' + RH.spoiler('Early supporters get lifetime priority approval.'))
    .pullQuote('Fast. Secure. Premium.', htmlEsc(BRAND_NAME));

  // Three inline buttons: 2 on top row, 1 below
  const ownerId = process.env.OWNER_ID || '';
  rich.buttonRow(
    [
      { text: '📋 Menu', callbackData: 'show_cmds', style: 'primary' },
      { text: '➕ Add Me to Channel', url: 'https://t.me/Techzone_info_bot?startgroup=new', style: 'secondary' },
    ],
    'center'
  );
  if (ownerId) {
    rich.buttonRow([{ text: '👑 Contact Owner', url: `tg://user?id=${ownerId}`, style: 'primary' }], 'center');
  }

  // NO footer — removed per user request

  // Return RH instance (like /menu does) so sendRichMessage works correctly
  return {
    built: rich.build(),
    fallback:
      `<b>『 ${FANCY(BRAND_NAME.toUpperCase(), 'bold')} 』</b>\n${DIVIDER}\n\n` +
      `👑 <b>Welcome, ${mention}!</b>\n\n` +
      `🤖 I'm the <b>Auto Approval Bot</b> — I verify and approve join requests for the private channel.\n\n` +
      cardShell('📌  <b>HOW IT WORKS</b>',
        '1️⃣ Send a join request to the private channel\n' +
        '2️⃣ Join the channels/groups below\n' +
        '3️⃣ Tap the <b>✅ VERIFY</b> button\n' +
        '4️⃣ Your request gets approved 🎉') +
      `\n\n` +
      cardShell('✨  <b>WHY YOU’LL LOVE IT</b>',
        '⚡ Instant approval  •  🛡️ Force-sub gate\n' +
        '🟢 24/7 online  •  🎵 Welcome theme song\n' +
        (DEV_TAG ? `💬 Support: ${htmlEsc(DEV_TAG)}` : '')),
};
};
const buildVerify = (name) => ({
  built: new RH()
    .heading(2, '⚠️ VERIFICATION REQUIRED')
    .blockQuote('◆ Join all the channels below\n◆ Then tap the ✅ VERIFY button')
    .divider()
    .heading(3, '📢 CHANNELS')
    .raw(listChannels().length
      ? `<ul>${listChannels().map((c, i) => `<li>${i + 1}. ${htmlEsc(c.title)}</li>`).join('')}</ul>`
      : '<p>✅ No channels configured — you will be approved automatically.</p>')
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
    .heading(2, '🎉 CONGRATULATIONS')
    .blockQuote('All requirements are complete — your join request has been <b>approved</b>.')
    .taskList(
      { text: 'Required channels joined', checked: true },
      { text: 'Verification passed', checked: true },
      { text: 'Join request approved', checked: true }
    )
    .pullQuote('Welcome to the inner circle.', htmlEsc(BRAND_NAME))
    .paragraph('You can now enter the private channel and enjoy the content. 🥂')
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

// /start — premium welcome card (+ Welcome Theme music)
bot.start(async (ctx) => {
  const { built, fallback } = buildWelcome(ctx.from);
  const msg = await sendRichCard(ctx, ctx.chat.id, built, fallback, {}, { celebration: true });
  if (msg && msg.message_id) react(ctx, ctx.chat.id, msg.message_id, '🎉');

  // ✦ Welcome Theme music — plays inline in the chat
  if (WELCOME_AUDIO && fs.existsSync(WELCOME_AUDIO_FILE)) {
    const caption = `🎵  Welcome, ${htmlEsc((ctx.from && ctx.from.first_name) || 'User')}!  ${FANCY('AUTO APPROVAL BOT', 'bold')}`;
    const audioOpts = {
      caption,
      parse_mode: 'HTML',
      title: 'AUTO APPROVAL BOT — Welcome Theme',
      performer: BRAND_NAME,
    };
    const eff = pickEffect(true);
    const audio = await sendAudioSafe(ctx.telegram, ctx.chat.id, audioOpts, eff);
    if (audio && audio.message_id) react(ctx, ctx.chat.id, audio.message_id, '⚡');
  }
});

// /menu — commands page (also opened from inline button)
bot.command('menu', async (ctx) => {
  const built = new RH()
    .heading(2, '⌨️ COMMANDS')
    .table(
      [
        ['Command', 'What it does'],
        ['/start', 'Premium welcome card with images & theme music'],
        ['/addchat @username|id', 'Register a force-sub channel (owner only)'],
        ['/delchat id', 'Remove a force-sub channel (owner only)'],
        ['/listchat', 'List all force-sub channels (owner only)'],
        ['/verify_join', 'Tap to verify membership & get approved'],
        ['/menu', 'Show this commands page'],
      ],
      { bordered: true, striped: true, hasHeader: true, compact: true }
    )
    .paragraph(`💬 Support: ${DEV_TAG ? htmlEsc(DEV_TAG) : 'In-bot'}`);
  const fallback =
    `<b>『 ${FANCY(BRAND_NAME.toUpperCase(), 'bold')} 』</b>\n${DIVIDER}\n\n` +
    `⌨️ <b>COMMANDS</b>\n\n` +
    `• /start — Premium welcome card with images & theme music\n` +
    `• /addchat @username|id — Register a force-sub channel (owner only)\n` +
    `• /delchat id — Remove a force-sub channel (owner only)\n` +
    `• /listchat — List all force-sub channels (owner only)\n` +
    `• /verify_join — Tap to verify membership & get approved\n` +
    `• /menu — Show this commands page\n\n`;
  const msg = await sendRichCard(ctx, ctx.chat.id, built, fallback, {}, { celebration: false });
  reactToOwn(ctx, msg, '⌨️');
});

// /help — command list (rich card)
bot.help(async (ctx) => {
  const built = new RH()
    .heading(2, '📖 HELP')
    .table(
      [
        ['Command', 'What it does'],
        ['/start', 'Premium welcome card with images & theme music'],
        ['/addchat @username|id', 'Register a force-sub channel (owner only)'],
        ['/delchat id', 'Remove a force-sub channel (owner only)'],
        ['/listchat', 'List all force-sub channels (owner only)'],
        ['/verify_join', 'Tap to verify membership & get approved'],
        ['/menu', 'Show this commands page'],
      ],
      { bordered: true, striped: true, hasHeader: true, compact: true }
    )
;
  const fallback =
    `<b>『 ${FANCY(BRAND_NAME.toUpperCase(), 'bold')} 』</b>\n${DIVIDER}\n\n` +
    `📖 <b>HELP</b>\n\n` +
    `• /start — Premium welcome card with images & theme music\n` +
    `• /addchat @username|id — Register a force-sub channel (owner only)\n` +
    `• /delchat id — Remove a force-sub channel (owner only)\n` +
    `• /listchat — List all force-sub channels (owner only)\n` +
    `• /verify_join — Tap to verify membership & get approved\n` +
    `• /menu — Show this commands page\n\n`;
  const msg = await sendRichCard(ctx, ctx.chat.id, built, fallback, {}, { celebration: false });
  reactToOwn(ctx, msg, '⚡');
});

// /addchat — owner registers a force-sub channel/group
bot.command('addchat', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return;
  const arg = (ctx.message.text.split(/\s+/)[1] || '').trim();
  if (!arg) {
    const built = new RH()
      .heading(2, '⚠️ USAGE')
      .paragraph(`Usage: <code>/addchat @username</code>  or  <code>/addchat -1001234567890</code>`)
      .footer(footerHtml());
    const fallback =
      `<b>『 ${FANCY(BRAND_NAME.toUpperCase(), 'bold')} 』</b>\n${DIVIDER}\n\n` +
      `⚠️ <b>USAGE</b>\n\n` +
      `Usage: /addchat @username  or  /addchat -1001234567890\n\n` +
      `${footerHtml()}`;
    const msg = await sendRichCard(ctx, ctx.chat.id, built, fallback, {}, { celebration: false });
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
    const built = new RH()
      .heading(2, '⚠️ USAGE')
      .paragraph(`Usage: <code>/delchat -1001234567890</code>`)
      .footer(footerHtml());
    const fallback =
      `<b>『 ${FANCY(BRAND_NAME.toUpperCase(), 'bold')} 』</b>\n${DIVIDER}\n\n` +
      `⚠️ <b>USAGE</b>\n\n` +
      `Usage: /delchat -1001234567890\n\n` +
      `${footerHtml()}`;
    const msg = await sendRichCard(ctx, ctx.chat.id, built, fallback, {}, { celebration: false });
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
      const msg = await sendRichCard(ctx, userId, built, fallback, {}, { celebration: true });
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
    const newMsg = await sendRichCard(ctx, chatId, built, fallback, {}, { celebration: true });
    react(ctx, chatId, newMsg && newMsg.message_id ? newMsg.message_id : messageId, '🔥');
  } else if (chatId) {
    await sendRichCard(ctx, chatId, built, fallback, {}, { celebration: true });
  }
  if (failed > 0) log('warn', `Partial approval for user ${userId}: ${failed} failed`);
});

// ⌨️ Commands page — opens when user taps the Commands inline button
bot.action('show_cmds', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const userId = ctx.from.id;
  const built = new RH()
    .heading(2, '⌨️ COMMANDS')
    .table(
      [
        ['Command', 'What it does'],
        ['/start', 'Premium welcome card with images & theme music'],
        ['/addchat @username|id', 'Register a force-sub channel (owner only)'],
        ['/delchat id', 'Remove a force-sub channel (owner only)'],
        ['/listchat', 'List all force-sub channels (owner only)'],
        ['/verify_join', 'Tap to verify membership & get approved'],
      ],
      { bordered: true, striped: true, hasHeader: true, compact: true }
    )
    .paragraph(`💬 Support: ${DEV_TAG ? htmlEsc(DEV_TAG) : 'In-bot'}`);
  const fallback =
    `<b>『 ${FANCY(BRAND_NAME.toUpperCase(), 'bold')} 』</b>\n${DIVIDER}\n\n` +
    `⌨️ <b>COMMANDS</b>\n\n` +
    `• /start — Premium welcome card with images & theme music\n` +
    `• /addchat @username|id — Register a force-sub channel (owner only)\n` +
    `• /delchat id — Remove a force-sub channel (owner only)\n` +
    `• /listchat — List all force-sub channels (owner only)\n` +
    `• /verify_join — Tap to verify membership & get approved\n\n`;
  await sendRichCard(ctx, userId, built, fallback, {}, { celebration: false });
});

// 🛡️ Admin permissions page — shows what bot needs when added to channel
bot.action('show_admin_perms', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const built = new RH()
    .heading(2, '🤖 ADD BOT AS ADMIN')
    .blockQuote('Bot ko channel/group mein admin banane ke liye ye permissions ON karein:')
    .divider()
    .table(
      [
        ['Permission', 'Kyon zaroori hai'],
        ['Can restrict members', 'Join requests approve/reject karne ke liye'],
        ['Can delete messages', 'Spam aur galat messages hataane ke liye'],
        ['Can pin messages', 'Zaroori notices pin karne ke liye'],
        ['Can invite users via link', 'Naye members ko invite link se jodne ke liye'],
        ['Can change chat info', 'Channel ka naam/photo update karne ke liye (optional)'],
      ],
      { bordered: true, striped: true, hasHeader: true, compact: true }
    )
    .paragraph('⚠️ Bina in permissions ke bot join requests approve nahi kar payega.')
    .paragraph(`👤 Owner: ${DEV_TAG ? htmlEsc(DEV_TAG) : 'In-bot'}`);
  const fallback =
    `<b>『 ${FANCY(BRAND_NAME.toUpperCase(), 'bold')} 』</b>\n${DIVIDER}\n\n` +
    `🤖 <b>ADD BOT AS ADMIN</b>\n\n` +
    `Bot ko channel/group mein admin banane ke liye ye permissions ON karein:\n\n` +
    `• Can restrict members — Join requests approve/reject karne ke liye\n` +
    `• Can delete messages — Spam hataane ke liye\n` +
    `• Can pin messages — Notices pin karne ke liye\n` +
    `• Can invite users via link — Naye members jodne ke liye\n` +
    `• Can change chat info — Channel update karne ke liye (optional)\n\n` +
    `⚠️ Bina in permissions ke bot join requests approve nahi kar payega.\n\n` +
    `👤 Owner: ${DEV_TAG ? htmlEsc(DEV_TAG) : 'In-bot'}`;
  await sendRichCard(ctx, ctx.from.id, built, fallback, {}, { celebration: false });
});

// ───────────────── Keep-alive server (Render + UptimeRobot) ─────────────────
const HTTP_STATS = { requests: 0 };

const KEEPALIVE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEsc(BRAND_NAME)} — ONLINE</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root { --glow:#7c5cff; --bg:#0b0b14; --txt:#f2f0ff; --dim:#8a87a8; --ok:#35e0a1; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Inter',system-ui,-apple-system,sans-serif; min-height:100vh; background:radial-gradient(1200px 600px at 50% -10%, #241a4d 0%, var(--bg) 60%); color:var(--txt);
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
  h1 { font-family:'Cinzel',Georgia,serif; font-size:30px; font-weight:800; letter-spacing:1.5px; line-height:1.3;
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

// 👑 Welcome hero image — served so Telegram can render it inside rich messages
app.get('/welcome.jpg', (req, res) => {
  if (!fs.existsSync(WELCOME_IMAGE_FILE)) return res.status(404).json({ error: 'image not found' });
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Content-Length', fs.statSync(WELCOME_IMAGE_FILE).size);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(WELCOME_IMAGE_FILE).pipe(res);
});

// 👑 Welcome image #2 — catbox.moe upload
app.get('/welcome2.jpg', (req, res) => {
  if (!fs.existsSync(WELCOME_IMAGE2_FILE)) return res.status(404).json({ error: 'image not found' });
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Content-Length', fs.statSync(WELCOME_IMAGE2_FILE).size);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(WELCOME_IMAGE2_FILE).pipe(res);
});

// 👑 Welcome image #3 — catbox.moe upload
app.get('/welcome3.jpg', (req, res) => {
  if (!fs.existsSync(WELCOME_IMAGE3_FILE)) return res.status(404).json({ error: 'image not found' });
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Content-Length', fs.statSync(WELCOME_IMAGE3_FILE).size);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(WELCOME_IMAGE3_FILE).pipe(res);
});

// 🎵 Welcome Theme — served so Telegram can render it inside rich messages
app.get('/welcome.mp3', (req, res) => {
  if (!fs.existsSync(WELCOME_AUDIO_FILE)) return res.status(404).json({ error: 'audio not found' });
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Length', fs.statSync(WELCOME_AUDIO_FILE).size);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(WELCOME_AUDIO_FILE).pipe(res);
});

const server = app.listen(PORT, '0.0.0.0', () =>
  log('success', `Keep-alive server listening on 0.0.0.0:${PORT}  (/ping, /health, /welcome.mp3)`)
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
// Retry on duplicate-poller conflicts (409) instead of exiting — a dying
// process means Render returns 502. Keep the process (and /ping) alive.
async function launchWithRetry(attempt = 1) {
  try {
    await bot.launch({ drop_pending_updates: false });
    log('success', `Bot is polling… (brand: ${BRAND_NAME})`);
  } catch (e) {
    const msg = (e && e.message) || String(e);
    log('error', `Launch failed (attempt ${attempt}/6):`, msg);
    if (/409|conflict/i.test(msg) && attempt < 6) {
      log('warn', 'Duplicate poller conflict — retrying in 5s…');
      await new Promise((r) => setTimeout(r, 5000));
      return launchWithRetry(attempt + 1);
    }
    log('error', 'Polling disabled — keep-alive server stays up (check bot token / duplicates).');
  }
}

// Exported for tests — requiring this file does not start polling.
module.exports = { buildWelcome, buildVerify, buildApproved, sendRichCard, FANCY, EFFECT_POOL, pickEffect };

if (require.main === module) {
  launchWithRetry();

  process.once('SIGINT', () => { log('warn', 'SIGINT — shutting down'); bot.stop('SIGINT'); server.close(() => process.exit(0)); });
  process.once('SIGTERM', () => { log('warn', 'SIGTERM — shutting down'); bot.stop('SIGTERM'); server.close(() => process.exit(0)); });
}

process.on('unhandledRejection', (reason) => {
  const msg = (reason && reason.message) || String(reason);
  log('error', 'Unhandled rejection:', msg);
});
process.on('uncaughtException', (err) => {
  const msg = (err && err.message) || String(err);
  log('error', 'Uncaught exception:', msg);
});
