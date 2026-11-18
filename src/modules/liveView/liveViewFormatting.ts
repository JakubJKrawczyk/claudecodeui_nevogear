/** Returns the final segment of a POSIX or Windows path for the panel header. */
export function baseName(filePath: string): string {
  return String(filePath).split(/[\\/]/).filter(Boolean).pop() || filePath;
}

/** Returns the parent directory of a POSIX or Windows path. */
export function dirName(filePath: string): string {
  const normalized = String(filePath).replace(/\\/g, '/');
  const trimmed = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  const slash = trimmed.lastIndexOf('/');
  return slash > 0 ? trimmed.slice(0, slash) : '/';
}

/** Whether the panel should render the file as Markdown instead of raw text. */
export function isMarkdownPath(filePath: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(String(filePath));
}

/** Formats a byte count for the compact file-picker metadata column. */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/** Formats a file mtime for the file picker; returns an empty string when absent. */
export function formatTime(milliseconds: number): string {
  if (!milliseconds) return '';
  try {
    return new Date(milliseconds).toLocaleTimeString('pl-PL', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/** Clamps the dock width percentage so the chat always keeps usable space. */
export function clampDockWidth(percent: number): number {
  return Math.min(70, Math.max(25, Number.isFinite(percent) ? percent : 42));
}
