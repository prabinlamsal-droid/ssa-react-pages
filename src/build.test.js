import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('Vite produces one self-contained HTML application', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');

  assert.match(html, /<script\b[^>]*>[\s\S]+?<\/script>/);
  assert.match(html, /<style\b[^>]*>[\s\S]+?<\/style>/);
  assert.doesNotMatch(html, /<(?:script|link)\b[^>]*(?:src|href)=["'][^"']+["']/i);
});
