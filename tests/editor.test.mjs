import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import { convertWordHtml, createMarkdownConverter } from '../src/lib/editor-import.mjs';
import { serializeArticle, deserializeArticle, validateArticle, publishArticle, decodeContent, slugify } from '../src/lib/editor-core.mjs';
import { compileArticle, parseArticle } from '../src/lib/content.mjs';

const {window}=new JSDOM('');
const purify=createDOMPurify(window);
const options={document:window.document,sanitize:html=>purify.sanitize(html)};
const article=()=>({title:'Философия: «текст»',slug:'filosofiya',description:'Описание',author:'Автор',translator:'Переводчик',section:'translations',date:'2026-10-18',source:'',discussion:'',tags:['Тема'],body:'Введение.\n\nСлово {{note:first}}. Ещё {{note:first}}.',notes:[{id:'first',kind:'Примечание переводчика',text:'*Пояснение*.'}],bibliography:[]});

test('DOCX HTML separates footnotes and endnotes without losing formatting or repeated references',()=>{
  const imported=convertWordHtml('<p><strong>ФИЛОСОФИЯ</strong></p><p>Предисловие от переводчика:</p><p>А <em>слово</em><sup><a href="#footnote-1">[1]</a></sup> Б<sup><a href="#endnote-1">[2]</a></sup> В<sup><a href="#footnote-1">[1]</a></sup></p><ol><li id="footnote-1"><p>Первый абзац.</p><p><em>Второй</em>. — Прим. пер. <a href="#footnote-ref-1">↑</a></p></li><li id="endnote-1"><p>Концевая. <a href="#endnote-ref-1">↑</a></p></li></ol>',options);
  assert.equal(imported.title,'ФИЛОСОФИЯ');assert.equal(imported.notes.length,2);
  assert.match(imported.body,/## Предисловие/);assert.match(imported.body,/\*слово\*/);
  assert.equal(imported.notes[0].text,'Первый абзац.\n\n*Второй*. — Прим. пер.');
  assert.equal(imported.notes[0].kind,'Примечание переводчика');
  const compiled=compileArticle({...article(),...imported});
  assert.deepEqual(compiled.notes.map(n=>n.id),['footnote-1','endnote-1']);
  assert.equal(compiled.notes[0].refs.length,2);
  assert.doesNotMatch(imported.body,/↑|href|\[1\]/);
});
test('Note chips survive visual editor conversion',()=>{
  const md=createMarkdownConverter().turndown('<p>A <span contenteditable="false" data-note-id="note-1">⁎ note-1</span> B</p>');
  assert.equal(md,'A {{note:note-1}} B');
});
test('Import sanitizes hostile links and scripts; images have visible placeholders',()=>{
  const imported=convertWordHtml('<p>Текст<script>alert(1)</script><a href="javascript:alert(1)">ссылка</a><img src="https://example.org/img.png" onerror="alert(1)"></p>',options);
  assert.doesNotMatch(imported.body,/alert|javascript|onerror/);
  assert.match(imported.body,/Изображение из Word/);
});
test('Downloaded drafts round-trip punctuation, note metadata, Cyrillic and revision; publishing strips private editor metadata',()=>{
  const a={...article(),textAlign:'justify',_editor:{slug:'filosofiya',sha:'a'.repeat(40)}};
  const raw=serializeArticle(a);const loaded=deserializeArticle(raw);
  assert.equal(loaded.body,a.body);assert.equal(loaded.published,false);assert.deepEqual(loaded.notes,a.notes);assert.deepEqual(loaded._editor,a._editor);
  const publicRaw=serializeArticle(a,true);assert.doesNotMatch(publicRaw,/_editor/);
  const parsed=parseArticle(publicRaw,'filosofiya.md');assert.equal(parsed.published,true);assert.equal(compileArticle(parsed).notes.length,1);
  assert.equal(parsed.textAlign,'justify');assert.equal(loaded.textAlign,'justify');
  assert.equal(slugify('Философия на Сицилии'),'filosofiya-na-sitsilii');
});
test('Validation rejects missing/unused notes, invalid dates and reserved paths',()=>{
  const a=article();validateArticle(a);
  assert.throws(()=>validateArticle({...a,notes:[]}),/Не найдено примечание/);
  assert.throws(()=>validateArticle({...a,body:'Без ссылок'}),/нет ссылки/);
  assert.throws(()=>validateArticle({...a,date:'2026-02-30'}),/дату/);
  assert.throws(()=>validateArticle({...a,slug:'../escape'}),/адрес/);
  assert.throws(()=>validateArticle({...a,slug:'reading-example'}),/адрес/);
});
test('First publication sends UTF-8 content only to the fixed repository',async()=>{
  const calls=[];const fetcher=async(url,opts)=>{calls.push({url,opts});return calls.length===1?new Response('',{status:404}):Response.json({content:{sha:'new'}});};
  await publishArticle({article:article(),token:'test-token',fetcher});
  assert.equal(calls.length,2);assert.match(calls[1].url,/^https:\/\/api.github.com\/repos\/das-kefirt\/das-kefirt.github.io\/contents\/src\/content\/posts\/filosofiya.md$/);
  const payload=JSON.parse(calls[1].opts.body);assert.equal(payload.branch,'main');assert.equal(payload.sha,undefined);
  assert.equal(deserializeArticle(decodeContent(payload.content)).published,true);assert.equal(deserializeArticle(decodeContent(payload.content)).title,article().title);
  assert.doesNotMatch(calls[1].opts.body,/test-token/);
});
test('Existing files and concurrent edits are never overwritten without matching revision',async()=>{
  for(const expectedSha of [undefined,'stale']){
    let calls=0;const fetcher=async()=>{calls++;return Response.json({sha:'current'});};
    await assert.rejects(publishArticle({article:article(),token:'test-token',expectedSha,fetcher}),/адрес уже занят/);assert.equal(calls,1);
  }
  const calls=[];const fetcher=async(url,opts)=>{calls.push(opts);return calls.length===1?Response.json({sha:'current'}):Response.json({content:{sha:'new'}});};
  await publishArticle({article:article(),token:'test-token',expectedSha:'current',fetcher});assert.equal(JSON.parse(calls[1].body).sha,'current');
});
test('Authentication and concurrent-write errors are actionable',async()=>{
  await assert.rejects(publishArticle({article:article(),token:'',fetcher:()=>{throw new Error('must not call');}}),/ключ GitHub/);
  await assert.rejects(publishArticle({article:article(),token:'test-token',fetcher:async()=>new Response('',{status:401})}),/не принял ключ/);
  let calls=0;
  await assert.rejects(publishArticle({article:article(),token:'test-token',expectedSha:'current',fetcher:async()=>++calls===1?Response.json({sha:'current'}):new Response('',{status:409})}),/Файл изменился/);
});

test('Plain TOC heading appears in outline without typographic heading markup',()=>{
  const md=createMarkdownConverter().turndown('<p>Текст</p><h2 class="toc-plain">Сицилийская философия</h2><p>Продолжение.</p>');
  assert.match(md,/## Сицилийская философия <!--toc-plain-->/);
  const rendered=compileArticle({...article(),body:md,notes:[]});
  assert.equal(rendered.headings.length,1);
  assert.equal(rendered.headings[0].title,'Сицилийская философия');
  assert.match(rendered.html,/<h2 class="toc-plain" id="section-1">Сицилийская философия<\/h2>/);
  assert.doesNotMatch(rendered.html,/<!--toc-plain-->/);
});

test('Outline label may differ from the original heading and survives Markdown round trips',()=>{
  const label='От переводчика: название в навигации';
  const md=createMarkdownConverter().turndown(`<p>Текст</p><h2 data-toc-title="${label}">Предисловие от переводчика:</h2><p>Продолжение.</p>`);
  assert.match(md,/<!--toc-title:/);
  const compiled=compileArticle({...article(),body:md,notes:[]});
  assert.equal(compiled.headings[0].title,label);
  assert.equal(compiled.headings[0].originalTitle,'Предисловие от переводчика:');
  assert.match(compiled.html,/<h2 id="section-1">Предисловие от переводчика:<\/h2>/);
  assert.doesNotMatch(compiled.html,/toc-title|От переводчика: название/);
  const reimport=createMarkdownConverter().turndown(compiled.html.replace('id="section-1"',`data-toc-title="${label}"`));
  assert.equal(compileArticle({...article(),body:reimport,notes:[]}).headings[0].title,label);
});

test('Heading markers inside code blocks do not create outline items',()=>{
  const code='~~~md\n## Not a heading <!--toc-title:Wrong-->\n~~~\n\n## Visible <!--toc-title:Right-->';
  const compiled=compileArticle({...article(),body:code,notes:[]});
  assert.equal(compiled.headings.length,1);
  assert.equal(compiled.headings[0].title,'Right');
});
