import path from 'node:path';

import { AppError } from '@/shared/utils.js';

/** One entry in a directory listed by the read-only Live View API. */
type LiveViewEntry = {
  name: string;
  path: string;
  type: 'directory' | 'file';
  size: number;
  mtime: number;
};

/** One browsable directory returned to the Live View picker. */
type LiveViewDirectory = {
  path: string;
  parent: string | null;
  entries: LiveViewEntry[];
};

/** File metadata used by the browser's cheap change polling. */
type LiveViewFileStat = {
  path: string;
  mtime: number;
  size: number;
};

/** Text file payload rendered by the docked Live View panel. */
type LiveViewFile = LiveViewFileStat & {
  name: string;
  content: string;
};

/** Roots the Live View panel may browse, already resolved through realpath. */
type LiveViewRoots = {
  roots: string[];
};

/**
 * Minimal filesystem surface the Live View service needs. The composition
 * root supplies a Node adapter; tests supply an in-memory one.
 */
export type LiveViewFileSystem = {
  realpath(target: string): Promise<string>;
  stat(target: string): Promise<{
    isDirectory(): boolean;
    isFile(): boolean;
    size: number;
    mtimeMs: number;
  }>;
  readDirectory(target: string): Promise<string[]>;
  readFile(target: string): Promise<Buffer>;
};

/** Dependencies that make Live View path policy and limits explicit. */
export type LiveViewServiceDependencies = {
  roots: string[];
  fileSystem: LiveViewFileSystem;
  maximumContentBytes: number;
};

/** Read-only workflows exposed to the Live View routes. */
export type LiveViewService = {
  listRoots(): Promise<LiveViewRoots>;
  listDirectory(requestedPath?: string): Promise<LiveViewDirectory>;
  statFile(requestedPath: string): Promise<LiveViewFileStat>;
  readTextFile(requestedPath: string): Promise<LiveViewFile>;
};

const HIDDEN_DIRECTORY_NAMES = new Set(['node_modules', '.git']);
const MAXIMUM_DIRECTORY_ENTRIES = 2000;

function pathNotFound(): AppError {
  return new AppError('File or directory not found', {
    code: 'LIVE_VIEW_PATH_NOT_FOUND',
    statusCode: 404,
  });
}

function pathForbidden(): AppError {
  return new AppError('Path is outside the allowed roots', {
    code: 'LIVE_VIEW_PATH_FORBIDDEN',
    statusCode: 403,
  });
}

/**
 * Creates the Live View workflows used by the module router and its focused
 * tests. All filesystem access stays behind the injected adapter so path
 * policy, size limits and binary detection can be tested without touching the
 * real disk.
 */
