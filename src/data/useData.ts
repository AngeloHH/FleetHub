// Reading the seam from a component.
//
// Nothing more than: run this read, keep what it returns, and run it again
// whenever the rows change. It is the smallest thing that works against an
// asynchronous seam, and it is where a real query library would slot in if the
// app ever needs caching or retries.

import { useEffect, useState } from 'react'
import { subscribe } from './store'

/**
 * The value of an asynchronous read, or undefined until it arrives.
 *
 * `keys` says when the read itself changed — an id it closes over, say. The
 * read is re-run on every write to the store regardless, so a list does not
 * need to name what it depends on.
 */
export function useData<T>(read: () => Promise<T>, keys: unknown[] = []): T | undefined {
  const [value, setValue] = useState<T>()

  useEffect(() => {
    let alive = true
    const run = () => {
      void read().then((next) => {
        if (alive) setValue(next)
      })
    }
    run()
    const off = subscribe(run)
    return () => {
      alive = false
      off()
    }
    // The read is a fresh closure every render; `keys` is what really changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, keys)

  return value
}
