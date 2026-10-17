import { articles } from '../lib/articles.mjs';
import { escapeHtml, siteUrl } from '../lib/content.mjs';
export function GET() {
  const items = articles.map(a => `<item><title>${escapeHtml(a.title)}</title><link>${siteUrl}/read/${a.slug}/</link><guid>${siteUrl}/read/${a.slug}/</guid><description>${escapeHtml(a.description)}</description><pubDate>${new Date(a.date).toUTCString()}</pubDate></item>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>das kefirt</title><link>${siteUrl}/</link><description>Переводы, тексты и колонки о философии</description><language>ru</language>${items}</channel></rss>`, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
}