export function createLiveViewService(
  dependencies: LiveViewServiceDependencies,
): LiveViewService {
  const { fileSystem } = dependencies;
  let allowedRootsPromise: Promise<string[]> | null = null;

  function allowedRoots(): Promise<string[]> {
    if (!allowedRootsPromise) {
      allowedRootsPromise = Promise.all(
        dependencies.roots.map(async (root) => {
          const resolved = path.resolve(root);
          try {
            return await fileSystem.realpath(resolved);
          } catch {
            // A configured root that does not exist cannot contain anything;
            // keep the resolved path so the error remains a clear 403 rather
            // than crashing the panel at startup.
            return resolved;
          }
        }),
      ).then((roots) => [...new Set(roots)]);
    }
    return allowedRootsPromise;
  }

  function isInside(root: string, target: string): boolean {
    return target === root || target.startsWith(root + path.sep);
  }

  async function resolveAllowed(requestedPath: string | undefined): Promise<string> {
    if (!requestedPath || requestedPath.trim() === '') {
      throw new AppError('Path is required', {
        code: 'LIVE_VIEW_PATH_REQUIRED',
        statusCode: 400,
      });
    }

    const resolved = path.resolve(requestedPath);
    let realPath: string;
    try {
      realPath = await fileSystem.realpath(resolved);
    } catch {
      throw pathNotFound();
    }

    const roots = await allowedRoots();
    if (!roots.some((root) => isInside(root, realPath))) {
      throw pathForbidden();
    }
    return realPath;
  }

  async function listDirectory(requestedPath?: string): Promise<LiveViewDirectory> {
    const roots = await allowedRoots();
    if (roots.length === 0) {
      throw new AppError('No Live View roots are configured', {
        code: 'LIVE_VIEW_NO_ROOTS',
        statusCode: 500,
      });
    }

    const target = await resolveAllowed(requestedPath || roots[roots.length - 1]);
    let stats: Awaited<ReturnType<LiveViewFileSystem['stat']>>;
    try {
      stats = await fileSystem.stat(target);
    } catch {
      throw pathNotFound();
    }
    if (!stats.isDirectory()) {
      throw new AppError('Path is not a directory', {
        code: 'LIVE_VIEW_NOT_DIRECTORY',
        statusCode: 400,
      });
    }

    let names: string[];
    try {
      names = await fileSystem.readDirectory(target);
    } catch {
      throw new AppError('Directory not accessible', {
        code: 'LIVE_VIEW_DIRECTORY_NOT_ACCESSIBLE',
        statusCode: 404,
      });
    }

    const entries = await Promise.all(
      names.slice(0, MAXIMUM_DIRECTORY_ENTRIES).map(async (name): Promise<LiveViewEntry> => {
        const entryPath = path.join(target, name);
        let entryStats: Awaited<ReturnType<LiveViewFileSystem['stat']>> | null = null;
        try {
          entryStats = await fileSystem.stat(entryPath);
        } catch {
          entryStats = null;
        }
        return {
          name,
          path: entryPath,
          type: entryStats?.isDirectory() ? 'directory' : 'file',
          size: entryStats?.size ?? 0,
          mtime: entryStats?.mtimeMs ?? 0,
        };
      }),
    );

    const visibleEntries = entries.filter((entry) => (
      entry.type !== 'directory' || !HIDDEN_DIRECTORY_NAMES.has(entry.name)
    ));
    visibleEntries.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === 'directory' ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

    const parent = path.dirname(target);
    const parentIsAllowed = parent !== target && roots.some((root) => isInside(root, parent));

    return {
      path: target,
      parent: parentIsAllowed ? parent : null,
      entries: visibleEntries,
    };
  }

  async function statFile(requestedPath: string): Promise<LiveViewFileStat> {
    const target = await resolveAllowed(requestedPath);
    let stats: Awaited<ReturnType<LiveViewFileSystem['stat']>>;
    try {
      stats = await fileSystem.stat(target);
    } catch {
      throw pathNotFound();
    }
    if (!stats.isFile()) {
      throw new AppError('Path is not a file', {
        code: 'LIVE_VIEW_NOT_FILE',
        statusCode: 400,
      });
    }
    return { path: target, mtime: stats.mtimeMs, size: stats.size };
  }

  async function readTextFile(requestedPath: string): Promise<LiveViewFile> {
    const stat = await statFile(requestedPath);
    if (stat.size > dependencies.maximumContentBytes) {
      throw new AppError('File is too large for the live view (limit 2 MB)', {
        code: 'LIVE_VIEW_FILE_TOO_LARGE',
        statusCode: 413,
      });
    }

    let buffer: Buffer;
    try {
      buffer = await fileSystem.readFile(stat.path);
    } catch {
      throw pathNotFound();
    }
    if (buffer.includes(0)) {
      throw new AppError('Binary files are not supported', {
        code: 'LIVE_VIEW_BINARY_FILE',
        statusCode: 415,
      });
    }

    return {
      path: stat.path,
      name: path.basename(stat.path),
      mtime: stat.mtime,
      size: stat.size,
      content: buffer.toString('utf8'),
    };
  }

  return {
    async listRoots() {
      return { roots: await allowedRoots() };
    },
    listDirectory,
    statFile,
    readTextFile,
  };
}
