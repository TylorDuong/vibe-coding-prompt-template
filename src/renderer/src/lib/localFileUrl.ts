/**
 * Build a URL for Electron's `local-file` protocol so `<video>` / `<img>` resolve
 * reliably on Windows. Encoding the full path as a single URL "host" (e.g.
 * `local-file://C%3A%5C...`) parses inconsistently in Chromium vs Node; using
 * `local-file:///C%3A/Users/...` keeps the path in `pathname` and matches
 * `localFileRequestToFsPath` in the main process.
 */
export function absPathToLocalFileUrl(absPath: string): string {
  const trimmed = absPath.trim()
  if (!trimmed) {
    return 'local-file:///'
  }
  const norm = trimmed.replace(/\\/g, '/')
  const segments = norm.split('/').filter((s) => s.length > 0)
  const encoded = segments.map((s) => encodeURIComponent(s)).join('/')
  return encoded.length > 0 ? `local-file:///${encoded}` : 'local-file:///'
}
