import type { Route } from '../domain'

/**
 * Resolves the location shown by the editor. A newly-created location is still
 * only a draft, so it must remain editable even when the company has no saved
 * locations yet.
 */
export function routeForEditing(routes: Route[] | undefined, code: string, draft: Route | null) {
  return routes?.find((route) => route.code === code) ?? (draft?.code === code ? draft : undefined)
}
