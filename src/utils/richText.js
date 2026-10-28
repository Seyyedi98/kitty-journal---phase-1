// Rich-text helpers. Entries keep two representations:
//   body       plain text (search, previews, word counts, notifications, old exports)
//   body_html  a small, sanitised HTML subset written by the editor
// The plain text is ALWAYS derived from the HTML here, so the two never disagree.
// Pure functions (no DOM) so they run in the app, in Node tests and in the WebView host.

export const RICH_FORMAT_VERSION = 2;

const BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'hr']);
const INLINE = new Set(['strong', 'em', 'u', 's', 'br', 'span']);
const ALIAS = { b: 'strong', i: 'em', strike: 's', del: 's', div: 'p', h4: 'h3', h5: 'h3', h6: 'h3', font: 'span' };
const DROP_CONTENT = new Set(['script', 'style', 'head', 'title', 'iframe', 'object', 'svg', 'template']);
const DIRS = new Set(['ltr', 'rtl', 'auto']);
const ALIGNS = new Set(['left', 'right', 'center', 'justify']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g) => {
    if (g[0] === '#') {
      const code = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    const v = ENTITIES[g.toLowerCase()];
    return v === undefined ? m : v;
  });
}
export const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** '#rgb' | '#rrggbb' | 'rgb(r,g,b)' | 'rgba(...)' -> '#rrggbb', or null. */
export function normalizeColor(v) {
  const x = String(v || '').trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(x);
  if (m) return '#' + m[1].split('').map((ch) => ch + ch).join('');
  m = /^#([0-9a-f]{6})$/.exec(x);
  if (m) return '#' + m[1];
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(x);
  if (m && (m[4] === undefined || Number(m[4]) > 0)) {
    return '#' + [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('');
  }
  return null;
}
// The editor offers a few font families that exist on every phone (no downloads, so
// entries stay readable offline). Stored as canonical CSS stacks.
export const FONT_STACKS = {
  serif: 'serif',
  naskh: "'Noto Naskh Arabic',serif",
  mono: 'monospace',
  hand: 'cursive',
};
/** Any CSS font-family value -> 'serif' | 'naskh' | 'mono' | 'hand', or null (= default font). */
export function fontKey(v) {
  const x = String(v || '').toLowerCase().replace(/&quot;|&#39;|["']/g, '');
  if (!x || /\bsans/.test(x) || x.includes('system-ui')) return null;
  if (x.includes('naskh')) return 'naskh';
  if (x.includes('mono') || x.includes('courier')) return 'mono';
  if (x.includes('cursive') || x.includes('script')) return 'hand';
  if (x.includes('serif')) return 'serif';
  return null;
}
function fontOfAttrs(raw) {
  raw = String(raw).replace(/&quot;|&#39;|&apos;/g, '');
  const m = /(?:^|[;\s"'])font-family\s*:\s*([^;"]+)/i.exec(raw);
  return m ? fontKey(m[1]) : null;
}
/** Highlight: '#rrggbb' or rgba() with alpha in (0,1] -> 'rgba(r,g,b,a)' / '#rrggbb'; transparent -> null. */
export function normalizeHighlight(v) {
  const x = String(v || '').trim().toLowerCase();
  const m = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([\d.]+)\s*\)$/.exec(x);
  if (m) {
    const a = Number(m[4]);
    if (!(a > 0)) return null;
    return `rgba(${Math.min(255, +m[1])},${Math.min(255, +m[2])},${Math.min(255, +m[3])},${Math.round(Math.min(1, a) * 100) / 100})`;
  }
  return normalizeColor(x);
}
function highlightOfAttrs(raw) {
  const m = /background(?:-color)?\s*:\s*([^;"]+)/i.exec(raw);
  return m ? normalizeHighlight(m[1].trim()) : null;
}
function colorOfAttrs(raw) {
  const css = /(?:^|[;\s"'])color\s*:\s*([^;"']+)/i.exec(raw);
  if (css) return normalizeColor(css[1]);
  const attr = /\bcolor\s*=\s*["']?([^"'\s>]+)/i.exec(raw);
  return attr ? normalizeColor(attr[1]) : null;
}

/** Keeps only dir / text-align on block tags. */
function blockAttrs(raw) {
  let out = '';
  const dir = /\bdir\s*=\s*["']?(ltr|rtl|auto)/i.exec(raw);
  if (dir && DIRS.has(dir[1].toLowerCase())) out += ` dir="${dir[1].toLowerCase()}"`;
  const al = /text-align\s*:\s*(left|right|center|justify)/i.exec(raw);
  if (al && ALIGNS.has(al[1].toLowerCase())) out += ` style="text-align:${al[1].toLowerCase()}"`;
  return out;
}

const TOKEN = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|[^<]+|</g;

/**
 * Reduces any HTML to the supported subset: p, h1-h3, ul/ol/li, blockquote, hr,
 * strong, em, u, s, br (+ dir and text-align on blocks). Everything else is
 * unwrapped (text kept) or dropped (script/style). Loose top-level text is
 * wrapped in <p>. Idempotent.
 */
export function sanitizeHtml(input, opts = {}) {
  const dropColor = opts.dropColor ? normalizeColor(opts.dropColor) : null;
  const src = String(input ?? '');
  const out = [];
  const stack = []; // open block / list tags, to close them properly
  const inlineOpen = []; // open inline tags in the current block
  const spanKept = [];
  let skipUntil = null;
  let loose = false; // inside an implicit <p>

  const closeInline = () => {
    while (inlineOpen.length) out.push(`</${inlineOpen.pop()}>`);
  };
  const closeLoose = () => {
    if (loose) {
      closeInline();
      out.push('</p>');
      loose = false;
    }
  };
  const inTextBlock = () => stack.length && ['p', 'h1', 'h2', 'h3', 'li', 'blockquote'].includes(stack[stack.length - 1]);

  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(src))) {
    const tok = m[0];
    if (tok.startsWith('<!--')) continue;
    const name = m[1] ? (ALIAS[m[1].toLowerCase()] || m[1].toLowerCase()) : null;
    const rawName = m[1] ? m[1].toLowerCase() : null;
    if (skipUntil) {
      if (tok.startsWith('</') && rawName === skipUntil) skipUntil = null;
      continue;
    }
    if (!name) {
      // text (a lone "<" is text too)
      const text = tok === '<' ? '&lt;' : tok.includes('&') ? escapeHtml(decodeEntities(tok)) : escapeHtml(tok);
      if (!text.trim() && !inTextBlock() && !loose) continue; // whitespace between blocks
      if (!inTextBlock() && !loose) {
        out.push('<p>');
        loose = true;
      }
      out.push(text);
      continue;
    }
    const closing = tok.startsWith('</');
    if (DROP_CONTENT.has(rawName)) {
      if (!closing && !tok.endsWith('/>')) skipUntil = rawName;
      continue;
    }
    if (name === 'span') {
      // only a text colour survives; any other span is unwrapped
      if (!closing) {
        const rawAttrs = m[2] || '';
        let col = colorOfAttrs(rawAttrs);
        if (col && col === dropColor) col = null;
        const bg = highlightOfAttrs(rawAttrs);
        const font = fontOfAttrs(rawAttrs);
        const keep = Boolean(col || bg || font);
        spanKept.push(keep);
        if (keep) {
          const style = [font && `font-family:${FONT_STACKS[font]}`, col && `color:${col}`, bg && `background-color:${bg}`].filter(Boolean).join(';');
          if (!inTextBlock() && !loose) {
            out.push('<p>');
            loose = true;
          }
          out.push(`<span style="${style}">`);
          inlineOpen.push('span');
        }
      } else if (spanKept.pop()) {
        const i = inlineOpen.lastIndexOf('span');
        if (i >= 0) {
          const tail = inlineOpen.splice(i);
          tail.reverse().forEach((n) => out.push(`</${n}>`));
          tail.reverse().slice(1).forEach((n) => { out.push(`<${n}>`); inlineOpen.push(n); });
        }
      }
      continue;
    }
    if (INLINE.has(name)) {
      if (name === 'br') {
        if (!closing) {
          if (!inTextBlock() && !loose) {
            out.push('<p>');
            loose = true;
          }
          out.push('<br>');
        }
        continue;
      }
      if (!inTextBlock() && !loose) {
        if (closing) continue;
        out.push('<p>');
        loose = true;
      }
      if (!closing) {
        out.push(`<${name}>`);
        inlineOpen.push(name);
      } else {
        const i = inlineOpen.lastIndexOf(name);
        if (i >= 0) {
          const tail = inlineOpen.splice(i);
          tail.reverse().forEach((n) => out.push(`</${n}>`));
          tail.reverse().slice(1).forEach((n) => { out.push(`<${n}>`); inlineOpen.push(n); });
        }
      }
      continue;
    }
    if (!BLOCKS.has(name)) continue; // unknown tag: unwrap, keep its text
    closeLoose();
    if (name === 'hr') {
      if (!closing) out.push('<hr>');
      continue;
    }
    if (!closing) {
      // <li> only inside lists; a stray <li> becomes a paragraph
      let tag = name;
      if (name === 'li' && !['ul', 'ol'].includes(stack[stack.length - 1])) tag = 'p';
      // a block opened inside a text block closes it first (no nested p/h/li)
      while (stack.length && ['p', 'h1', 'h2', 'h3'].includes(stack[stack.length - 1]) && tag !== 'li') {
        closeInline();
        out.push(`</${stack.pop()}>`);
      }
      const isList = ['ul', 'ol'].includes(tag);
      const attrs = isList ? blockAttrs(m[2] || '').replace(/ style="[^"]*"/, '') : blockAttrs(m[2] || '');
      out.push(`<${tag}${attrs}>`);
      stack.push(tag);
    } else {
      const want = name === 'li' && !stack.includes('li') ? 'p' : name;
      const i = stack.lastIndexOf(want);
      if (i < 0) continue;
      while (stack.length > i) {
        closeInline();
        out.push(`</${stack.pop()}>`);
      }
    }
  }
  closeLoose();
  while (stack.length) {
    closeInline();
    out.push(`</${stack.pop()}>`);
  }
  return out.join('');
}

/** Plain text of a (sanitised) HTML string: one line per block, lists marked. */
export function htmlToPlainText(html) {
  const src = sanitizeHtml(html);
  const lines = [];
  let cur = '';
  const listStack = [];
  const flush = (force = false) => {
    if (cur !== '' || force) lines.push(cur);
    cur = '';
  };
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(src))) {
    const tok = m[0];
    const name = m[1] ? m[1].toLowerCase() : null;
    if (!name) {
      cur += decodeEntities(tok);
      continue;
    }
    const closing = tok.startsWith('</');
    if (name === 'br') {
      lines.push(cur);
      cur = '';
    } else if (name === 'ul' || name === 'ol') {
      if (!closing) listStack.push({ type: name, n: 0 });
      else listStack.pop();
    } else if (name === 'li') {
      if (!closing) {
        const top = listStack[listStack.length - 1];
        if (top) top.n += 1;
        cur = top && top.type === 'ol' ? `${top.n}. ` : '• ';
      } else flush(true);
    } else if (name === 'hr') {
      if (!closing) flush();
    } else if (['p', 'h1', 'h2', 'h3', 'blockquote'].includes(name)) {
      if (closing) flush(true);
    }
  }
  flush();
  return lines.join('\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Legacy plain-text entries open in the editor as paragraphs. */
export function plainTextToHtml(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  return lines.map((l) => (l === '' ? '<p><br></p>' : `<p>${escapeHtml(l)}</p>`)).join('');
}

/** True when the HTML has no visible content (only empty paragraphs). */
export function isHtmlEmpty(html) {
  return htmlToPlainText(html).trim() === '' && !/<hr/i.test(String(html ?? ''));
}

/** What the editor should load for an entry row. */
export function entryToEditorHtml(entry) {
  if (entry && entry.body_html && entry.content_format_version >= RICH_FORMAT_VERSION) return sanitizeHtml(entry.body_html);
  return plainTextToHtml(entry?.body || '');
}

/** The row fields to persist for editor HTML. */
export function htmlToRow(html) {
  const clean = sanitizeHtml(html);
  if (isHtmlEmpty(clean)) return { body: '', body_html: null, content_format_version: 1 };
  return { body: htmlToPlainText(clean), body_html: clean, content_format_version: RICH_FORMAT_VERSION };
}
