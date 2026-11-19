import assert from 'node:assert/strict';
import test from 'node:test';
import { readResults, renderMessage, selectResults, telegram } from './bot.mjs';

const jsonl = (...events) => events.map(event => 'PSJSON:' + JSON.stringify(event)).join('\n');
const fetched = { type: 'fetched', count: 79 };
const noResults = { type: 'error', code: 'NO_RESULTS', message: 'no configs passed round 2' };
const success = (host, extra = {}) => ({
  type: 'result',
  uri: `trojan://dummy@${host}.example:443?security=tls&sni=target.example#name`,
  ms: 100,
  jitterMs: 5,
  successes: 3,
  attempts: 3,
  ...extra,
});

test('a completed test with zero passing proxies produces a status post even when the tester exits 1', () => {
  const result = readResults(jsonl(fetched, { type: 'progress', round: 2 }, noResults), 1);
  assert.equal(result.tested, 79);
  const message = renderMessage(selectResults(result.results));
  assert.equal(message.count, 0);
  assert.match(message.text, /هیچ کانفیگ Trojan/);
});

test('download failure, killed test, and half-written output do not become a zero-results post', () => {
  assert.throws(() => readResults(jsonl({ type: 'error', code: 'NETWORK_ERROR' }), 1), /NETWORK_ERROR/);
  assert.throws(() => readResults(jsonl(fetched, noResults), 124), /exit 124/);
  assert.throws(() => readResults(jsonl(fetched, success('one')), 0), /incomplete/);
  assert.throws(() => readResults(jsonl(fetched, { type: 'done', count: 1 }), 0), /inconsistent/);
  assert.throws(() => readResults(jsonl(fetched) + '\nPSJSON:{', 0), /invalid result/);
});

test('only reliable Trojan entries are ranked and credentials/transports are left intact', () => {
  const healthy = success('one', { ms: 110 });
  const records = [
    success('fast', { successes: 2, ms: 25 }),
    success('ss', { uri: 'ss://dummy@server.example' }),
    success('unreliable', { successes: 1 }),
    success('slow', { ms: 5001 }),
    success('invalid', { uri: 'trojan://not-a-valid-shared-link' }),
    { ...healthy, uri: healthy.uri.replace('#name', '#duplicate') },
    healthy,
  ];
  const { results } = readResults(jsonl(fetched, ...records, { type: 'done', count: records.length }), 0);
  const message = renderMessage(selectResults(results));
  assert.equal(message.count, 2);
  assert.equal((message.text.match(/<code>/g) ?? []).length, 1);
  assert.match(message.text, /^🌸 /);
  assert.match(message.text, /عضو کانال بشید و از سرعت لذت ببرید/);
  assert.match(message.text, /کانال ما: @pass_net/);
  assert.match(message.text, /one\.example:443\?security=tls&amp;sni=target\.example#%40pass_net%201\ntrojan:\/\/dummy@fast\.example/);
  assert.doesNotMatch(message.text, /unreliable|ss:\/\/|slow\.example/);
});

test('a long configuration does not prevent a shorter ranked result from being published', () => {
  const oversized = success('long', { uri: 'trojan://dummy@long.example:443?path=' + 'a'.repeat(4100), ms: 1 });
  const message = renderMessage(selectResults([oversized, success('fits')]));
  assert.equal(message.count, 1);
  assert.match(message.text, /fits\.example/);
});

test('poetry changes at midnight in Tehran', () => {
  const ranked = selectResults([success('one')]);
  const before = renderMessage(ranked, new Date('2026-11-19T20:29:59Z'), '');
  const after = renderMessage(ranked, new Date('2026-11-19T20:30:00Z'), '');
  assert.notEqual(before.text.split('\n\n')[0], after.text.split('\n\n')[0]);
});

test('each of 1000 consecutive workflow runs uses a different verse', () => {
  const ranked = selectResults([success('one')]);
  const verses = new Set(Array.from({ length: 1000 }, (_, index) =>
    renderMessage(ranked, new Date('2026-11-19T12:00:00Z'), String(index + 1)).text.split('\n\n')[0]));
  assert.equal(verses.size, 1000);
});

test('Telegram rate limits retry an explicitly rejected request', async () => {
  const waits = [];
  const responses = [
    new Response(JSON.stringify({ ok: false, parameters: { retry_after: 2 } }), { status: 429 }),
    new Response(JSON.stringify({ ok: true, result: { message_id: 123 } })),
  ];
  const result = await telegram('dummy', 'sendMessage', {}, async () => responses.shift(), async ms => waits.push(ms));
  assert.deepEqual(waits, [3000]);
  assert.equal(result.message_id, 123);
});

test('ambiguous Telegram transport failures neither leak the token nor retry the post', async () => {
  let calls = 0;
  await assert.rejects(telegram('dummy', 'sendMessage', {}, async () => {
    calls++;
    throw new Error('upstream error containing dummy');
  }), error => /delivery could not be confirmed/.test(error.message) && !error.message.includes('dummy'));
  assert.equal(calls, 1);
});
