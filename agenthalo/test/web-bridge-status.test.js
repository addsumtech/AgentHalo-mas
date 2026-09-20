const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { detectInstallations, checkWebBridgeStatus } = require('../src/web-bridge-status');

test('registered profiles distinguish installed, disabled, missing and unrelated extensions', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-status-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'Default'));
  const extension = path.join(root, 'download/agenthalo-web-bridge/extension');
  await fs.mkdir(extension, { recursive: true });
  await fs.writeFile(path.join(extension, 'manifest.json'), JSON.stringify({ name: 'AgentHalo Web Bridge', version: '0.3.2' }));
  await fs.writeFile(path.join(root, 'Default', 'Secure Preferences'), JSON.stringify({ extensions: { settings: {
    current: { path: extension },
    disabled: { state: 0, manifest: { name: 'AgentHalo Web Bridge', version: '0.3.1' } },
    old: { path: path.join(root, 'old/clawd-web-bridge/extension') },
    unrelated: { manifest: { name: 'Other', version: '1.0.0' } },
  } } }));
  const result = await detectInstallations({ roots: [['Chrome', root]] });
  assert.deepEqual(result.installations.map(({ status, version }) => [status, version]), [['installed', '0.3.2'], ['disabled', '0.3.1'], ['missing-files', null]]);
  assert.equal(result.unreadable, false);
  assert.equal(JSON.stringify(result).includes(root), false);
});

test('public release comparison is numeric and ignores draft, prerelease and unrelated assets', async () => {
  const release = (version, extra = {}) => ({ tag_name: `web-bridge-v${version}`, assets: [{ name: 'AgentHalo-Web-Bridge.zip' }], ...extra });
  const report = await checkWebBridgeStatus({ roots: [], fetchImpl: async () => ({ ok: true, json: async () => [release('0.3.9'), release('0.3.10'), release('9.0.0', { draft: true }), release('8.0.0', { prerelease: true }), release('7.0.0', { assets: [] })] }) });
  assert.equal(report.latestVersion, '0.3.10');
});

test('offline and unreadable profiles report uncertainty without losing local results', async () => {
  const report = await checkWebBridgeStatus({ roots: [['Chrome', '/unreadable']], fileSystem: { readdir: async () => { throw Object.assign(new Error(), { code: 'EACCES' }); } }, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(report.unreadable, true);
  assert.equal(report.latestVersion, null);
});

test('a stalled response body cannot leave installation checking pending forever', async () => {
  const report = await checkWebBridgeStatus({ roots: [], timeoutMs: 10, fetchImpl: async () => ({ ok: true, json: () => new Promise(() => {}) }) });
  assert.equal(report.latestVersion, null);
  assert.deepEqual(report.installations, []);
});

test('blocked browser file access returns unknown rather than hanging or claiming absence', async () => {
  const report = await detectInstallations({ roots: [['Chrome', '/browser']], readTimeoutMs: 10, fileSystem: {
    readdir: async () => ['Default'],
    readFile: async (name) => name.endsWith('Preferences') ? JSON.stringify({ extensions: { settings: { bridge: { path: '/Desktop/agenthalo-web-bridge/extension' } } } }) : new Promise(() => {}),
  } });
  assert.equal(report.installations[0].status, 'unreadable');
  assert.equal(report.unreadable, true);
});
