import test from 'node:test';
import assert from 'node:assert/strict';
import { compileArticle, parseArticle, renderMarkdown } from '../src/lib/content.mjs';

test('Separate notes are numbered by first appearance, repeated references have unique anchors', () => {
  const result = compileArticle({ slug: 'test', body: 'A {{note:second}} B {{note:first}} C {{note:second}}', notes: [{ id: 'first', text: 'First' }, { id: 'second', text: 'Second' }], bibliography: [] });
  assert.deepEqual(result.notes.map(n => n.id), ['second', 'first']);
  assert.equal(result.notes[0].number, 1);
  assert.deepEqual(result.notes[0].refs, ['ref-second-1', 'ref-second-2']);
  assert.match(result.html, /href="#note-second"/);
  assert.match(result.html, /id="ref-second-2"/);
});
test('Dangling note references fail the build instead of publishing broken citations', () => {
  assert.throws(() => compileArticle({ slug: 'test', body: '{{note:missing}}', notes: [], bibliography: [] }), /не найдено/);
});
test('Raw HTML and links cannot execute scripts', () => {
  const html = renderMarkdown('<script>alert(1)</script><img src=x onerror="alert(1)">\n\n[bad](javascript:alert%281%29)');
  assert.doesNotMatch(html, /<script|onerror|href="javascript:/);
});
test('Draft is unpublished by default; duplicate note IDs are rejected', () => {
  assert.equal(parseArticle('---\ntitle: Draft\n---\nText', 'draft.md').published, false);
  assert.throws(() => parseArticle('---\nnotes:\n  - id: a\n    text: one\n  - id: a\n    text: two\n---\n', 'draft.md'), /повторный/);
});
