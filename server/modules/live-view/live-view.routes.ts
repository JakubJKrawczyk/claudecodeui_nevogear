import express from 'express';

import { AppError } from '@/shared/utils.js';

import type { LiveViewService } from './live-view.service.js';

/** Parses an optional path query value; rejects arrays and blank strings. */
function readOptionalPath(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError('Path must be a non-empty string', {
      code: 'LIVE_VIEW_INVALID_PATH',
      statusCode: 400,
    });
  }
  return value;
}

/** Parses a required path query value for file endpoints. */
function readRequiredPath(value: unknown): string {
  const parsed = readOptionalPath(value);
  if (!parsed) {
    throw new AppError('Path is required', {
      code: 'LIVE_VIEW_PATH_REQUIRED',
      statusCode: 400,
    });
  }
  return parsed;
}

/**
 * Used by the Live View module to expose the read-only roots, directory,
 * stat and text-file endpoints mounted behind the host JWT.
 */
export function createLiveViewRouter(service: LiveViewService): express.Router {
  const router = express.Router();

  router.get('/roots', async (_request, response, next) => {
    try {
      response.json(await service.listRoots());
    } catch (error) {
      next(error);
    }
  });

  router.get('/tree', async (request, response, next) => {
    try {
      response.json(await service.listDirectory(readOptionalPath(request.query.path)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/stat', async (request, response, next) => {
    try {
      response.json(await service.statFile(readRequiredPath(request.query.path)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/file', async (request, response, next) => {
    try {
      response.json(await service.readTextFile(readRequiredPath(request.query.path)));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
