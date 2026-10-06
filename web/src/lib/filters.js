import { useCallback, useEffect, useMemo, useState } from 'react'

/** What Review's "Show" menu offers, as [value, label]. */
export const SHOW = [
  ['all', 'All images'],
  ['unreviewed', 'Not reviewed yet'],
  ['ok', 'Marked OK'],
  ['no', 'Marked not OK'],
  ['review', 'Corrected, waiting to be accepted'],
  ['deleted', 'Deleted'],
  ['commented', 'Has comments'],
  ['unlabeled', 'Missing label file'],
  ['empty', 'Label file, no boxes'],
]

/** The image filters Review and Stats share: status, classes, any/all.
 *  Split stays on Review — Stats already breaks every count down by split.
 *  Class indices belong to one version, so a version change drops them. */
export function useFilters(version) {
  const [mode, setMode] = useState('all')
  const [cls, setCls] = useState(() => new Set())
  const [matchAll, setMatchAll] = useState(false)

  useEffect(() => { setCls(new Set()) }, [version])

  const toggleClass = useCallback((i) => setCls((prev) => {
    const next = new Set(prev)
    next.has(i) ? next.delete(i) : next.add(i)
    return next
  }), [])

  const clear = useCallback(() => {
    setMode('all'); setCls(new Set()); setMatchAll(false)
  }, [])

  // The query the server's item_filter takes, for /api/items and /api/stats.
  const query = useMemo(() => ({
    mode, cls: [...cls].join(','), clsmode: matchAll ? 'all' : 'any',
  }), [mode, cls, matchAll])

  return {
    mode, setMode, cls, setCls, toggleClass, matchAll, setMatchAll, clear, query,
    active: mode !== 'all' || cls.size > 0,
  }
}
