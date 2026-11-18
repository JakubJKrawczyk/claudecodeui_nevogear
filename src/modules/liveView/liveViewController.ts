import { ApiRequestError, liveViewApi } from '@/shared/api';
import type { LiveViewEntry } from '@/shared/types';
import {
  baseName,
  clampDockWidth,
  dirName,
  formatSize,
  formatTime,
  isMarkdownPath,
} from '@/modules/liveView/liveViewFormatting';
import { markdownToHtml } from '@/modules/liveView/liveViewMarkdown';

import '@/modules/liveView/liveView.css';

const STORE_KEYS = {
  enabled: 'clv.enabled',
  width: 'clv.width',
  path: 'clv.path',
  rendered: 'clv.rendered',
} as const;

const POLL_INTERVAL_MS = 900;

function storeGet(key: string, fallback: string): string {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function storeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private browsing can reject storage; the dock still works for this tab.
  }
}

function errorStatus(error: unknown): number {
  return error instanceof ApiRequestError ? error.status : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Nieznany błąd';
}

function installLiveViewDock(): () => void {
  if (document.getElementById('clv-panel')) {
    // A previous mount owns the panel; its effect cleanup removes it.
    return () => undefined;
  }

  /**
   * The dock is intentionally imperative and lives in document.body beside
   * React's #root: that is what lets it stay visible across routes and shift
   * the application to the right without re-rendering the chat.
   */
  const state = {
    enabled: storeGet(STORE_KEYS.enabled, 'true') !== 'false',
    width: clampDockWidth(Number(storeGet(STORE_KEYS.width, '42'))),
    path: storeGet(STORE_KEYS.path, ''),
    rendered: storeGet(STORE_KEYS.rendered, 'true') !== 'false',
    picking: false,
    treeDir: '',
    treeParent: null as string | null,
    roots: [] as string[],
    rootsLoaded: false,
    lastMtime: 0,
    lastSize: -1,
    content: '',
    timer: 0,
    busy: false,
    error: '',
    flashTimer: 0,
    pickerInput: null as HTMLInputElement | null,
    pickerStatus: null as HTMLElement | null,
    pickerList: null as HTMLElement | null,
    pickerUp: null as HTMLButtonElement | null,
  };

  let disposed = false;

  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string | null,
    text?: string | null,
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  // ── Panel chrome ──────────────────────────────────────────────────────────

  const panel = el('aside', 'clv-panel');
  panel.id = 'clv-panel';
  panel.setAttribute('aria-label', 'Live view pliku');

  const panelHead = el('header', 'clv-head');
  const dot = el('span', 'clv-dot clv-idle');
  const headText = el('div', 'clv-headtext');
  const nameEl = el('div', 'clv-name', 'Live View');
  const metaEl = el('div', 'clv-meta', 'wybierz plik do podglądu');
  headText.append(nameEl, metaEl);

  const actions = el('div', 'clv-actions');
  const pickBtn = el('button', 'clv-btn', 'Plik');
  const modeBtn = el('button', 'clv-btn', 'Źródło');
  const closeBtn = el('button', 'clv-btn clv-close', '×');
  for (const button of [pickBtn, modeBtn, closeBtn]) button.type = 'button';
  pickBtn.title = 'Wybierz plik do podglądu';
  modeBtn.title = 'Przełącz podgląd renderowany / źródło';
  closeBtn.title = 'Zamknij panel (Ctrl+Shift+L)';
  actions.append(pickBtn, modeBtn, closeBtn);
  panelHead.append(dot, headText, actions);

  const bodyEl = el('div', 'clv-body');
  const resizer = el('div', 'clv-resizer');
  resizer.title = 'Przeciągnij, aby zmienić szerokość';
  panel.append(panelHead, bodyEl, resizer);
  document.body.appendChild(panel);

  const launcher = el('button', 'clv-launcher');
  launcher.id = 'clv-launcher';
  launcher.type = 'button';
  launcher.title = 'Otwórz podgląd pliku (Ctrl+Shift+L)';
  launcher.appendChild(document.createTextNode('Live View'));
  document.body.appendChild(launcher);

  // ── Header ────────────────────────────────────────────────────────────────

  function updateHeader(): void {
    if (panel.classList.contains('clv-hidden')) return;
    nameEl.textContent = state.path ? baseName(state.path) : 'Live View';
    if (state.picking) {
      metaEl.textContent = 'wybieranie pliku';
    } else if (state.error) {
      metaEl.textContent = state.error;
    } else if (state.path) {
      metaEl.textContent = state.path;
    } else {
      metaEl.textContent = 'wybierz plik do podglądu';
    }
    metaEl.title = state.path || '';
    dot.className = 'clv-dot' + (state.error ? ' clv-err' : state.path ? '' : ' clv-idle');
    modeBtn.style.display = isMarkdownPath(state.path) && !state.picking ? '' : 'none';
    modeBtn.textContent = state.rendered ? 'Źródło' : 'Podgląd';
  }

  function flashHeader(): void {
    panelHead.classList.add('clv-flash');
    window.clearTimeout(state.flashTimer);
    state.flashTimer = window.setTimeout(() => panelHead.classList.remove('clv-flash'), 450);
  }

  // ── Content rendering ─────────────────────────────────────────────────────

  function renderEmpty(): void {
    const empty = el('div', 'clv-empty');
    empty.append(
      el('strong', null, 'Podgląd pliku na żywo'),
      el('div', null, 'Wybierz plik, który edytuje Claude — panel odświeża się automatycznie.'),
    );
    const button = el('button', 'clv-btn', 'Wybierz plik');
    button.type = 'button';
    button.addEventListener('click', () => { void openPicker(defaultStartDir()); });
    empty.appendChild(button);
    bodyEl.replaceChildren(empty);
  }

  function renderLoading(): void {
    const box = el('div', 'clv-empty');
    box.append(el('strong', null, 'Wczytywanie…'), el('div', null, state.path || ''));
    bodyEl.replaceChildren(box);
  }

  function errorActions(
    primaryLabel: string,
    primaryAction: () => void,
    allowPick: boolean,
  ): HTMLElement {
    const wrap = el('div', 'clv-error-actions');
    const primary = el('button', 'clv-btn', primaryLabel);
    primary.type = 'button';
    primary.addEventListener('click', primaryAction);
    wrap.appendChild(primary);
    if (allowPick) {
      const pick = el('button', 'clv-btn', 'Wybierz inny plik');
      pick.type = 'button';
      pick.addEventListener('click', () => {
        void openPicker(state.path ? dirName(state.path) : defaultStartDir());
      });
      wrap.appendChild(pick);
    }
    return wrap;
  }

  function renderError(error: unknown): void {
    state.error = errorMessage(error);
    updateHeader();
    const status = errorStatus(error);
    const box = el('div', 'clv-error');
    const title = status === 401
      ? 'Sesja wygasła'
      : status === 413
        ? 'Plik jest za duży'
        : status === 415
          ? 'Plik binarny'
          : 'Nie można wczytać pliku';
    box.append(el('div', 'clv-error-title', title), el('div', 'clv-error-message', state.error));
    if (status === 401) {
      box.appendChild(errorActions('Odśwież stronę', () => window.location.reload(), true));
    } else {
      box.appendChild(errorActions('Spróbuj ponownie', () => { void refresh(true); }, true));
    }
    bodyEl.replaceChildren(box);
  }

  function renderAuthError(): void {
    state.error = 'zaloguj się ponownie';
    updateHeader();
    const box = el('div', 'clv-error');
    box.append(
      el('div', 'clv-error-title', 'Brak dostępu'),
      el('div', 'clv-error-message', 'Zaloguj się w CloudCLI, aby panel mógł czytać pliki projektu.'),
    );
    const retry = el('button', 'clv-btn', 'Spróbuj ponownie');
    retry.type = 'button';
    retry.addEventListener('click', () => {
      void (async () => {
        state.rootsLoaded = false;
        await loadRoots();
        if (disposed) return;
        if (state.roots.length) {
          state.error = '';
          applyEnabled();
        } else {
          renderAuthError();
        }
      })();
    });
    const wrap = el('div', 'clv-error-actions');
    wrap.appendChild(retry);
    box.appendChild(wrap);
    bodyEl.replaceChildren(box);
  }

  function renderFileView(flash: boolean): void {
    if (state.picking) return;
    const oldScroll = bodyEl.querySelector('.clv-scroll');
    const oldTop = oldScroll ? oldScroll.scrollTop : 0;
    const oldHeight = oldScroll ? oldScroll.scrollHeight : 0;
    const oldClient = oldScroll ? oldScroll.clientHeight : 0;
    const wasAtBottom = oldScroll ? oldHeight - oldTop - oldClient < 48 : true;

    const scroll = el('div', 'clv-scroll');
    const article = el('article', 'clv-content');
    if (isMarkdownPath(state.path) && state.rendered) {
      article.innerHTML = markdownToHtml(state.content);
    } else {
      const pre = el('pre', 'clv-pre');
      pre.textContent = state.content === '' ? '(pusty plik)' : state.content;
      article.appendChild(pre);
    }
    scroll.appendChild(article);
    bodyEl.replaceChildren(scroll);

    if (oldScroll) {
      const max = scroll.scrollHeight - scroll.clientHeight;
      if (wasAtBottom) {
        scroll.scrollTop = scroll.scrollHeight;
      } else if (oldHeight > oldClient && max > 0) {
        scroll.scrollTop = (oldTop / (oldHeight - oldClient)) * max;
      }
    }
    if (flash) flashHeader();
  }

  // ── File picker ───────────────────────────────────────────────────────────

  function renderPickerShell(): void {
    const picker = el('div', 'clv-picker');
    const bar = el('div', 'clv-picker-bar');
    const input = el('input');
    input.type = 'text';
    input.spellcheck = false;
    input.placeholder = '/ścieżka/do/pliku';
    input.value = state.treeDir || (state.path ? dirName(state.path) : defaultStartDir());

    const openBtn = el('button', 'clv-btn', 'Otwórz');
    const upBtn = el('button', 'clv-btn', 'W górę');
    const startBtn = el('button', 'clv-btn', 'Start');
    for (const button of [openBtn, upBtn, startBtn]) button.type = 'button';
    openBtn.title = 'Otwórz plik lub przejdź do katalogu';
    upBtn.title = 'Katalog nadrzędny';
    startBtn.title = 'Katalog startowy';
    bar.append(input, openBtn, upBtn, startBtn);

    const status = el('div', 'clv-picker-status', '');
    const list = el('div', 'clv-picker-list');
    picker.append(bar, status, list);
    bodyEl.replaceChildren(picker);

    state.pickerInput = input;
    state.pickerStatus = status;
    state.pickerList = list;
    state.pickerUp = upBtn;

    const go = (): void => { void navigateOrOpen(input.value); };
    openBtn.addEventListener('click', go);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        go();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        void closePicker();
      }
    });
    upBtn.addEventListener('click', () => {
      if (state.treeParent) void loadTree(state.treeParent);
    });
    startBtn.addEventListener('click', () => { void loadTree(defaultStartDir()); });
  }

  async function loadTree(directory: string): Promise<void> {
    if (!state.pickerList) renderPickerShell();
    state.picking = true;
    updateHeader();
    if (state.pickerStatus) state.pickerStatus.textContent = 'Wczytywanie…';
    try {
      const data = await liveViewApi.tree(directory);
      if (disposed) return;
      state.treeDir = data.path;
      state.treeParent = data.parent || null;
      if (state.pickerInput) state.pickerInput.value = data.path;
      if (state.pickerUp) state.pickerUp.disabled = !data.parent;
      if (state.pickerStatus) {
        state.pickerStatus.textContent = data.entries.length
          ? data.entries.length + ' pozycji'
          : 'Pusty katalog';
      }
      renderTree(data.entries);
    } catch (error) {
      if (disposed) return;
      if (state.pickerStatus) state.pickerStatus.textContent = '';
      renderPickerError(error);
    }
  }

  function renderTree(entries: LiveViewEntry[]): void {
    if (!state.pickerList) return;
    const list = state.pickerList;
    list.replaceChildren();
    if (!entries.length) {
      list.appendChild(el('div', 'clv-picker-status', 'Brak pozycji'));
      return;
    }
    for (const entry of entries) {
      const row = el('button', 'clv-entry ' + (entry.type === 'directory' ? 'clv-entry-dir' : 'clv-entry-file'));
      row.type = 'button';
      row.title = entry.path;
      row.appendChild(el('span', 'clv-entry-name', entry.name));
      const meta = entry.type === 'directory'
        ? 'katalog'
        : [formatSize(entry.size), formatTime(entry.mtime)].filter(Boolean).join(' · ');
      if (meta) row.appendChild(el('span', 'clv-entry-meta', meta));
      row.addEventListener('click', () => {
        if (entry.type === 'directory') void loadTree(entry.path);
        else void openFile(entry.path);
      });
      list.appendChild(row);
    }
  }

  function renderPickerError(error: unknown): void {
    if (!state.pickerList) return;
    state.pickerList.replaceChildren();
    const box = el('div', 'clv-error');
    box.append(
      el(
        'div',
        'clv-error-title',
        errorStatus(error) === 403 ? 'Poza dozwolonym katalogiem' : 'Nie można otworzyć katalogu',
      ),
      el('div', 'clv-error-message', errorMessage(error)),
    );
    const retry = el('button', 'clv-btn', 'Spróbuj ponownie');
    retry.type = 'button';
    retry.addEventListener('click', () => { void loadTree(state.treeDir || defaultStartDir()); });
    const wrap = el('div', 'clv-error-actions');
    wrap.appendChild(retry);
    box.appendChild(wrap);
    state.pickerList.appendChild(box);
  }

  async function navigateOrOpen(value: string): Promise<void> {
    const target = String(value || '').trim();
    if (!target) return;
    try {
      const stats = await liveViewApi.stat(target);
      if (!disposed) await openFile(stats.path);
    } catch (error) {
      if (disposed) return;
      if (errorStatus(error) === 400) {
        await loadTree(target);
        return;
      }
      if (state.pickerStatus) state.pickerStatus.textContent = errorMessage(error);
      if (errorStatus(error) === 404 || errorStatus(error) === 403) renderPickerError(error);
    }
  }

  async function openPicker(startDirectory: string): Promise<void> {
    renderPickerShell();
    state.picking = true;
    updateHeader();
    const directory = startDirectory || defaultStartDir();
    if (directory) {
      await loadTree(directory);
    } else {
      renderAuthError();
    }
  }

  async function closePicker(): Promise<void> {
    state.picking = false;
    updateHeader();
    if (state.path) {
      renderFileView(false);
      await refresh(true);
    } else {
      renderEmpty();
    }
  }

  // ── File loading ──────────────────────────────────────────────────────────

  async function refresh(force: boolean): Promise<void> {
    if (!state.path || state.picking) return;
    try {
      const stats = await liveViewApi.stat(state.path);
      if (disposed) return;
      if (!force && stats.mtime === state.lastMtime && stats.size === state.lastSize) {
        state.error = '';
        updateHeader();
        return;
      }
      const file = await liveViewApi.file(state.path);
      if (disposed) return;
      state.lastMtime = file.mtime;
      state.lastSize = file.size;
      state.content = file.content;
      state.error = '';
      updateHeader();
      renderFileView(true);
    } catch (error) {
      if (disposed) return;
      renderError(error);
    }
  }

  async function openFile(filePath: string): Promise<void> {
    state.path = filePath;
    storeSet(STORE_KEYS.path, filePath);
    state.picking = false;
    state.error = '';
    state.lastMtime = 0;
    state.lastSize = -1;
    state.content = '';
    updateHeader();
    renderLoading();
    state.busy = true;
    try {
      await refresh(true);
    } finally {
      state.busy = false;
    }
  }

  function schedule(delay?: number): void {
    window.clearTimeout(state.timer);
    if (disposed || !state.enabled) return;
    state.timer = window.setTimeout(poll, delay === undefined ? POLL_INTERVAL_MS : delay);
  }

  async function poll(): Promise<void> {
    window.clearTimeout(state.timer);
    if (disposed || !state.enabled) return;
    if (document.visibilityState !== 'visible') {
      schedule(1500);
      return;
    }
    if (!state.path || state.picking) {
      schedule(1000);
      return;
    }
    if (state.busy) {
      schedule(POLL_INTERVAL_MS);
      return;
    }
    state.busy = true;
    try {
      await refresh(false);
    } finally {
      state.busy = false;
      schedule(state.error ? 4000 : POLL_INTERVAL_MS);
    }
  }

  // ── Roots, defaults, enable/disable ───────────────────────────────────────

  function defaultStartDir(): string {
    if (state.path) return dirName(state.path);
    if (state.treeDir) return state.treeDir;
    if (state.roots.length) {
      // The server lists HOME first and its working directory last. Projects
      // normally live in the workspace, so prefer the last root.
      return state.roots[state.roots.length - 1];
    }
    return '';
  }

  async function loadRoots(): Promise<void> {
    if (state.rootsLoaded) return;
    try {
      const data = await liveViewApi.roots();
      if (disposed) return;
      state.roots = Array.isArray(data.roots) ? data.roots : [];
      state.rootsLoaded = true;
      state.error = '';
    } catch (error) {
      if (disposed) return;
      state.roots = [];
      state.rootsLoaded = false;
      state.error = errorStatus(error) === 401 ? 'zaloguj się ponownie' : errorMessage(error);
    }
  }

  async function ensureInitialView(): Promise<void> {
    if (state.path) {
      updateHeader();
      if (state.content === '') {
        renderLoading();
        await refresh(true);
      }
      return;
    }
    if (state.picking) return;
    if (!state.roots.length) {
      renderAuthError();
      return;
    }
    await openPicker(defaultStartDir());
  }

  function applyEnabled(): void {
    document.documentElement.classList.toggle('clv-dock-on', state.enabled);
    document.documentElement.style.setProperty('--clv-width', state.width + 'vw');
    panel.classList.toggle('clv-hidden', !state.enabled);
    launcher.classList.toggle('clv-hidden', state.enabled);
    updateHeader();
    if (state.enabled) {
      void ensureInitialView();
      schedule(0);
    } else {
      window.clearTimeout(state.timer);
    }
  }

  function setEnabled(value: boolean): void {
    state.enabled = Boolean(value);
    storeSet(STORE_KEYS.enabled, String(state.enabled));
    applyEnabled();
  }

  // ── Wiring ────────────────────────────────────────────────────────────────

  pickBtn.addEventListener('click', () => {
    void openPicker(state.path ? dirName(state.path) : defaultStartDir());
  });

  modeBtn.addEventListener('click', () => {
    state.rendered = !state.rendered;
    storeSet(STORE_KEYS.rendered, String(state.rendered));
    updateHeader();
    if (state.path && !state.picking) renderFileView(false);
  });

  closeBtn.addEventListener('click', () => setEnabled(false));
  launcher.addEventListener('click', () => setEnabled(true));

  resizer.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    resizer.classList.add('clv-active');
    const previousSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';

    const onMove = (moveEvent: PointerEvent): void => {
      const percent = clampDockWidth((moveEvent.clientX / window.innerWidth) * 100);
      state.width = Math.round(percent * 10) / 10;
      document.documentElement.style.setProperty('--clv-width', state.width + 'vw');
    };
    const onUp = (): void => {
      resizer.classList.remove('clv-active');
      document.body.style.userSelect = previousSelect;
      window.removeEventListener('pointermove', onMove);
      storeSet(STORE_KEYS.width, String(state.width));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  });

  resizer.addEventListener('dblclick', () => {
    state.width = 42;
    document.documentElement.style.setProperty('--clv-width', '42vw');
    storeSet(STORE_KEYS.width, '42');
  });

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
    if (String(event.key).toLowerCase() !== 'l') return;
    event.preventDefault();
    setEnabled(!state.enabled);
  };
  document.addEventListener('keydown', handleKeyDown);

  void (async function init(): Promise<void> {
    document.documentElement.style.setProperty('--clv-width', state.width + 'vw');
    await loadRoots();
    if (disposed) return;
    applyEnabled();
  })();

  return () => {
    disposed = true;
    window.clearTimeout(state.timer);
    window.clearTimeout(state.flashTimer);
    document.removeEventListener('keydown', handleKeyDown);
    panel.remove();
    launcher.remove();
    document.documentElement.classList.remove('clv-dock-on');
    document.documentElement.style.removeProperty('--clv-width');
  };
}

/** Used by LiveViewDock to mount the body-level panel and return its cleanup. */
export function installLiveView(): () => void {
  return installLiveViewDock();
}
