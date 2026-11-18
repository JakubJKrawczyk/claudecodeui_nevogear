import { useState, useEffect } from 'react';

import { APP_VERSION } from '@/shared/constants';
import type { InstallMode, ReleaseInfo } from '@/shared/types';

/** The local installation status consumed by the sidebar and the About tab. */
type VersionCheckState = {
  updateAvailable: boolean;
  latestVersion: string | null;
  currentVersion: string;
  releaseInfo: ReleaseInfo | null;
  installMode: InstallMode;
  runningVersion: string | null;
  restartRequired: boolean;
};

/**
 * Reads the local installation health shown by the sidebar and the About tab.
 *
 * Update checks are intentionally disabled in this fork: GitHub is never
 * contacted and the hook always reports that no update is available, so the
 * update badge and modal cannot appear.
 */
export const useVersionCheck = (): VersionCheckState => {
  const [installMode, setInstallMode] = useState<InstallMode>('git');
  const [runningVersion, setRunningVersion] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const response = await fetch('/health');
        const data = await response.json();
        if (data.installMode === 'npm' || data.installMode === 'git') {
          setInstallMode(data.installMode);
        }
        // `data.version` is the version the server process is actually running.
        // This module's `version` is baked into the frontend bundle at build
        // time, so it reflects the installed (on-disk) package. If they differ,
        // the package was updated but the server process was not restarted, and
        // DB-backed actions may silently fail until it is.
        if (typeof data.version === 'string' && data.version.length > 0) {
          setRunningVersion(data.version);
          setRestartRequired(data.version !== APP_VERSION);
        }
      } catch {
        // Default to git / no restart hint on error
      }
    };
    void fetchHealth();
  }, []);

  const latestVersion: string | null = null;
  const releaseInfo: ReleaseInfo | null = null;

  return {
    updateAvailable: false,
    latestVersion,
    currentVersion: APP_VERSION,
    releaseInfo,
    installMode,
    runningVersion,
    restartRequired,
  };
};
