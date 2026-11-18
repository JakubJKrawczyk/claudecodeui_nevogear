import express from 'express';

import type { createSystemUpdateService } from './system.service.js';

/** Creates thin system routes that delegate update execution to the service. */
export function createSystemRouter(
  _systemUpdateService: ReturnType<typeof createSystemUpdateService>,
): express.Router {
  const router = express.Router();

  router.post('/update', (_request, response) => {
    // Self-updates are disabled in this fork so npm cannot overwrite the
    // modified build while the service is running.
    response.status(403).json({
      success: false,
      error: 'Updates are disabled in this modified CloudCLI build',
    });
  });

  return router;
}
