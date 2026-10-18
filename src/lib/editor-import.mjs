import TurndownService from 'turndown';
import { slugify } from './editor-core.mjs';

export function createMarkdownConverter() {
  const converter = new TurndownService({headingStyle:'atx', bulletListMarker:'-', emDelimiter:'*', strongDelimiter:'**'});
  converter.addRule('outlineHeading', {
    filter: node => /^H[23]$/.test(node.nodeName),
    replacement: (content, node) => {
      const level = Number(node.nodeName.slice(1));
      const plain = node.classList.contains('toc-plain') ? ' <!--toc-plain-->' : '';
      const title = (node.getAttribute('data-toc-title') || '').trim();
      const label = title ? ` <!--toc-title:${encodeURIComponent(title)}-->` : '';
      return `\n\n${'#'.repeat(level)} ${content.trim()}${plain}${label}\n\n`;
    }
  });
  converter.addRule('noteMarker', {
    filter: node => node.nodeName === 'SPAN' && node.hasAttribute('data-note-id'),
    replacement: (_text,node) => `{{note:${node.getAttribute('data-note-id')}}}`
  });
  converter.addRule('strike', {filter:['s','del'], replacement:content => `~~${content}~~`});
  // Keep semantic HTML where ordinary Markdown has no equivalent.
  converter.keep(['table','thead','tbody','tr','td','th','sub','sup','u']);
  return converter;
}

export function convertWordHtml(html, {document, sanitize}) {
  const container = document.createElement('div');
  container.innerHTML = sanitize(html);
  const converter = createMarkdownConverter();
  const notes = [];
  const warnings = [];
  for (const img of [...container.querySelectorAll('img')]) {
    const placeholder = document.createElement('span');
    placeholder.textContent = '[Изображение из Word — добавьте отдельно]';
    img.replaceWith(placeholder);
  }
  for (const li of [...container.querySelectorAll('li[id]')]) {
    if (!/^(?:footnote|endnote)-/.test(li.id)) continue;
    const originalId = li.id;
    const id = originalId.replace(/[^a-z0-9_-]/gi,'-').toLowerCase();
    for (const a of li.querySelectorAll('a[href]')) {
      if (/^#(?:footnote|endnote)-ref-/.test(a.getAttribute('href'))) a.remove();
    }
    const text = converter.turndown(li.innerHTML).trim();
    notes.push({id, kind:/Прим\.\s*пер\./i.test(li.textContent) ? 'Примечание переводчика' : 'Примечание автора', text});
    for (const link of [...container.querySelectorAll('a[href]')]) {
      if (link.getAttribute('href') !== `#${originalId}`) continue;
      const span = document.createElement('span');
      span.dataset.noteId = id;
      span.textContent = `{{note:${id}}}`;
      const target = link.parentElement?.tagName === 'SUP' ? link.parentElement : link;
      target.replaceWith(span);
    }
    const parent = li.parentElement;
    li.remove();
    if (!parent.children.length) parent.remove();
  }
  let title = '';
  const first = container.firstElementChild;
  if (first && first.textContent.length < 180 && (/^H[12]$/.test(first.tagName) || (first.querySelector('strong') && first.textContent.trim() === [...first.querySelectorAll('strong')].map(n => n.textContent).join('').trim()))) {
    title = first.textContent.trim(); first.remove();
  }
  for (const p of [...container.querySelectorAll('p')]) {
    if (/^(Предисловие (от )?переводчика|От переводчика):?$/i.test(p.textContent.trim())) {
      const h = document.createElement('h2'); h.innerHTML = p.innerHTML; p.replaceWith(h);
    } else if (p.textContent.trim() === '***') p.replaceWith(document.createElement('hr'));
  }
  if (container.querySelector('table')) warnings.push('В документе есть таблицы: проверь их в предпросмотре.');
  return {title, slug:slugify(title), body:converter.turndown(container.innerHTML), notes, warnings};
}
