import { useEffect, useState } from 'react'
import { resolveUsernames } from './username'

/**
 * Resolves display usernames for a set of uids from the public `usernames`
 * collection. Returns a uid -> handle map; uids without a reserved handle are
 * simply absent, so callers fall back to email (see displayNameFor). Re-fetches
 * only when the distinct uid set changes; a stale in-flight fetch is ignored on
 * cleanup. Read failures are logged, not thrown — a missing handle degrades to
 * the email fallback rather than breaking the surface.
 */
export function useUsernames(uids: string[]): Record<string, string> {
  const key = [...new Set(uids)].filter((u) => u.length > 0).sort().join(',')
  const [map, setMap] = useState<Record<string, string>>({})
  useEffect(() => {
    if (key === '') { setMap({}); return }
    let cancelled = false
    resolveUsernames(key.split(','))
      .then((m) => { if (!cancelled) setMap(m) })
      .catch((err: unknown) => console.error('[eclipse-arcade] username lookup failed:', err))
    return () => { cancelled = true }
  }, [key])
  return map
}
