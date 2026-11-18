import { useEffect } from 'react';

import { installLiveView } from '@/modules/liveView/liveViewController';

/**
 * Rendered by App inside ProtectedRoute. The panel itself is mounted in
 * document.body beside #root, so it survives route and tab changes while the
 * application is shifted to the right.
 */
export function LiveViewDock() {
  useEffect(() => installLiveView(), []);
  return null;
}
