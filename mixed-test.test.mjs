import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMixed } from './mixed-test.mjs';
import { renderMessage } from './bot.mjs';

const result = (uri, ms = 100, successes = 3) => ({ uri, ms, successes, attempts: 3, jitterMs: 1 });
test('chooses up to three Trojan and two distinct reliable Shadowsocks links', () => {
  const ts = [1, 2, 3, 4].map(n => result(`trojan://secret@t${n}.example:443#old`, n));
  const ss = [result('ss://YWVzLTEyOC1nY206cA@a.example:443#old', 10),
    result('ss://YWVzLTEyOC1nY206cA@a.example:443#duplicate', 9),
    result('ss://YWVzLTEyOC1nY206cA@b.example:443', 20),
    result('ss://YWVzLTEyOC1nY206cA@c.example:443', 1, 1)];
  const chosen = selectMixed(ts, ss);
  assert.equal(chosen.length, 5);
  assert.equal(chosen.filter(x => x.clean.startsWith('trojan://')).length, 3);
  assert.equal(chosen.filter(x => x.clean.startsWith('ss://')).length, 2);
  const message = renderMessage(chosen, new Date(), '1');
  assert.equal(message.count, 5);
  assert.equal((message.text.match(/<code>/g) || []).length, 1);
  assert.match(message.text, /ss:\/\//);
  assert.doesNotMatch(message.text, /c\.example/);
});
test('never fills missing slots with untested or unreliable links', () => {
  assert.equal(selectMixed([], [result('ss://bad', 50, 1)]).length, 0);
  assert.equal(selectMixed([result('trojan://p@t.example:443')], []).length, 1);
});
