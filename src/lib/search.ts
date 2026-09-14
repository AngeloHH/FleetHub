// What "buscar" means everywhere there is a search field: the typed thing,
// found or not found in the words the row already shows. Searching what is
// visible is the promise the field makes — anything readable is findable.

/** Does any of these texts contain what was typed, case aside? */
export function matchesQuery(query: string, ...texts: (string | undefined)[]) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return texts.some((t) => t?.toLowerCase().includes(q))
}
