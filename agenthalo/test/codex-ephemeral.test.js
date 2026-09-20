const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isCodexEphemeralCommandLine, runCodexHook } = require('../hooks/codex-hook');

test('ephemeral exec processes are headless but interactive tasks and prompt text are not', () => {
  for (const command of [
    '/Users/you/.codex/bin/codex exec --ephemeral --sandbox read-only -',
    '"C:\\Program Files\\Codex\\codex.exe" exec -C "C:\\My Work" --ephemeral -',
    'codex e --json --ephemeral -',
  ]) assert.equal(isCodexEphemeralCommandLine(command), true, command);
  for (const command of ['codex app-server', 'codex', 'codex exec -', 'codex exec "explain --ephemeral"', 'codex exec -- --ephemeral', 'codex exec --model --ephemeral -', 'other exec --ephemeral']) {
    assert.equal(isCodexEphemeralCommandLine(command), false, command);
  }
});

test('real hook resolver applies ephemeral classification even without a transcript', async () => {
  let sent;
  await runCodexHook({ hook_event_name: 'PreToolUse', session_id: 'ephemeral-regression', cwd: '/work', tool_name: 'shell' }, {
    createPidResolver(options) {
      return () => ({ agentPid: 123, stablePid: 123, headless: options.headlessCheck('codex exec --ephemeral -') });
    },
    postState: (body, options, callback) => { sent = JSON.parse(body); callback(true, 23333); },
  });
  assert.equal(sent.headless, true);
});
