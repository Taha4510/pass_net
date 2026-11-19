import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const channel = '@pass_net';
const maxDelayMs = 5000;
const maxMessageLength = 4096;
const warning = '⚠️ تست این نوبت کامل شد؛ هیچ کانفیگ Trojan معیار اتصال پایدار را نگذراند.';
const footer = '🚀 کانال ما: ' + channel;
const poems = [
  'رسید مژده که ایام غم نخواهد ماند\nچنان نماند و چنین نیز هم نخواهد ماند\n— حافظ',
  'دوش وقت سحر از غصه نجاتم دادند\nواندر آن ظلمت شب آب حیاتم دادند\n— حافظ',
  'بر سر آنم که گر ز دست برآید\nدست به کاری زنم که غصه سر آید\n— حافظ',
  'درخت دوستی بنشان که کام دل به بار آرد\nنهال دشمنی برکن که رنج بی‌شمار آرد\n— حافظ',
  'هر روز فرصتی تازه برای شروع دوباره است 🌱',
  'نابرده رنج گنج میسر نمی‌شود\nمزد آن گرفت جان برادر که کار کرد\n— سعدی',
  'بنی‌آدم اعضای یک پیکرند\nکه در آفرینش ز یک گوهرند\n— سعدی',
];

export function readResults(stdout, exitCode) {
  const records = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith('PSJSON:')) continue;
    try {
      const record = JSON.parse(line.slice(7));
      if (!record || typeof record.type !== 'string') throw new Error();
      records.push(record);
    } catch {
      throw new Error('Tester wrote an invalid result record.');
    }
  }
  const fetched = records.filter(x => x.type === 'fetched');
  const results = records.filter(x => x.type === 'result');
  const errors = records.filter(x => x.type === 'error');
  const last = records.at(-1);
  const validFetch = fetched.length === 1 && Number.isSafeInteger(fetched[0].count) && fetched[0].count >= 0;
  if (exitCode === 1 && validFetch && errors.length === 1 && last === errors[0] &&
      last.code === 'NO_RESULTS' && !results.length && !records.some(x => x.type === 'done')) {
    return { tested: fetched[0].count, results };
  }
  if (exitCode !== 0) {
    const knownCodes = new Set(['INVALID_OPTIONS', 'NETWORK_ERROR', 'EMPTY_BODY', 'SUBSCRIPTION_TOO_LARGE', 'NO_VALID_SCHEMES']);
    const reason = knownCodes.has(last?.code) ? last.code : 'UNEXPECTED_FAILURE';
    throw new Error(`Tester failed: ${reason} (exit ${exitCode}).`);
  }
  const done = records.filter(x => x.type === 'done');
  if (!validFetch || errors.length || done.length !== 1 || last !== done[0] ||
      last.count !== results.length || results.length > fetched[0].count) {
    throw new Error('Tester output is incomplete or inconsistent.');
  }
  return { tested: fetched[0].count, results };
}

