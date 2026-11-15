'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

test('manifest is MV3 and declares the required entry points', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.service_worker, 'background/service-worker.js');
  assert.equal(manifest.action.default_popup, 'popup/popup.html');
  assert.equal(manifest.options_ui.page, 'options/options.html');
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.host_permissions.some((item) => item.includes('api.bilibili.com')));
  assert.ok(manifest.host_permissions.some((item) => item.includes('hdslb.com')));
  assert.ok(manifest.optional_host_permissions.includes('https://*/*'));
});

test('all manifest-referenced files exist', () => {
  const files = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
  ];
  for (const script of manifest.content_scripts) {
    for (const file of script.js || []) files.push(file);
    for (const file of script.css || []) files.push(file);
  }
  for (const resource of manifest.web_accessible_resources) {
    for (const file of resource.resources) files.push(file);
  }
  for (const file of files) {
    assert.ok(exists(file), `missing ${file}`);
  }
});

test('options and popup only load local scripts', () => {
  for (const page of ['options/options.html', 'popup/popup.html']) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    const sources = Array.from(html.matchAll(/<script[^>]+src="([^"]+)"/g)).map((match) => match[1]);
    assert.ok(sources.length > 0, `${page} has no scripts`);
    for (const source of sources) {
      assert.ok(!/^https?:/i.test(source), `${page} loads remote script ${source}`);
      const resolved = path.resolve(root, path.dirname(page), source);
      assert.ok(
        resolved === root || resolved.startsWith(root + path.sep),
        `${page} script escapes the extension: ${source}`,
      );
    }
    assert.doesNotMatch(html, /\son(click|load|error)=/i);
  }
});

test('manifest does not use remote code or unsafe CSP relaxation', () => {
  assert.equal(manifest.content_security_policy, undefined);
  const worker = fs.readFileSync(path.join(root, manifest.background.service_worker), 'utf8');
  assert.doesNotMatch(worker, /\beval\s*\(/);
  assert.doesNotMatch(worker, /new\s+Function\s*\(/);
});
