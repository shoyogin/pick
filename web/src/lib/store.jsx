import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { getMeta, getVersion, getVersions, refresh } from './api'
import { useClassPrefs } from './classPrefs'

const Ctx = createContext(null)
const EMPTY = []   // stable identity: the prefs hook keys effects off it

/** Which dataset version everything is looking at, plus that version's stats.
 *  Review and Stats both need it, and the choice survives a page change. */
export function DataProvider({ children }) {
  const [versions, setVersions] = useState([])
  const [root, setRoot] = useState('')
  const [meta, setMeta] = useState(null)
  const [version, setVersion] = useState(() => localStorage.getItem('version') || '')
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)
  const [who, setWho] = useState(() => localStorage.getItem('reviewer') || '')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getVersions(), getMeta()])
      .then(([d, m]) => {
        setVersions(d.versions)
        setRoot(d.root)
        setMeta(m)
        setVersion((v) => (v && d.versions.includes(v) ? v : d.versions[0] || ''))
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!version) return
    localStorage.setItem('version', version)
    let stale = false
    getVersion(version)
      .then((s) => !stale && setStats(s))
      .catch((e) => !stale && setError(e.message))
    return () => { stale = true }
  }, [version])

  // One instance for the whole app: the class colours are CSS variables on
  // :root, so Stats and Files see them too, and `b` binds once rather than
  // once per page.
  const classPrefs = useClassPrefs(stats?.classes ?? EMPTY)

  // A proxy-supplied name always wins over the self-declared one.
  useEffect(() => { if (meta?.user) setWho(meta.user) }, [meta])
  const nameSelf = useCallback((v) => {
    setWho(v)
    localStorage.setItem('reviewer', v.trim())
  }, [])

  const rescan = useCallback(async () => {
    await refresh()
    if (version) setStats(await getVersion(version))
  }, [version])

  return (
    <Ctx.Provider value={{ versions, version, setVersion, stats, setStats, meta,
                           root, error, loading, rescan, classPrefs,
                           who, nameSelf }}>
      {children}
    </Ctx.Provider>
  )
}

export const useData = () => useContext(Ctx)
