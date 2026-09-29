import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('Vite produces one self-contained HTML application', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');

  assert.match(html, /<script\b[^>]*>[\s\S]+?<\/script>/);
  assert.match(html, /<style\b[^>]*>[\s\S]+?<\/style>/);
  assert.doesNotMatch(html, /<(?:script|link)\b[^>]*(?:src|href)=["'][^"']+["']/i);
});

test('production CSP permits only exact bundled scripts/styles and forbids web networking', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const meta = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
  assert.ok(meta, 'production HTML must have a CSP');
  const directives = new Map(meta[1].split(';').filter(Boolean).map(rule => {
    const [name, ...values] = rule.trim().split(/\s+/);
    return [name, values];
  }));
  for (const name of ['default-src', 'connect-src', 'frame-src', 'worker-src', 'object-src', 'form-action', 'base-uri']) {
    assert.deepEqual(directives.get(name), ["'none'"]);
  }
  for (const [tag, directive] of [['script', 'script-src'], ['style', 'style-src']]) {
    const blocks = [...html.matchAll(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'gi'))];
    assert.ok(blocks.length > 0);
    const expected = [...new Set(blocks.map(match => "'sha256-" + createHash('sha256').update(match[1]).digest('base64') + "'"))];
    assert.deepEqual(directives.get(directive), expected);
    assert.ok(meta.index < blocks[0].index, 'policy must precede resource/executable content');
  }
  assert.deepEqual(directives.get('img-src'), ['data:']);
  assert.doesNotMatch(meta[1], /unsafe-inline|unsafe-eval|https?:/);
});
