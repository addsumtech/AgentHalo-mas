const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { checkWebBridgeInProcess } = require('../src/web-bridge-check-process');

test('completed and stalled checks both retire their isolated worker', async () => {
  for (const complete of [true, false]) {
    const child = new EventEmitter();
    let killed = 0;
    child.kill = () => { killed++; };
    const result = checkWebBridgeInProcess({ timeoutMs: 10, fork: () => child });
    if (complete) child.emit('message', { installations: [], unreadable: false, latestVersion: '0.3.2' });
    const report = await result;
    assert.equal(killed, 1);
    assert.equal(report.latestVersion, complete ? '0.3.2' : null);
    assert.equal(report.unreadable, !complete);
  }
});

test('a worker launch failure returns an unknown installation result', async () => {
  const report = await checkWebBridgeInProcess({ fork: () => { throw new Error('cannot launch'); } });
  assert.equal(report.unreadable, true);
});
