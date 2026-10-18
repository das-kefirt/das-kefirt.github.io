import { Marked } from 'marked';
const plainMarkdown = new Marked({ gfm: true });
export function compileArticle(article, clean) {
  const renderMarkdown = text => clean(plainMarkdown.parse(text || ""));
  const used = [];
  const refs = new Map();
  const headings = [];
  // Markdown treats trailing HTML comments as separate tokens. Remove metadata
  // before parsing and keep it in the same order as the actual headings.
  const headingMetadata = [];
  let fence = null;
  const body = (article.body || '').split(/\r?\n/).map(line => {
    const matchFence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (matchFence) {
      if (!fence) fence = { character: matchFence[1][0], length: matchFence[1].length };
      else if (matchFence[1][0] === fence.character && matchFence[1].length >= fence.length) fence = null;
      return line;
    }
    if (fence || !/^#{1,6}[ \t]+\S/.test(line)) return line;
    const plain = /<!--toc-plain-->/.test(line);
    const encoded = /<!--toc-title:([^<>]*)-->/.exec(line)?.[1];
    let label = '';
    if (encoded) {
      try { label = decodeURIComponent(encoded).trim(); } catch { /* invalid label is ignored */ }
    }
    headingMetadata.push({plain, label});
    return line.replace(/[ \t]*<!--toc-plain-->/g, '').replace(/[ \t]*<!--toc-title:[^<>]*-->/g, '');
  }).join('\n');
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
      const metadata = headingMetadata[headings.length] || {plain: false, label: ''};
      const id = `section-${headings.length + 1}`;
      const originalTitle = title.replace(/<[^>]*>/g, '');
      headings.push({ id, title: metadata.label || originalTitle, originalTitle, tocLabel: metadata.label, plain: metadata.plain });
      return `<h${level}${metadata.plain ? ' class="toc-plain"' : ''} id="${id}">${title}</h${level}>`;
    }
  } });
  const html = clean(markdown.parse(body));
  return {
    html, headings,
    notes: used.map((n, index) => ({ ...n, number: index + 1, html: renderMarkdown(n.text), refs: refs.get(n.id) })),
    bibliography: article.bibliography.map(item => renderMarkdown(typeof item === 'string' ? item : item.text)),
    minutes: Math.max(1, Math.ceil(article.body.split(/\s+/).length / 180))
  };
}
