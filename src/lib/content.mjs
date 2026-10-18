import { compileArticle as compileWithSanitizer } from './render.mjs';
import matter from 'gray-matter';
import { Marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { validateCover } from './cover.mjs';

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
  validateCover(data.cover);
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
  return { ...data, textAlign: ['left','center','right','justify'].includes(data.textAlign) ? data.textAlign : 'left', slug, published, body: content, notes, tags: data.tags || [], bibliography: data.bibliography || [] };
}

export const compileArticle = article => compileWithSanitizer(article, clean);
