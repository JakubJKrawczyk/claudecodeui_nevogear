import { expect, test } from 'vitest';

import {
  baseName,
  clampDockWidth,
  dirName,
  formatSize,
  isMarkdownPath,
} from '@/modules/liveView/liveViewFormatting';

test('extracts POSIX and Windows path segments', () => {
  expect(baseName('/ollama/tor-nur/dokument.md')).toBe('dokument.md');
  expect(baseName('C:\\work\\notes.md')).toBe('notes.md');
  expect(dirName('/ollama/tor-nur/dokument.md')).toBe('/ollama/tor-nur');
  expect(dirName('C:\\work\\notes.md')).toBe('C:/work');
});

test('clamps the dock width to keep the chat usable', () => {
  expect(clampDockWidth(42)).toBe(42);
  expect(clampDockWidth(10)).toBe(25);
  expect(clampDockWidth(90)).toBe(70);
  expect(clampDockWidth(Number.NaN)).toBe(42);
});

test('recognizes markdown files and formats file metadata', () => {
  expect(isMarkdownPath('/x/dokument.md')).toBe(true);
  expect(isMarkdownPath('/x/README.MARKDOWN')).toBe(true);
  expect(isMarkdownPath('/x/notes.txt')).toBe(false);
  expect(formatSize(512)).toBe('512 B');
  expect(formatSize(2048)).toBe('2.0 KB');
  expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB');
});
