import matter from 'gray-matter';
import { Marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export const sections = [
  { slug: 'translations', label: 'Переводы', singular: 'Перевод', description: 'Философские тексты в переводе на русский.' },
  { slug: 'essays', label: 'Тексты', singular: 'Текст', description: 'Авторские статьи и эссе.' },
  { slug: 'columns', label: 'Колонки', singular: 'Колонка', description: 'Короткие заметки друзей и гостей.' }
];
export const siteUrl = 'https://das-kefirt.github.io';
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clean = html => sanitizeHtml(html, {
  allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'sup'],
  allowedAttributes: {
    a: ['href', 'id', 'class', 'aria-label', 'data-note', 'role'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    h2: ['id'], h3: ['id'], code: ['class']
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false
});
const plainMarkdown = new Marked({ gfm: true });
export const renderMarkdown = text => clean(plainMarkdown.parse(text || ''));
export const authorSlug = name => name.trim().normalize('NFC').toLocaleLowerCase('ru').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');

export function parseArticle(raw, filename) {
  const { data, content } = matter(raw);
  const slug = filename.replace(/.*\//, '').replace(/\.md$/, '');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`Некорректный адрес: ${filename}`);
  // Missing published flag is deliberately private from the built website.
  const published = data.published === true;
  if (published || data.demo === true) {
    for (const key of ['title', 'description', 'author']) {
      if (typeof data[key] !== 'string' || !data[key].trim()) throw new Error(`${filename}: заполните ${key}`);
    }
    if (!sections.some(s => s.slug === data.section)) throw new Error(`${filename}: неизвестный раздел`);
    if (!data.date || Number.isNaN(new Date(data.date).getTime())) throw new Error(`${filename}: неверная дата`);
  }
  const notes = data.notes || [];
  if (!Array.isArray(notes)) throw new Error(`${filename}: примечания должны быть списком`);
  const ids = new Set();
  for (const note of notes) {
    if (!/^[a-z0-9_-]+$/.test(note.id || '') || ids.has(note.id)) throw new Error(`${filename}: неверный или повторный ID примечания`);
    if (typeof note.text !== 'string') throw new Error(`${filename}: отсутствует текст примечания ${note.id}`);
    ids.add(note.id);
  }
  return { ...data, slug, published, body: content, notes, tags: data.tags || [], bibliography: data.bibliography || [] };
}

export function compileArticle(article) {
  const used = [];
  const refs = new Map();
  const headings = [];
  const markdown = new Marked({ gfm: true });
  markdown.use({ extensions: [{
    name: 'separateNote', level: 'inline',
    start(src) { return src.indexOf('{{note:'); },
    tokenizer(src) {
      const match = /^\{\{note:([a-z0-9_-]+)\}\}/.exec(src);
      if (match) return { type: 'separateNote', raw: match[0], noteId: match[1] };
    },
    renderer(token) {
      const note = article.notes.find(n => n.id === token.noteId);
      if (!note) throw new Error(`${article.slug}: не найдено примечание ${token.noteId}`);
      if (!refs.has(note.id)) { refs.set(note.id, []); used.push(note); }
      const number = used.findIndex(n => n.id === note.id) + 1;
      const id = `ref-${note.id}-${refs.get(note.id).length + 1}`;
      refs.get(note.id).push(id);
      return `<sup><a class="note-ref" href="#note-${note.id}" id="${id}" data-note="note-${note.id}" role="doc-noteref" aria-label="Примечание ${number}">${number}</a></sup>`;
    }
  }], renderer: {
    heading({ tokens, depth }) {
      const level = Math.min(Math.max(depth, 2), 3);
      const title = this.parser.parseInline(tokens);
      const id = `section-${headings.length + 1}`;
      headings.push({ id, title: sanitizeHtml(title, { allowedTags: [], allowedAttributes: {} }) });
      return `<h${level} id="${id}">${title}</h${level}>`;
    }
  } });
  const html = clean(markdown.parse(article.body));
  return {
    html, headings,
    notes: used.map((n, index) => ({ ...n, number: index + 1, html: renderMarkdown(n.text), refs: refs.get(n.id) })),
    bibliography: article.bibliography.map(item => renderMarkdown(typeof item === 'string' ? item : item.text)),
    minutes: Math.max(1, Math.ceil(article.body.split(/\s+/).length / 180))
  };
}
