import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { compileArticle } from '../lib/render.mjs';
import { createMarkdownConverter, convertWordHtml } from '../lib/editor-import.mjs';
import { API, REPOSITORY, slugify, serializeArticle, deserializeArticle, validateArticle, publishArticle, decodeContent } from '../lib/editor-core.mjs';

const $ = id => document.getElementById(id);
const storageKey = 'das-kefirt-editor-draft-v1';
const markdown = new Marked({gfm:true});
const converter = createMarkdownConverter();
const fields = ['title','author','translator','section','date','description','slug','source','discussion','textAlign'];
const editor = $('body-editor');
const status = $('editor-status');
let savedRange = null;
let locked = false;
let pendingArticle = null;
let state = {article:blankArticle(), origin:null};

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function blankArticle() {
  return {title:'',slug:'',description:'',author:'',translator:'',section:'translations',date:today(),body:'',source:'',discussion:'',textAlign:'left',tags:[],notes:[],bibliography:[]};
}
function clean(html) {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS:['p','br','div','h1','h2','h3','h4','strong','b','em','i','u','s','del','blockquote','pre','code','ul','ol','li','a','hr','sup','sub','span','table','thead','tbody','tr','th','td','img'],
    ALLOWED_ATTR:['href','src','id','class','data-note','data-note-id','aria-label','role','alt','title'],
    ALLOW_DATA_ATTR:false,
  });
}
function say(message, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
  if (error) status.focus();
}
function errorMessage(e) { return e?.message || 'Не удалось выполнить действие. Черновик остаётся в редакторе.'; }
function readFields() {
  for (const key of fields) state.article[key] = $(`field-${key}`).value.trim();
  editor.dataset.textAlign = state.article.textAlign;
  state.article.tags = $('field-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  state.article.bibliography = $('field-bibliography').value.split(/\n\s*\n/).map(text => text.trim()).filter(Boolean).map(text => ({text}));
  return state.article;
}
function saveDraft() {
  readFields();
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
    $('draft-status').textContent = `Сохранено в этом браузере · ${new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;
  } catch {
    $('draft-status').textContent = 'Автосохранение недоступно — скачай черновик';
  }
}
function paintBody() {
  // Note links are non-editable chips in the editor; Markdown keeps stable IDs.
  const a = state.article;
  const missing = [...a.body.matchAll(/\{\{note:([a-z0-9_-]+)\}\}/g)].map(m => m[1]).filter(id => !a.notes.some(n => n.id === id));
  const rendered = compileArticle({...a, notes:[...a.notes,...missing.map(id => ({id,text:''}))]}, clean);
  editor.innerHTML = rendered.html;
  for (const link of [...editor.querySelectorAll('a.note-ref')]) {
    const span = document.createElement('span');
    span.className = 'editor-note'; span.dataset.noteId = link.dataset.note.replace(/^note-/,'');
    span.contentEditable = 'false'; span.textContent = `⁎ ${span.dataset.noteId}`;
    span.title = 'Примечание — редактируется под текстом';
    link.parentElement.tagName === 'SUP' ? link.parentElement.replaceWith(span) : link.replaceWith(span);
  }
  savedRange = null;
}
function fillForm() {
  for (const key of fields) $(`field-${key}`).value = state.article[key] || '';
  $('field-textAlign').value = state.article.textAlign || 'left';
  editor.dataset.textAlign = $('field-textAlign').value;
  $('field-slug').disabled = Boolean(state.origin);
  if (state.article.slug) $('field-slug').dataset.manual='true';
  else delete $('field-slug').dataset.manual;
  $('field-tags').value = state.article.tags.join(', ');
  $('field-bibliography').value = state.article.bibliography.map(n => typeof n === 'string' ? n : n.text).join('\n\n');
  paintBody(); paintNotes(); showTab(false);
}
function paintNotes() {
  const root = $('notes-editor'); root.replaceChildren();
  $('note-count').textContent = String(state.article.notes.length);
  for (const note of state.article.notes) {
    const row = document.createElement('div'); row.className = 'note-edit-row'; row.dataset.noteRow = note.id;
    const header = document.createElement('div'); header.className = 'note-edit-header';
    const id = document.createElement('span'); id.textContent = note.id;
    const kind = document.createElement('select'); kind.setAttribute('aria-label',`Вид примечания ${note.id}`);
    for (const text of ['Примечание автора','Примечание переводчика','Примечание редакции']) { const option = new Option(text,text); kind.add(option); }
    if (note.kind && ![...kind.options].some(o => o.value === note.kind)) kind.add(new Option(note.kind,note.kind));
    kind.value = note.kind || 'Примечание автора';
    kind.addEventListener('change',() => {note.kind=kind.value;saveDraft();});
    header.append(id,kind);
    const textarea = document.createElement('textarea'); textarea.rows=3; textarea.value=note.text; textarea.setAttribute('aria-label',`Текст примечания ${note.id}`);
    textarea.addEventListener('input',() => {note.text=textarea.value;saveDraft();});
    const actions = document.createElement('div'); actions.className='note-edit-actions';
    const insert = document.createElement('button'); insert.type='button'; insert.textContent='Вставить ссылку в текст';
    insert.addEventListener('click',() => insertNoteMarker(note.id));
    const remove = document.createElement('button'); remove.type='button'; remove.textContent='Удалить примечание';
    remove.addEventListener('click',() => {
      if (!confirm('Удалить примечание и все ссылки на него из этого черновика?')) return;
      state.article.notes=state.article.notes.filter(n=>n.id!==note.id);
      for (const chip of editor.querySelectorAll('[data-note-id]')) if(chip.dataset.noteId===note.id)chip.remove();
      updateBody();paintNotes();
    });
    actions.append(insert,remove); row.append(header,textarea,actions); root.append(row);
  }
}
function updateBody() {
  state.article.body = converter.turndown(clean(editor.innerHTML));
  saveDraft();
}
function rememberSelection() {
  const selection=window.getSelection();
  if(selection?.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) savedRange=selection.getRangeAt(0).cloneRange();
}
function restoreSelection() {
  editor.focus(); const selection=window.getSelection();
  if(savedRange && editor.contains(savedRange.commonAncestorContainer)){selection.removeAllRanges();selection.addRange(savedRange);}
  else {const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);selection.removeAllRanges();selection.addRange(range);}
}
function insertNoteMarker(id) {
  restoreSelection();
  const span=document.createElement('span');span.dataset.noteId=id;span.className='editor-note';span.contentEditable='false';span.textContent=`⁎ ${id}`;
  document.execCommand('insertHTML',false,span.outerHTML+' ');
  rememberSelection();updateBody();
}
function showTab(preview) {
  document.dispatchEvent(new Event('kefirt:content-change'));
  if(preview) {
    try { renderPreview(); } catch(e) {say(errorMessage(e),true);return;}
  }
  $('edit-panel').hidden=preview;$('preview-panel').hidden=!preview;
  for(const [id,active] of [['edit-tab',!preview],['preview-tab',preview]]){$(id).setAttribute('aria-selected',String(active));$(id).tabIndex=active?0:-1;}
}
function renderPreview() {
  const a=readFields(), rendered=compileArticle(a,clean), root=$('article-preview');root.replaceChildren();
  const h=document.createElement('h1');h.textContent=a.title||'Без названия';
  const deck=document.createElement('p');deck.className='preview-description';deck.textContent=a.description;
  const byline=document.createElement('p');byline.className='preview-byline';byline.textContent=[a.author,a.translator&&`Перевод: ${a.translator}`,a.date,`${rendered.minutes} мин чтения`].filter(Boolean).join(' · ');
  const body=document.createElement('div');body.className='prose';body.dataset.textAlign=a.textAlign;body.innerHTML=rendered.html;
  // Preview IDs are scoped so copied article anchors cannot target the editor UI.
  for(const node of body.querySelectorAll('[id]'))node.id=`preview-${node.id}`;
  for(const node of body.querySelectorAll('[data-note]'))node.dataset.note=`preview-${node.dataset.note}`;
  for(const node of body.querySelectorAll('a[href^="#"]'))node.setAttribute('href',`#preview-${node.getAttribute('href').slice(1)}`);
  root.append(h,deck,byline,body);
  if(a.source){const source=document.createElement('section');source.className='source-block';const heading=document.createElement('h2');heading.className='eyebrow';heading.textContent='Источник / сведения о тексте';const text=document.createElement('p');text.textContent=a.source;source.append(heading,text);root.append(source);}
  if(rendered.notes.length){const section=document.createElement('section');section.className='notes-section';const heading=document.createElement('h2');heading.textContent='Примечания';const ol=document.createElement('ol');
    for(const note of rendered.notes){const li=document.createElement('li');li.id=`preview-note-${note.id}`;const label=document.createElement('span');label.className='note-kind';label.textContent=note.kind||'Примечание';const content=document.createElement('div');content.className='note-content';content.innerHTML=note.html;li.append(label,content);for(const ref of note.refs){const a=document.createElement('a');a.href=`#preview-${ref}`;a.textContent='↩ К тексту';li.append(a);}ol.append(li);}section.append(heading,ol);root.append(section);}
  if(rendered.bibliography.length){const section=document.createElement('section');section.className='bibliography';const heading=document.createElement('h2');heading.textContent='Литература';const ol=document.createElement('ol');for(const html of rendered.bibliography){const li=document.createElement('li');li.innerHTML=html;ol.append(li);}section.append(heading,ol);root.append(section);}
}
function download(published) {
  const a=readFields();
  if(published)validateArticle(a);
  const blob=new Blob([serializeArticle({...a,_editor:state.origin},published)],{type:'text/markdown;charset=utf-8'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${a.slug||'chernovik'}.md`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  if(published)say('Файл для публикации скачан. Загрузите его в папку src/content/posts на GitHub и подтвердите Commit changes.');
}
function mayReplace() {
  readFields();
  return (!state.article.body && !state.article.title) || confirm('Заменить текущий черновик? Если он ещё нужен, нажми «Отмена» и сначала скачай его.');
}
async function importFile(file) {
  if(locked || !file || !mayReplace())return;
  if(file.size>10*1024*1024)throw new Error('Файл больше 10 МБ. Удали тяжёлые изображения или раздели документ перед импортом.');
  locked=true;say('Читаю файл…');
  try {
    if(/\.md$/i.test(file.name)) {
      const article=deserializeArticle(await file.text(),file.name);
      const origin=article._editor && article._editor.slug===article.slug && /^[0-9a-f]{40}$/.test(article._editor.sha) ? article._editor : null;
      delete article._editor;
      state={article,origin};fillForm();saveDraft();say(origin ? 'Черновик открыт. При публикации проверим, не изменилась ли исходная статья.' : 'Черновик открыт. Для обновления уже опубликованного текста используй «Открыть с сайта»: это защитит изменения от перезаписи.');
    } else if(/\.docx$/i.test(file.name)) {
      const result=await readWord(await file.arrayBuffer());
      const imported=convertWordHtml(result.html,{document,sanitize:clean});
      // Images are deliberately not silently uploaded to a public repository.
      if(result.imageCount)imported.warnings.push(`Изображения (${result.imageCount}) не импортированы. Добавь их отдельно перед публикацией.`);
      const messages=result.messages.map(m=>m.message);
      state={article:{...blankArticle(),title:imported.title,slug:imported.slug,body:imported.body,notes:imported.notes},origin:null};
      fillForm();saveDraft();
      say([`Word загружен. Примечаний: ${imported.notes.length}. Проверь название, автора, раздел и предпросмотр.`,...imported.warnings,...messages.map(m=>`Word: ${m}`)].join('\n'));
    } else throw new Error('Поддерживаются файлы .docx и черновики .md.');
  } finally {locked=false;$('import-file').value='';}
}
function readWord(arrayBuffer) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('../lib/docx.worker.js',import.meta.url),{type:'module'});
    const timer=setTimeout(()=>{worker.terminate();reject(new Error('Импорт занял слишком много времени. Попробуй упростить или разделить Word-файл.'));},45000);
    const finish=()=>{clearTimeout(timer);worker.terminate();};
    worker.onmessage=({data})=>{finish();data.error?reject(new Error(data.error)):resolve(data);};
    worker.onerror=()=>{finish();reject(new Error('Не удалось запустить импорт Word. Скачай черновик, обнови страницу и попробуй снова.'));};
    worker.postMessage(arrayBuffer,[arrayBuffer]);
  });
}
async function openArticles() {
  if(locked)return;
  const panel=$('remote-panel'),list=$('remote-list');panel.open=true;list.textContent='Загрузка списка…';
  try {
    const response=await fetch(`${API}/contents/src/content/posts?ref=main`,{cache:'no-store',headers:{Accept:'application/vnd.github+json'}});
    if(!response.ok)throw new Error(`Не удалось получить список: GitHub ${response.status}. Попробуй позже.`);
    const entries=await response.json();list.replaceChildren();
    const files=entries.filter(f=>f.type==='file'&&/^[a-z0-9][a-z0-9-]*\.md$/.test(f.name)&&f.name!=='reading-example.md');
    if(!files.length)list.textContent='Публикаций пока нет. Загрузи Word или начни новый текст.';
    for(const file of files){const button=document.createElement('button');button.type='button';button.className='remote-item';button.textContent=file.name;button.addEventListener('click',()=>loadRemote(file.name).catch(e=>say(errorMessage(e),true)));list.append(button);}
  }catch(e){list.textContent=errorMessage(e);}
}
async function loadRemote(filename) {
  if(locked||!mayReplace())return;
  locked=true;say('Открываю публикацию…');
  try {
    const response=await fetch(`${API}/contents/src/content/posts/${filename}?ref=main`,{cache:'no-store',headers:{Accept:'application/vnd.github+json'}});
    if(!response.ok)throw new Error(`GitHub не отдал файл (${response.status}).`);
    const file=await response.json();if(file.encoding!=='base64')throw new Error('Файл слишком большой для редактора. Скачай его через GitHub.');
    const article=deserializeArticle(decodeContent(file.content),filename);article.slug=filename.replace(/\.md$/,'');
    state={article,origin:{slug:article.slug,sha:file.sha}};fillForm();saveDraft();$('remote-panel').open=false;
    say('Публикация открыта. Изменения появятся на сайте только после повторного нажатия «Опубликовать».');
  }finally{locked=false;}
}
function reviewPublish() {
  if(locked)return;
  const article=readFields();validateArticle(article);
  if(!$('github-token').value.trim()){$('github-connection').open=true;say('Для отправки вставь ключ GitHub ниже. Можно также скачать файл и опубликовать без ключа.');$('github-token').focus();return;}
  renderPreview();showTab(true);
  pendingArticle=structuredClone(article);
  $('publish-summary').textContent=`${article.title} · ${article.author}${article.translator?` · Перевод: ${article.translator}`:''} · Примечаний: ${article.notes.length}`;
  $('publish-address').textContent=`https://das-kefirt.github.io/read/${article.slug}/`;
  $('publish-dialog').showModal();
}
async function sendPublication() {
  if(locked||!pendingArticle)return;
  locked=true;$('confirm-publish').disabled=true;$('cancel-publish').disabled=true;
  say('Отправляю публикацию на GitHub…');
  const article=pendingArticle;
  try {
    const result=await publishArticle({article,token:$('github-token').value,expectedSha:state.origin?.slug===article.slug?state.origin.sha:undefined});
    state.origin={slug:article.slug,sha:result.content.sha};state.article.published=true;$('field-slug').disabled=true;saveDraft();
    $('publish-dialog').close();
    say('Файл сохранён в GitHub. Сайт обновится после успешной сборки. ');
    const link=document.createElement('a');link.href=`https://github.com/${REPOSITORY}/actions`;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Проверить сборку ↗';status.append(link);
    const page=document.createElement('a');page.href=`/read/${article.slug}/`;page.target='_blank';page.rel='noopener noreferrer';page.textContent='Открыть статью после сборки ↗';status.append(document.createElement('br'),page);
  }catch(e){$('publish-dialog').close();say(errorMessage(e),true);}
  finally{locked=false;pendingArticle=null;$('confirm-publish').disabled=false;$('cancel-publish').disabled=false;}
}

// No credentials enter draft state, storage, downloads or error messages.
try {const raw=localStorage.getItem(storageKey);if(raw){const restored=JSON.parse(raw);if(restored?.article){const article=deserializeArticle(serializeArticle(restored.article));state={article,origin:restored.origin||null};}}}catch{say('Сохранённый черновик не удалось восстановить. Можно открыть скачанный файл.',true);}
fillForm();
document.addEventListener('selectionchange',rememberSelection);
editor.addEventListener('input',updateBody);
editor.addEventListener('click',event=>{
  const chip=event.target.closest('[data-note-id]');if(!chip)return;
  const row=[...$('notes-editor').children].find(n=>n.dataset.noteRow===chip.dataset.noteId);
  if(row){row.closest('details').open=true;row.querySelector('textarea').focus();}
});
editor.addEventListener('paste',event=>{
  event.preventDefault();
  // HTML from external applications is flattened to plain text; Word files retain formatting through import.
  const text=event.clipboardData.getData('text/plain');document.execCommand('insertText',false,text);updateBody();
});
editor.addEventListener('drop',event=>event.preventDefault());
for(const key of [...fields,'tags','bibliography'])$(`field-${key}`).addEventListener('input',()=>{
  if(key==='title'&&!state.origin&&!$('field-slug').dataset.manual)$('field-slug').value=slugify($('field-title').value);
  if(key==='slug')$('field-slug').dataset.manual='true';
  saveDraft();
});
for(const button of document.querySelectorAll('[data-command],[data-block]')){
  button.addEventListener('mousedown',event=>event.preventDefault());
  button.addEventListener('click',()=>{restoreSelection();document.execCommand(button.dataset.block?'formatBlock':button.dataset.command,false,button.dataset.block||null);rememberSelection();updateBody();});
}
$('insert-link').addEventListener('click',()=>{
  const url=prompt('Адрес ссылки (https://…)');if(!url)return;
  if(!/^https?:\/\//i.test(url.trim())){say('Ссылка должна начинаться с https:// или http://.',true);return;}
  restoreSelection();
  if(window.getSelection().isCollapsed){const a=document.createElement('a');a.href=url.trim();a.textContent=url.trim();document.execCommand('insertHTML',false,a.outerHTML);}else document.execCommand('createLink',false,url.trim());
  updateBody();
});
$('insert-note').addEventListener('click',()=>{
  let i=1;while(state.article.notes.some(n=>n.id===`note-${i}`))i++;
  const id=`note-${i}`;state.article.notes.push({id,kind:state.article.section==='translations'?'Примечание переводчика':'Примечание автора',text:''});
  insertNoteMarker(id);paintNotes();const root=$('notes-editor');root.closest('details').open=true;root.lastElementChild.querySelector('textarea').focus();
});
$('edit-tab').addEventListener('click',()=>showTab(false));$('preview-tab').addEventListener('click',()=>showTab(true));
for(const id of ['edit-tab','preview-tab'])$(id).addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const preview=id==='edit-tab';showTab(preview);$(preview?'preview-tab':'edit-tab').focus();}});
$('import-file').addEventListener('change',e=>importFile(e.target.files[0]).catch(err=>say(errorMessage(err),true)));
$('new-article').addEventListener('click',()=>{if(locked||!mayReplace())return;state={article:blankArticle(),origin:null};delete $('field-slug').dataset.manual;fillForm();saveDraft();say('Новый черновик.');$('field-title').focus();});
$('download-draft').addEventListener('click',()=>{try{download(false);}catch(e){say(errorMessage(e),true);}});
$('download-publication').addEventListener('click',()=>{try{download(true);}catch(e){say(errorMessage(e),true);}});
$('open-articles').addEventListener('click',openArticles);
$('publish').addEventListener('click',()=>{try{reviewPublish();}catch(e){say(errorMessage(e),true);}});
$('confirm-publish').addEventListener('click',sendPublication);
$('cancel-publish').addEventListener('click',()=>{$('publish-dialog').close();pendingArticle=null;});
$('publish-dialog').addEventListener('cancel',e=>{if(locked)e.preventDefault();else pendingArticle=null;});
$('forget-token').addEventListener('click',()=>{$('github-token').value='';say('Ключ убран из вкладки.');});
window.addEventListener('beforeunload',event=>{if(locked){event.preventDefault();event.returnValue='';}});
