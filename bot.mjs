import { readFile } from 'node:fs/promises';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

async function telegram(method, payload = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(`Telegram ${method}: ${result.description}`);
  return result.result;
}

if (process.argv.includes('--discover')) {
  const updates = await telegram('getUpdates', { allowed_updates: ['message', 'my_chat_member'] });
  const chats = new Map();
  for (const update of updates) {
    const chat = update.message?.chat ?? update.my_chat_member?.chat;
    if (chat && ['group', 'supergroup'].includes(chat.type)) chats.set(chat.id, chat.title);
  }
  for (const [id, title] of chats) console.log(`${title}: ${id}`);
  if (!chats.size) throw new Error('No group updates available; send /start in the group and retry.');
} else {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) throw new Error('TELEGRAM_CHAT_ID is required');
  const output = await readFile('results.jsonl', 'utf8');
  const events = output.split(/\r?\n/).filter(line => line.startsWith('PSJSON:')).map(line => JSON.parse(line.slice(7)));
  if (!events.some(item => item.type === 'done')) throw new Error('Proxy test did not finish; nothing sent.');
  const selected = events.filter(item => item.type === 'result' && item.uri && Number.isFinite(item.ms)).sort((a, b) => a.ms - b.ms).slice(0, 5);
  if (!selected.length) throw new Error('No working configurations found; nothing sent.');
  const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  function rename(config, index) {
    const label = `@pass_net ${index}`;
    if (config.startsWith('vmess://')) {
      const raw = config.slice(8).split('#')[0];
      const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
      parsed.ps = label;
      return 'vmess://' + Buffer.from(JSON.stringify(parsed)).toString('base64');
    }
    return config.split('#')[0] + '#' + encodeURIComponent(label);
  }
  for (const [index, item] of selected.entries()) {
    const config = rename(item.uri, index + 1);
    const message = `🌱 هنوز هم می‌شود به فردا امیدوار بود\n\n<blockquote expandable>${escape(config)}</blockquote>\n\n⚡️ پینگ: ${Math.round(item.ms)} ms\n🚀 کانال ما: @pass_net`;
    await telegram('sendMessage', { chat_id: chatId, text: message, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  }
  console.log(`Sent ${selected.length} tested configurations.`);
}
