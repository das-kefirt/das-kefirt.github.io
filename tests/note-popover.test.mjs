import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {attachNotePopover} from '../src/lib/note-popover.mjs';

function setup() {
  const markup=fs.readFileSync(new URL('../src/components/NotePopover.astro',import.meta.url),'utf8').split('<script>')[0];
  const {window}=new JSDOM(`<button id="outside">Вне окна</button><a class="note-ref" data-note="note-a" href="#note-a">1</a><a class="note-ref" data-note="note-b" href="#note-b">2</a><ol><li id="note-a"><span class="note-kind">Примечание переводчика</span><div class="note-content"><p>Текст <em>сноски</em>. <a href="https://example.org">Источник</a></p></div></li><li id="note-b"><span class="note-kind">Примечание автора</span><div class="note-content">Вторая сноска</div></li></ol>${markup}`,{url:'https://das-kefirt.github.io/preview/'});
  const doc=window.document,popup=doc.getElementById('note-popover'),ref=doc.querySelector('.note-ref');
  const cleanup=attachNotePopover(doc,popup);
  return {window,doc,popup,ref,cleanup:()=>{cleanup();window.close();}};
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('Hover previews a note, allows moving into its window, then closes after leaving',async()=>{
  const {window,doc,popup,ref,cleanup}=setup();
  try {
    ref.dispatchEvent(new window.MouseEvent('pointerover',{bubbles:true}));await wait(170);
    assert.equal(popup.hidden,false);assert.equal(popup.dataset.pinned,'false');
    assert.match(popup.querySelector('[data-note-content]').innerHTML,/<em>сноски<\/em>/);
    assert.equal(popup.querySelector('[data-note-content] a').href,'https://example.org/');
    ref.dispatchEvent(new window.MouseEvent('pointerout',{bubbles:true,relatedTarget:doc.body}));
    popup.dispatchEvent(new window.MouseEvent('pointerenter'));await wait(250);assert.equal(popup.hidden,false);
    popup.dispatchEvent(new window.MouseEvent('pointerleave',{relatedTarget:doc.body}));await wait(250);assert.equal(popup.hidden,true);
  }finally{cleanup();}
});
test('Click/tap pins without following the anchor; Escape restores focus and outside tap closes',()=>{
  const {window,doc,popup,ref,cleanup}=setup();
  try {
    const click=new window.MouseEvent('click',{bubbles:true,cancelable:true,detail:1});ref.dispatchEvent(click);
    assert.equal(click.defaultPrevented,true);assert.equal(popup.hidden,false);assert.equal(popup.dataset.pinned,'true');assert.equal(ref.getAttribute('aria-expanded'),'true');
    doc.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.equal(popup.hidden,true);assert.equal(doc.activeElement,ref);assert.equal(ref.getAttribute('aria-expanded'),'false');
    ref.dispatchEvent(new window.MouseEvent('click',{bubbles:true,detail:1}));
    doc.getElementById('outside').dispatchEvent(new window.MouseEvent('pointerdown',{bubbles:true}));assert.equal(popup.hidden,true);
    assert.equal(ref.getAttribute('href'),'#note-a');
  }finally{cleanup();}
});
test('Keyboard activation enters the popup; another reference replaces its content; preview updates close it',()=>{
  const {window,doc,popup,ref,cleanup}=setup();
  try {
    ref.focus();assert.equal(popup.hidden,false);
    ref.dispatchEvent(new window.MouseEvent('click',{bubbles:true,detail:0}));assert.equal(doc.activeElement,popup.querySelector('[data-note-close]'));
    doc.querySelectorAll('.note-ref')[1].dispatchEvent(new window.MouseEvent('click',{bubbles:true,detail:1}));
    assert.match(popup.textContent,/Вторая сноска/);assert.equal(popup.querySelector('[data-note-full]').getAttribute('href'),'#note-b');
    doc.dispatchEvent(new window.Event('kefirt:content-change'));assert.equal(popup.hidden,true);
  }finally{cleanup();}
});
test('Touch hover does not open the window; narrow screens use a bottom position',async()=>{
  const {window,popup,ref,cleanup}=setup();
  try {
    const event=new window.MouseEvent('pointerover',{bubbles:true});Object.defineProperty(event,'pointerType',{value:'touch'});ref.dispatchEvent(event);await wait(170);assert.equal(popup.hidden,true);
    window.innerWidth=390;ref.dispatchEvent(new window.MouseEvent('click',{bubbles:true,detail:1}));assert.equal(popup.style.bottom,'12px');assert.equal(popup.style.left,'12px');
  }finally{cleanup();}
});
