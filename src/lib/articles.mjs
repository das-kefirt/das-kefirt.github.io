import { parseArticle } from './content.mjs';
const files = import.meta.glob('../content/posts/*.md', { query: '?raw', import: 'default', eager: true });
export const allArticles = Object.entries(files).map(([path, raw]) => parseArticle(raw, path));
export const articles = allArticles.filter(a => a.published && !a.demo).sort((a, b) => new Date(b.date) - new Date(a.date));
export const demoArticle = allArticles.find(a => a.demo);
export const formatDate = value => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
