// Where you are, kept in the address bar.
//
// The hash and not the path, for a reason: the review copy of this app is one
// HTML file opened straight off disk, and pushState refuses to run on file://.
// A hash works there and on a server alike, and costs nothing either way.
//
// Small on purpose. Eighteen screens and two parameters do not need a routing
// library; if the app ever grows nested layouts or loaders, this is the file
// that gets replaced and nothing else.

import { useEffect, useState } from 'react'

/** The path inside the hash, always starting with a slash. */
export function currentPath() {
  const hash = window.location.hash.replace(/^#/, '')
  return hash.startsWith('/') ? hash : '/'
}

export function navigate(to: string, { replace = false } = {}) {
  if (replace) {
    window.location.replace(`${window.location.pathname}${window.location.search}#${to}`)
    return
  }
  window.location.hash = to
}

/** Re-renders whenever the address changes, from a link or from the browser. */
export function usePath() {
  const [path, setPath] = useState(currentPath)
  useEffect(() => {
    const sync = () => setPath(currentPath())
    window.addEventListener('hashchange', sync)
    // The hash may have been set between first render and this effect.
    sync()
    return () => window.removeEventListener('hashchange', sync)
  }, [])
  return path
}

/**
 * Does this path fit this pattern, and with what? `:name` captures a segment.
 * Returns the captures, or null when it does not fit — so an empty object is a
 * match with nothing in it, which is why the caller must check for null.
 */
export function match(pattern: string, path: string): Record<string, string> | null {
  const wanted = pattern.split('/').filter(Boolean)
  const got = path.split('/').filter(Boolean)
  if (wanted.length !== got.length) return null

  const params: Record<string, string> = {}
  for (const [i, part] of wanted.entries()) {
    if (part.startsWith(':')) {
      params[part.slice(1)] = decodeURIComponent(got[i])
      continue
    }
    if (part !== got[i]) return null
  }
  return params
}
