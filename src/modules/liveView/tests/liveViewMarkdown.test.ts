import { expect, test } from 'vitest';

import { markdownToHtml } from '@/modules/liveView/liveViewMarkdown';

test('renders the document subset used by the live view', () => {
  const html = markdownToHtml([
    '# Nur',
    '',
    '**bold** and *italic*',
    '',
    '- [x] done',
    '- [ ] todo',
    '',
    '| Atrybut | Wartość |',
    '|---|---|',
    '| Siła | 6 |',
    '',
    '> cytat',
  ].join('\n'));

  expect(html).toContain('<h1>Nur</h1>');
  expect(html).toContain('<strong>bold</strong>');
  expect(html).toContain('<em>italic</em>');
  expect(html).toContain('☑');
  expect(html).toContain('☐');
  expect(html).toContain('<table>');
  expect(html).toContain('<th>Atrybut</th>');
  expect(html).toContain('<blockquote>');
});

test('escapes HTML from the file before rendering markdown', () => {
  const html = markdownToHtml('<script>alert(1)</script>');
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
});