function configIdentity(uri) {
  if (typeof uri !== 'string' || !/^trojan:\/\//i.test(uri) || /[\x00-\x20\x7f]/.test(uri.split('#', 1)[0])) return;
  const clean = uri.split('#', 1)[0];
  try {
    const parsed = new URL(clean);
    if (!parsed.hostname || !parsed.username) return;
  } catch {
    return;
  }
  return clean;
}

export function selectResults(results) {
  const ranked = results
    .map(item => ({ ...item, clean: configIdentity(item.uri) }))
    .filter(item => item.clean && Number.isFinite(item.ms) && item.ms >= 0 && item.ms <= maxDelayMs &&
      item.attempts === 3 && Number.isInteger(item.successes) && item.successes >= 2 && item.successes <= 3 &&
      Number.isFinite(item.jitterMs) && item.jitterMs >= 0)
    .sort((a, b) => b.successes - a.successes || a.ms - b.ms || a.jitterMs - b.jitterMs);
  const seen = new Set();
  return ranked.filter(({ clean }) => !seen.has(clean) && seen.add(clean));
}

const escapeHtml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const tehranDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' });

export function renderMessage(results, now = new Date()) {
  if (!results.length) return { text: warning, count: 0 };
  const parts = Object.fromEntries(tehranDate.formatToParts(now).map(({ type, value }) => [type, value]));
  const day = Math.floor(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / 86400000);
  const poem = poems[((day % poems.length) + poems.length) % poems.length];
  const configs = [];
  for (const { clean } of results) {
    if (configs.length >= 5) break;
    const next = clean + '#' + encodeURIComponent(`${channel} ${configs.length + 1}`);
    const length = [poem, [...configs, next].join('\n'), footer].join('\n\n').length;
    if (length <= maxMessageLength) configs.push(next);
  }
  if (!configs.length) throw new Error('No eligible configuration fits in a Telegram message.');
  return {
    count: configs.length,
    parse_mode: 'HTML',
    text: `${escapeHtml(poem)}\n\n<blockquote expandable><code>${escapeHtml(configs.join('\n'))}</code></blockquote>\n\n${escapeHtml(footer)}`,
  };
}

export async function telegram(token, method, payload = {}, fetchImpl = fetch, wait = delay) {
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required.');
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      // Retry only errors that confirm the request could not be sent.
      if (attempt < 2 && ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT'].includes(err.cause?.code)) {
        await wait((attempt + 1) * 1000);
        continue;
      }
      throw new Error(`Telegram ${method} network failure; delivery could not be confirmed.`);
    }
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(`Telegram ${method} returned an invalid response (HTTP ${response.status}).`);
    }
    if (response.ok && result?.ok === true) return result.result;
    const retryAfter = result?.parameters?.retry_after;
    if (response.status === 429 && attempt < 2 && Number.isInteger(retryAfter) && retryAfter >= 0 && retryAfter <= 15) {
      await wait((retryAfter + 1) * 1000);
      continue;
    }
    throw new Error(`Telegram ${method} rejected the request (HTTP ${response.status}).`);
  }
}

async function main() {
  const [mode] = process.argv.slice(2);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (mode === '--discover') {
    const updates = await telegram(token, 'getUpdates', { allowed_updates: ['message', 'my_chat_member'] });
    const chats = new Map();
    for (const update of updates) {
      const chat = update.message?.chat ?? update.my_chat_member?.chat;
      if (chat && ['group', 'supergroup'].includes(chat.type)) chats.set(chat.id, chat.title);
    }
    for (const [id, title] of chats) console.log(`${title}: ${id}`);
    if (!chats.size) throw new Error('No group updates available; send /start in the group and retry.');
    return;
  }

  const exit = (await readFile('tester-exit.txt', 'utf8').catch(error => {
    if (mode !== '--check-results' && error.code === 'ENOENT') return '0';
    throw error;
  })).trim();
  if (!/^\d{1,3}$/.test(exit)) throw new Error('Tester exit status is missing or invalid.');
  const { tested, results } = readResults(await readFile('results.jsonl', 'utf8'), Number(exit));
  const ranked = selectResults(results);
  if (mode === '--check-results') {
    const summary = `Trojan candidates: ${tested} · Final tester results: ${results.length} · Eligible for publication: ${ranked.length}`;
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
    return;
  }
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) throw new Error('TELEGRAM_CHAT_ID is required.');
  const { count, ...message } = renderMessage(ranked);
  const sent = await telegram(token, 'sendMessage', { chat_id: chatId, ...message, link_preview_options: { is_disabled: true } });
  if (!Number.isSafeInteger(sent?.message_id)) throw new Error('Telegram did not confirm delivery.');
  console.log(count ? `Telegram accepted one message with ${count} verified Trojan configuration(s).` :
    'Telegram accepted one status message; no Trojan candidate passed.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
