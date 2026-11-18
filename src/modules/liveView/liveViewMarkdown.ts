/**
 * Small, dependency-free Markdown renderer used by the Live View panel.
 *
 * The renderer escapes every input fragment before inserting tags, so file
 * contents can never inject HTML into the host application. It intentionally
 * supports the subset the panel needs (headings, lists, tables, quotes, code,
 * emphasis and links) rather than the full CommonMark grammar.
 */

type BlockResult = {
  html: string;
  next: number;
};

const RE_HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const RE_FENCE = /^\s*```/;
const RE_QUOTE = /^\s*>\s?/;
const RE_LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const RE_TASK = /^\[([ xX])\]\s+(.*)$/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineMd(text: string): string {
  return String(text).split(/(`[^`]*`)/g).map((chunk) => {
    if (chunk.length >= 2 && chunk.startsWith('`') && chunk.endsWith('`')) {
      return '<code>' + escapeHtml(chunk.slice(1, -1)) + '</code>';
    }
    let out = escapeHtml(chunk);
    out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2" loading="lazy">');
    out = out.replace(
      /\[([^\]]+)\]\(([^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    );
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
    out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return out;
  }).join('');
}

function isTableSep(line: string): boolean {
  return line.includes('|') && line.includes('-') && /^[\s|:-]+$/.test(line);
}

function isBlockStartMd(lines: string[], index: number): boolean {
  const line = lines[index];
  if (
    RE_HEADING.test(line)
    || RE_HR.test(line)
    || RE_FENCE.test(line)
    || RE_QUOTE.test(line)
    || RE_LIST.test(line)
  ) {
    return true;
  }
  return line.includes('|') && index + 1 < lines.length && isTableSep(lines[index + 1]);
}

function splitRowMd(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|')) text = text.slice(0, -1);
  return text.split('|').map((cell) => cell.trim());
}

function parseTableMd(lines: string[], index: number): BlockResult {
  let cursor = index;
  const head = splitRowMd(lines[cursor]);
  const aligns = splitRowMd(lines[cursor + 1]).map((cell) => {
    const value = cell.trim();
    if (/^:.*:$/.test(value)) return 'center';
    if (/^:/.test(value)) return 'left';
    if (/:$/.test(value)) return 'right';
    return '';
  });
  cursor += 2;

  const rows: string[][] = [];
  while (cursor < lines.length && lines[cursor].trim() !== '' && lines[cursor].includes('|')) {
    rows.push(splitRowMd(lines[cursor]));
    cursor += 1;
  }

  const cell = (tag: 'th' | 'td', text: string, column: number): string => {
    const align = aligns[column] || '';
    return '<' + tag + (align ? ' style="text-align:' + align + '"' : '') + '>' +
      inlineMd(text || '') + '</' + tag + '>';
  };

  let html = '<div class="clv-table"><table><thead><tr>' +
    head.map((text, column) => cell('th', text, column)).join('') +
    '</tr></thead><tbody>';
  for (const row of rows) {
    html += '<tr>' + head.map((_, column) => cell('td', row[column] || '', column)).join('') + '</tr>';
  }
  html += '</tbody></table></div>';
  return { html, next: cursor };
}

function parseListMd(lines: string[], index: number): BlockResult {
  let cursor = index;
  const first = lines[cursor]?.match(RE_LIST);
  if (!first) return { html: '', next: cursor };

  const baseIndent = first[1].length;
  const ordered = /^\d/.test(first[2]);
  let html = ordered ? '<ol>' : '<ul>';

  while (cursor < lines.length) {
    const match = lines[cursor].match(RE_LIST);
    if (!match || match[1].length !== baseIndent || /^\d/.test(match[2]) !== ordered) break;

    const text = match[3];
    cursor += 1;
    const sub: string[] = [];

    while (cursor < lines.length) {
      const line = lines[cursor];
      if (line.trim() === '') {
        let lookahead = cursor;
        while (lookahead < lines.length && lines[lookahead].trim() === '') lookahead += 1;
        if (lookahead >= lines.length) {
          cursor = lookahead;
          break;
        }
        const nextItem = lines[lookahead].match(RE_LIST);
        const indent = lines[lookahead].search(/\S/);
        if (nextItem && nextItem[1].length === baseIndent && /^\d/.test(nextItem[2]) === ordered) {
          cursor = lookahead;
          break;
        }
        if (indent > baseIndent) {
          sub.push('');
          cursor = lookahead;
          continue;
        }
        cursor = lookahead;
        break;
      }

      const indent = line.search(/\S/);
      if (indent > baseIndent) {
        sub.push(line.slice(Math.min(indent, baseIndent + 2)));
        cursor += 1;
        continue;
      }
      break;
    }

    const task = text.match(RE_TASK);
    let body: string;
    if (task) {
      body = '<span class="clv-task">' + (task[1].toLowerCase() === 'x' ? '☑' : '☐') +
        '</span> ' + inlineMd(task[2]);
    } else {
      body = inlineMd(text);
    }

    html += '<li>' + body;
    if (sub.length) {
      if (sub.some((_, subIndex) => isBlockStartMd(sub, subIndex))) {
        html += renderBlocksMd(sub);
      } else {
        html += '<br>' + sub.filter((line) => line.trim() !== '').map(inlineMd).join('<br>');
      }
    }
    html += '</li>';
  }

  html += ordered ? '</ol>' : '</ul>';
  return { html, next: cursor };
}

function renderBlocksMd(lines: string[]): string {
  let out = '';
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '') {
      index += 1;
      continue;
    }

    if (RE_FENCE.test(line)) {
      const langMatch = line.match(/^\s*```\s*([\w+-]*)/);
      const lang = langMatch ? langMatch[1] : '';
      index += 1;
      const buffer: string[] = [];
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        buffer.push(lines[index]);
        index += 1;
      }
      index += 1;
      out += '<pre><code' + (lang ? ' class="lang-' + escapeHtml(lang) + '"' : '') + '>' +
        escapeHtml(buffer.join('\n')) + '</code></pre>';
      continue;
    }

    const heading = line.match(RE_HEADING);
    if (heading) {
      const level = heading[1].length;
      out += '<h' + level + '>' + inlineMd(heading[2]) + '</h' + level + '>';
      index += 1;
      continue;
    }

    if (RE_HR.test(line)) {
      out += '<hr>';
      index += 1;
      continue;
    }

    if (RE_QUOTE.test(line)) {
      const buffer: string[] = [];
      while (index < lines.length && RE_QUOTE.test(lines[index])) {
        buffer.push(lines[index].replace(RE_QUOTE, ''));
        index += 1;
      }
      out += '<blockquote>' + renderBlocksMd(buffer) + '</blockquote>';
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && isTableSep(lines[index + 1])) {
      const table = parseTableMd(lines, index);
      out += table.html;
      index = table.next;
      continue;
    }

    if (RE_LIST.test(line)) {
      const list = parseListMd(lines, index);
      out += list.html;
      index = list.next;
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() !== '' && !isBlockStartMd(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    out += '<p>' + paragraph.map(inlineMd).join('<br>') + '</p>';
  }

  return out;
}

/** Renders Markdown for the Live View article; all content is HTML-escaped first. */
export function markdownToHtml(markdown: string): string {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  return renderBlocksMd(lines);
}
