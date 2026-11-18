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
  const selected = events.filter(item => item.type === 'result' && item.uri?.toLowerCase().startsWith('trojan://') && Number.isFinite(item.ms)).sort((a, b) => a.ms - b.ms).slice(0, 5);
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
  const poems = [
    'رسید مژده که ایام غم نخواهد ماند\nچنان نماند و چنین نیز هم نخواهد ماند\n— حافظ',
    'دوش وقت سحر از غصه نجاتم دادند\nو اندر آن ظلمت شب آب حیاتم دادند\n— حافظ',
    'بر سر آنم که گر ز دست برآید\nدست به کاری زنم که غصه سر آید\n— حافظ',
    'درخت دوستی بنشان که کام دل به بار آرد\nنهال دشمنی برکن که رنج بی‌شمار آرد\n— حافظ',
    'هر روز فرصتی تازه برای شروع دوباره است 🌱',
    'نابرده رنج گنج میسر نمی‌شود\nمزد آن گرفت جان برادر که کار کرد\n— سعدی',
    'بنی‌آدم اعضای یک پیکرند\nکه در آفرینش ز یک گوهرند\n— سعدی',
  ];
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
  const poem = poems[day % poems.length];
  const configs = selected.map((item, index) => ({ config: rename(item.uri, index + 1), ping: Math.round(item.ms) }));
  const combined = configs.map(item => item.config).join('\n');
  const plainLength = [poem, combined, '🚀 کانال ما: @pass_net'].join('\n\n').length;
  if (plainLength > 4096) throw new Error('Five configurations exceed Telegram’s message limit; nothing sent.');
  const message = `${escape(poem)}\n\n<blockquote expandable><code>${escape(combined)}</code></blockquote>\n\n🚀 کانال ما: @pass_net`;
  await telegram('sendMessage', { chat_id: chatId, text: message, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  console.log(`Sent ${selected.length} tested configurations in one message.`);
}
