import { articles } from '../lib/articles.mjs';
import { siteUrl, authorSlug, escapeHtml } from '../lib/content.mjs';
export function GET() {
  const authors = [...new Set(articles.flatMap(a => [a.author, a.translator].filter(Boolean)))];
  const paths = ['/', '/about/', '/translations/', '/essays/', '/columns/', '/friends/', '/archive/', '/authors/', ...articles.map(a => `/read/${a.slug}/`), ...authors.map(a => `/authors/${authorSlug(a)}/`)];
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(p => `<url><loc>${escapeHtml(siteUrl + p)}</loc></url>`).join('')}</urlset>`, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
