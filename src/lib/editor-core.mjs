import { load, JSON_SCHEMA } from 'js-yaml';
import { validateCover, validateCoverAsset, digestHex } from './cover.mjs';

export const REPOSITORY = 'das-kefirt/das-kefirt.github.io';
export const API = `https://api.github.com/repos/${REPOSITORY}`;
export const postPath = slug => `src/content/posts/${slug}.md`;
export function slugify(value) {
  const alphabet = {а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'};
  return [...value.toLowerCase()].map(c => alphabet[c] ?? c).join('').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0,100).replace(/-$/, '');
}
export function validateArticle(a) {
  validateCover(a.cover);
  if (a.textAlign && !['left','center','right','justify'].includes(a.textAlign)) throw new Error('Выбери выравнивание текста.');
  for (const [key,label] of [['title','название'],['author','автора'],['description','краткое описание'],['body','текст']]) {
    if (typeof a[key] !== 'string' || !a[key].trim()) throw new Error(`Укажи ${label}.`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(a.slug) || a.slug === 'reading-example') throw new Error('Укажи адрес из латинских букв, цифр и дефисов.');
  if (!['translations','essays','columns'].includes(a.section)) throw new Error('Выбери раздел.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date) || !Number.isFinite(Date.parse(a.date)) || new Date(a.date).toISOString().slice(0,10) !== a.date) throw new Error('Укажи корректную дату.');
  if (a.discussion && !/^https:\/\/t\.me\/[a-zA-Z0-9_/]+$/.test(a.discussion)) throw new Error('Ссылка обсуждения должна начинаться с https://t.me/.');
  const ids = new Set();
  for (const n of a.notes) {
    if (!/^[a-z0-9_-]+$/.test(n.id) || ids.has(n.id)) throw new Error('ID примечаний должны быть уникальными.');
    if (!n.text.trim()) throw new Error(`Заполни примечание ${n.id}.`);
    ids.add(n.id);
  }
  const references = [...a.body.matchAll(/\{\{note:([a-z0-9_-]+)\}\}/g)].map(m => m[1]);
  for (const id of references) if (!ids.has(id)) throw new Error(`Не найдено примечание ${id}.`);
  for (const id of ids) if (!references.includes(id)) throw new Error(`У примечания ${id} нет ссылки в тексте. Поставь курсор в нужное место и нажми «Вставить ссылку» у примечания.`);
}
export function serializeArticle(article, published = false) {
  const { body, _editor, _cover, ...data } = article;
  // JSON is a YAML subset: quoted values preserve punctuation and literal note markers.
  return `---\n${JSON.stringify({...data, ...(!published && _editor ? {_editor} : {}), ...(!published && _cover ? {_cover} : {}), published}, null, 2)}\n---\n\n${body.trim()}\n`;
}
export function deserializeArticle(raw, filename = '') {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);
  if (!match) throw new Error('Это не файл публикации сайта: отсутствуют поля в начале файла.');
  const data = load(match[1], {schema:JSON_SCHEMA});
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Некорректные поля публикации.');
  const a = { title:'', slug:filename.replace(/\.md$/, ''), author:'', translator:'', description:'', section:'translations', date:'', source:'', discussion:'', textAlign:'left', tags:[], ...data, body:match[2].trim(), notes:data.notes || [], bibliography:data.bibliography || [] };
  if (a.demo) throw new Error('Образец оформления не предназначен для редактирования здесь.');
  if (!Array.isArray(a.notes) || !Array.isArray(a.bibliography) || !Array.isArray(a.tags)) throw new Error('Некорректный формат примечаний, литературы или тем.');
  for (const n of a.notes) if (!n || typeof n.id !== 'string' || typeof n.text !== 'string') throw new Error('Некорректное примечание.');
  validateCover(a.cover);
  return a;
}
export const encodeContent = text => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
export const decodeContent = encoded => new TextDecoder().decode(Uint8Array.from(atob(encoded.replace(/\s/g, '')), c => c.charCodeAt(0)));

export async function publishArticle({article, token, expectedSha, coverAsset, fetcher = fetch}) {
  validateArticle(article);
  if (!token?.trim()) throw new Error('Вставь ключ GitHub в разделе подключения.');
  if (article.cover) return publishWithCover({article,token,expectedSha,coverAsset,fetcher});
  const endpoint = `${API}/contents/${postPath(article.slug)}`;
  const headers = {Accept:'application/vnd.github+json', Authorization:`Bearer ${token.trim()}`, 'Content-Type':'application/json'};
  const current = await fetcher(`${endpoint}?ref=main`, {headers, cache:'no-store'});
  if (!current.ok && current.status !== 404) throw new Error(githubError(current.status));
  const remote = current.ok ? await current.json() : null;
  if (remote && (!expectedSha || remote.sha !== expectedSha)) throw new Error('Этот адрес уже занят или публикация изменилась на GitHub. Сохрани свой черновик файлом и открой актуальную статью заново; для новой статьи выбери другой адрес.');
  if (!remote && expectedSha) throw new Error('Исходный файл удалён или переименован. Сохрани черновик и проверь список публикаций.');
  const response = await fetcher(endpoint, {method:'PUT', headers, body:JSON.stringify({message:`${remote ? 'Update' : 'Publish'}: ${article.title}`, content:encodeContent(serializeArticle(article,true)), branch:'main', ...(remote ? {sha:expectedSha} : {})})});
  if (!response.ok) throw new Error(githubError(response.status));
  return response.json();
}

async function gitBlobSha(bytes) {
  const prefix=new TextEncoder().encode(`blob ${bytes.length}\0`), all=new Uint8Array(prefix.length+bytes.length);
  all.set(prefix);all.set(bytes,prefix.length);return digestHex('SHA-1',all);
}
async function publishWithCover({article,token,expectedSha,coverAsset,fetcher}) {
  // A single Git commit publishes both files; a failed or racing save cannot leave a broken image on the site.
  const headers={Accept:'application/vnd.github+json',Authorization:`Bearer ${token.trim()}`,'Content-Type':'application/json'};
  async function request(path,method='GET',body,allow404=false) {
    const response=await fetcher(`${API}${path}`,{method,headers,cache:'no-store',...(body?{body:JSON.stringify(body)}:{})});
    if(allow404&&response.status===404)return null;
    if(!response.ok)throw new Error(githubError(response.status));
    return response.json();
  }
  const bytes=coverAsset ? await validateCoverAsset(article.cover,coverAsset) : null;
  const head=(await request('/git/ref/heads/main')).object.sha;
  const remote=await request(`/contents/${postPath(article.slug)}?ref=${head}`,'GET',undefined,true);
  if(remote&&(!expectedSha||remote.sha!==expectedSha))throw new Error('Этот адрес уже занят или публикация изменилась на GitHub. Сохрани черновик и открой актуальную статью заново.');
  if(!remote&&expectedSha)throw new Error('Исходный файл удалён или переименован. Сохрани черновик и проверь список публикаций.');
  const parent=await request(`/git/commits/${head}`);
  const coverPath=`public${article.cover.src}`;
  const existing=await request(`/contents/${coverPath}?ref=${head}`,'GET',undefined,true);
  const tree=[{path:postPath(article.slug),mode:'100644',type:'blob',content:serializeArticle(article,true)}];
  if(existing){
    if(existing.type!=='file'||existing.size!==article.cover.bytes)throw new Error('Файл обложки на GitHub отличается от ожидаемого. Загрузи обложку заново.');
    if(bytes && existing.sha!==await gitBlobSha(bytes))throw new Error('Файл по адресу обложки был изменён на GitHub. Выбери другую обложку.');
  } else {
    if(!bytes)throw new Error('Обложки ещё нет на GitHub. Выбери исходную картинку в блоке «Обложка» или открой скачанный черновик с картинкой.');
    const blob=await request('/git/blobs','POST',{encoding:'base64',content:coverAsset.base64});
    tree.push({path:coverPath,mode:'100644',type:'blob',sha:blob.sha});
  }
  const createdTree=await request('/git/trees','POST',{base_tree:parent.tree.sha,tree});
  const commit=await request('/git/commits','POST',{message:`${remote?'Update':'Publish'}: ${article.title}`,tree:createdTree.sha,parents:[head]});
  await request('/git/refs/heads/main','PATCH',{sha:commit.sha,force:false});
  return {content:{sha:await gitBlobSha(new TextEncoder().encode(serializeArticle(article,true)))},commit};
}
function githubError(status) {
  return ({401:'GitHub не принял ключ. Проверь его или создай новый.',403:'Нет доступа к записи: проверь срок ключа, выбранный репозиторий и Contents: Read and write. Также мог быть достигнут лимит запросов.',404:'Не найден репозиторий или ключ не даёт к нему доступа.',409:'Файл изменился на GitHub. Сохрани черновик и заново открой актуальную публикацию.',422:'GitHub отклонил сохранение. Проверь адрес, права ключа и правила ветки main.'})[status] || `GitHub вернул ошибку ${status}. Черновик остаётся в редакторе.`;
}
