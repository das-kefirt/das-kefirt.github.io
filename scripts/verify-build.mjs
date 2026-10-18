import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve('dist');
const htmlFiles = [];
function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, entry.name); if (entry.isDirectory()) walk(p); else if (p.endsWith('.html')) htmlFiles.push(p); } }
walk(root);
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  assert.match(html, /<html[^>]*lang="ru"/, file);
  assert.match(html, /<title>[^<]+<\/title>/, file);
  assert.match(html, /name="description"/, file);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, new Set(ids).size, `Duplicate IDs: ${file}`);
  for (const match of html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)) {
    const href = match[1];
    if (!href.startsWith('/') || href.startsWith('//')) continue;
    const target = href.split(/[?#]/)[0];
    const local = path.join(root, target);
    assert.ok(fs.existsSync(local) || fs.existsSync(path.join(local, 'index.html')), `Missing target ${href} in ${file}`);
  }
  for (const match of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(match[1]), `Missing anchor ${match[1]} in ${file}`);
}
const sample = fs.readFileSync(path.join(root, 'preview/index.html'), 'utf8');
assert.match(sample, /noindex,follow/);
assert.match(sample, /id="note-first"/);
assert.match(sample, /id="ref-first-2"/);
assert.doesNotMatch(fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8'), /preview|reading-example/);
assert.doesNotMatch(fs.readFileSync(path.join(root, 'rss.xml'), 'utf8'), /reading-example/);
const editor = fs.readFileSync(path.join(root, 'editor/index.html'), 'utf8');
assert.match(editor, /noindex,follow/);
assert.match(editor, /data-pagefind-ignore/);
assert.doesNotMatch(fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8'), /\/editor\//);
assert.match(editor, /id="import-file"/);
assert.match(editor, /id="confirm-publish"/);
assert.match(editor, /id="cover-file"/);
const storage=JSON.parse(fs.readFileSync(path.join(root,'storage.json'),'utf8'));
assert.ok(storage.siteBytes>0&&storage.siteBytes<=storage.limitBytes,'Site storage budget');
console.log(`Verified ${htmlFiles.length} HTML pages: links, assets, IDs, note references, sample exclusion.`);
