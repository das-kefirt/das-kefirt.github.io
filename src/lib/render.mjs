import { Marked } from 'marked';
const plainMarkdown = new Marked({ gfm: true });
export function compileArticle(article, clean) {
  const renderMarkdown = text => clean(plainMarkdown.parse(text || ""));
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
      let title = this.parser.parseInline(tokens);
      const plainToc = /<!--\s*toc-plain\s*-->/.test(title);
      if (plainToc) title = title.replace(/\s*<!--\s*toc-plain\s*-->/g, '');
      const id = `section-${headings.length + 1}`;
      headings.push({ id, title: title.replace(/<[^>]*>/g, '') });
      return `<h${level}${plainToc ? ' class="toc-plain"' : ''} id="${id}">${title}</h${level}>`;
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
