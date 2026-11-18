import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { AppError } from '@/shared/utils.js';
import {
  createLiveViewService,
  type LiveViewFileSystem,
} from '@/modules/live-view/live-view.service.js';

type FakeNode = {
  type: 'directory' | 'file';
  content?: string;
  size?: number;
  mtime?: number;
};

function createHarness() {
  const nodes = new Map<string, FakeNode>([
    ['/workspace', { type: 'directory' }],
    ['/workspace/tor-nur', { type: 'directory' }],
    ['/workspace/tor-nur/dokument.md', { type: 'file', content: '# Nur\n', mtime: 10 }],
    ['/workspace/node_modules', { type: 'directory' }],
    ['/workspace/.git', { type: 'directory' }],
    ['/outside', { type: 'directory' }],
    ['/outside/secret.md', { type: 'file', content: 'secret' }],
  ]);

  const fileSystem: LiveViewFileSystem = {
    async realpath(target) {
      if (!nodes.has(target)) {
        throw new Error('ENOENT');
      }
      return target;
    },
    async stat(target) {
      const node = nodes.get(target);
      if (!node) {
        throw new Error('ENOENT');
      }
      const size = node.size ?? (node.content ? Buffer.byteLength(node.content) : 0);
      return {
        isDirectory: () => node.type === 'directory',
        isFile: () => node.type === 'file',
        size,
        mtimeMs: node.mtime ?? 1,
      };
    },
    async readDirectory(target) {
      return [...nodes.keys()]
        .filter((candidate) => path.dirname(candidate) === target)
        .map((candidate) => path.basename(candidate));
    },
    async readFile(target) {
      const node = nodes.get(target);
      if (!node || node.content === undefined) {
        throw new Error('ENOENT');
      }
      return Buffer.from(node.content);
    },
  };

  const service = createLiveViewService({
    roots: ['/workspace'],
    fileSystem,
    maximumContentBytes: 32,
  });

  return { nodes, service };
}

test('lists the configured roots', async () => {
  const { service } = createHarness();
  assert.deepEqual(await service.listRoots(), { roots: ['/workspace'] });
});

test('lists directories first and hides heavy internal directories', async () => {
  const { service } = createHarness();
  const directory = await service.listDirectory('/workspace');
  assert.equal(directory.path, '/workspace');
  assert.equal(directory.parent, null);
  assert.deepEqual(directory.entries.map((entry) => entry.name), ['tor-nur']);
  assert.equal(directory.entries[0].type, 'directory');
  assert.ok(!directory.entries.some((entry) => entry.name === 'node_modules'));
  assert.ok(!directory.entries.some((entry) => entry.name === '.git'));
});

test('returns file metadata and text content', async () => {
  const { service } = createHarness();
  const stat = await service.statFile('/workspace/tor-nur/dokument.md');
  assert.equal(stat.path, '/workspace/tor-nur/dokument.md');
  assert.equal(stat.mtime, 10);

  const file = await service.readTextFile('/workspace/tor-nur/dokument.md');
  assert.equal(file.name, 'dokument.md');
  assert.equal(file.content, '# Nur\n');
});

test('rejects files outside every allowed root', async () => {
  const { service } = createHarness();
  await assert.rejects(
    service.readTextFile('/outside/secret.md'),
    (error: unknown) => error instanceof AppError && error.statusCode === 403,
  );
});

test('rejects directories passed to file endpoints', async () => {
  const { service } = createHarness();
  await assert.rejects(
    service.statFile('/workspace'),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );
});

test('rejects binaries and files above the content limit', async () => {
  const { nodes, service } = createHarness();
  nodes.set('/workspace/binary.bin', { type: 'file', content: 'a\u0000b' });
  nodes.set('/workspace/large.txt', { type: 'file', content: 'x'.repeat(40) });

  await assert.rejects(
    service.readTextFile('/workspace/binary.bin'),
    (error: unknown) => error instanceof AppError && error.statusCode === 415,
  );
  await assert.rejects(
    service.readTextFile('/workspace/large.txt'),
    (error: unknown) => error instanceof AppError && error.statusCode === 413,
  );
});
