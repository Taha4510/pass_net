import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readResults, selectResults, renderMessage, telegram } from './bot.mjs';

// Only results from completed tests are considered. Keep the original share
// links unchanged except for the display name added by renderMessage.
export function selectMixed(trojan, shadowsocks) {
  const rankedTrojan = selectResults(trojan).slice(0, 3);
  const seen = new Set();
  const rankedSS = shadowsocks
    .filter(x => typeof x.uri === 'string' && /^ss:\/\//i.test(x.uri))
    .map(x => ({ ...x, clean: x.uri.split('#', 1)[0] }))
    .filter(x => !/[\x00-\x20\x7f]/.test(x.clean) && x.clean.length > 8 &&
      Number.isFinite(x.ms) && x.ms >= 0 && x.ms <= 5000 && x.attempts === 3 &&
      Number.isInteger(x.successes) && x.successes >= 2 && x.successes <= 3 &&
      Number.isFinite(x.jitterMs) && x.jitterMs >= 0)
    .sort((a, b) => b.successes - a.successes || a.ms - b.ms || a.jitterMs - b.jitterMs)
    .filter(x => !seen.has(x.clean) && seen.add(x.clean)).slice(0, 2);
  return [...rankedTrojan, ...rankedSS];
}

async function main() {
  const load = async name => {
    const [body, status] = await Promise.all([readFile(`${name}.jsonl`, 'utf8'), readFile(`${name}.exit`, 'utf8')]);
    if (!/^\d{1,3}\s*$/.test(status)) throw new Error(`Invalid ${name} tester exit status`);
    return readResults(body, Number(status.trim()));
  };
  const [trojan, ss] = await Promise.all([load('trojan'), load('ss')]);
  const selected = selectMixed(trojan.results, ss.results);
  const trojanCount = selected.filter(x => /^trojan:/i.test(x.clean)).length;
  const ssCount = selected.length - trojanCount;
  console.log(`Tested: Trojan ${trojan.tested}; Shadowsocks ${ss.tested}. Selected: Trojan ${trojanCount}; Shadowsocks ${ssCount}.`);
  if (!selected.length) throw new Error('No tested configuration passed; no message was sent.');
  const chat = await telegram(process.env.TELEGRAM_BOT_TOKEN, 'getChat', { chat_id: process.env.TELEGRAM_CHAT_ID });
  if (!['group', 'supergroup'].includes(chat?.type)) throw new Error('Test destination is not a group; no message was sent.');
  const { count, ...message } = renderMessage(selected, new Date(), process.env.GITHUB_RUN_NUMBER);
  const sent = await telegram(process.env.TELEGRAM_BOT_TOKEN, 'sendMessage', {
    chat_id: process.env.TELEGRAM_CHAT_ID, ...message, link_preview_options: { is_disabled: true },
  });
  if (!Number.isSafeInteger(sent?.message_id)) throw new Error('Telegram did not confirm delivery.');
  console.log(`Telegram accepted one test-group message with ${count} configurations.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
