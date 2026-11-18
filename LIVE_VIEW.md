# Live View fork — file panel beside the chat

This fork adds a docked, read-only file viewer to CloudCLI. A panel on the left
polls a project file and renders it; the application is shifted to the right so
the chat remains usable beside it. It is part of the application source, not a
CloudCLI plugin.

## What changed

| Area | Change |
|---|---|
| `server/modules/live-view/` | Read-only API at `/api/live-view` (`roots`, `tree`, `stat`, `file`), behind the existing JWT middleware. Paths are resolved with `realpath` and confined to HOME, the server working directory and `LIVE_VIEW_ROOTS`. Text only, up to 2 MB. |
| `src/modules/liveView/` | `LiveViewDock` React component, imperative body-level controller, Markdown renderer, formatting helpers and tests. The panel survives route and tab changes because it lives beside React's `#root`. |
| `src/shared/api.ts`, `src/shared/types.ts` | Typed, authenticated helpers for the live-view endpoints. |
| `src/shared/hooks/useVersionCheck.ts` | GitHub release checks are disabled. The hook still probes local `/health` for the restart hint, but never reports an available update. |
| `server/modules/cli/cli.service.ts` | `cloudcli start` no longer checks npm for a newer release. |
| `server/modules/system/system.routes.ts` | `POST /api/system/update` returns 403 so a manual update cannot overwrite this build. |
| `scripts/install-live-view-service.sh` | Optional root script that points the `cloudcli` systemd unit at this build. |

Manual `cloudcli update` still exists in the CLI, but the running service cannot
self-update through the UI.

## Build

```bash
npm ci
npm run build        # client + server
```

The build output is git-ignored (`dist/`, `dist-server/`) and must exist on the
machine that runs the service.

## Run locally

```bash
node dist-server/server/modules/cli/cli.js start
```

Set `LIVE_VIEW_ROOTS` to a colon-separated list of extra readable roots if the
project files live outside HOME and the process working directory.

## Install as the system service

The existing `cloudcli.service` is a system-level unit running as `cloudcli`.
The script writes an `ExecStart` drop-in pointing at this repository and
restarts the unit:

```bash
sudo ./scripts/install-live-view-service.sh
```

The restart terminates the current chat process. Sessions and login tokens live
in `~/.claude` and `~/.cloudcli/auth.db`, so reload the UI and resume the
session afterwards.

## Using the panel

- **Plik** opens the file picker (tree or a typed path).
- Drag the panel's right edge to resize; double-click resets to 42%.
- **Źródło / Podgląd** toggles rendered Markdown.
- **×** hides the panel; the floating **Live View** button brings it back.
- `Ctrl+Shift+L` toggles the panel.
- Last file, width and render mode are stored in `localStorage`.

## Limits

- Read-only, text only (UTF-8, ≤ 2 MB); binaries are rejected with 415.
- The panel shifts the whole `#root`; below 900 px it becomes a full-screen
  overlay instead.
- Updates are intentionally disabled in this fork. To adopt a newer upstream
  release, re-apply these changes and rebuild before switching the service.
