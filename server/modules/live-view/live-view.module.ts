import { promises as fileSystemPromises } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Router } from 'express';

import { createLiveViewRouter } from './live-view.routes.js';
import { createLiveViewService, type LiveViewFileSystem } from './live-view.service.js';

const MAXIMUM_CONTENT_BYTES = 2 * 1024 * 1024;

/**
 * Production filesystem adapter owned by the Live View composition root.
 * The service receives this complete capability explicitly and never imports
 * Node's mutable filesystem APIs itself.
 */
const liveViewFileSystem: LiveViewFileSystem = {
  realpath: (target) => fileSystemPromises.realpath(target),
  stat: (target) => fileSystemPromises.stat(target),
  readDirectory: (target) => fileSystemPromises.readdir(target),
  readFile: (target) => fileSystemPromises.readFile(target),
};

/**
 * Reads the roots the panel may browse: the user's home, the server's working
 * directory (the workspace), an optional explicit workspace root, and any
 * extra directories named in LIVE_VIEW_ROOTS (colon-separated).
 */
function readLiveViewRoots(): string[] {
  const roots = [process.env.HOME || os.homedir(), process.cwd()];
  if (process.env.WORKSPACE_ROOT) {
    roots.push(process.env.WORKSPACE_ROOT);
  }
  if (process.env.LIVE_VIEW_ROOTS) {
    roots.push(...process.env.LIVE_VIEW_ROOTS.split(path.delimiter).filter(Boolean));
  }
  return [...new Set(roots.filter(Boolean))];
}

/**
 * Used by the server entrypoint to mount the read-only Live View API at
 * `/api/live-view` behind the existing authentication middleware.
 */
export function createLiveViewModule(): Router {
  const service = createLiveViewService({
    roots: readLiveViewRoots(),
    fileSystem: liveViewFileSystem,
    maximumContentBytes: MAXIMUM_CONTENT_BYTES,
  });
  return createLiveViewRouter(service);
}
