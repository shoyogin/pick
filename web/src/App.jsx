import { useMemo } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import Cherry from './components/Cherry'
import ThemeToggle from './components/ThemeToggle'
import { DataProvider, useData } from './lib/store'
import Files from './pages/Files'
import Fix from './pages/Fix'
import Review from './pages/Review'
import Stats from './pages/Stats'

const tabs = [
  { to: '/', label: 'Files', end: true },
  { to: '/review', label: 'Review' },
  { to: '/fix', label: 'Fix' },
  { to: '/stats', label: 'Stats' },
]

/** Versions come back as paths under the dataset root — `v1` on a flat root,
 *  `online/t0.0.0` on a grouped one. Group them by the folder they sit in so
 *  the dropdown reads as a list of versions rather than a list of paths. */
function byGroup(versions) {
  const groups = new Map()
  for (const v of versions) {
    const cut = v.lastIndexOf('/')
    const key = cut < 0 ? '' : v.slice(0, cut)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ value: v, label: cut < 0 ? v : v.slice(cut + 1) })
  }
  return [...groups]
}

function VersionPicker() {
  const { versions, version, setVersion } = useData()
  const groups = useMemo(() => byGroup(versions), [versions])
  if (versions.length === 0) return null
  return (
    <label className="flex items-center gap-2 text-sm text-ink2">
      Version
      <select
        value={version}
        onChange={(e) => setVersion(e.target.value)}
        className="rounded-md border border-rule bg-card px-2 py-1.5 text-sm text-ink"
      >
        {groups.map(([group, items]) =>
          group === '' ? (
            items.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)
          ) : (
            <optgroup key={group} label={group}>
              {items.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
            </optgroup>
          ))}
      </select>
    </label>
  )
}

function Shell() {
  const { pathname } = useLocation()
  const { error, loading, rescan } = useData()

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line bg-surface px-5 py-3">
        <span className="flex min-w-0 items-center gap-1">
          <Cherry />
          <span className="mr-1.5 font-semibold tracking-tight text-cherry">Pick</span>
          <span className="truncate text-sm text-muted">Every box, hand-picked.</span>
        </span>
        <nav className="flex gap-1">
          {tabs.map((t) => (
            <NavLink
              key={t.to} to={t.to} end={t.end}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm ${
                  isActive ? 'bg-ink font-semibold text-page' : 'text-ink2 hover:bg-hover'
                }`}
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {pathname !== '/' && <VersionPicker />}
          <button
            onClick={rescan}
            className="rounded-md border border-rule bg-card px-3 py-1.5 text-sm hover:bg-hover"
          >
            Rescan disk
          </button>
          <ThemeToggle />
        </div>
      </header>

      {error && (
        <p className="border-b border-line bg-no/10 px-5 py-2 text-sm text-no">{error}</p>
      )}

      <main className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <p className="p-8 text-sm text-muted">Loading…</p>
        ) : (
          <Routes>
            <Route path="/" element={<Files />} />
            <Route path="/review" element={<Review />} />
            <Route path="/fix" element={<Fix />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="*" element={<Files />} />
          </Routes>
        )}
      </main>

      <footer className="flex flex-wrap justify-center gap-x-1.5 gap-y-1 border-t border-line bg-surface px-5 py-2 text-xs text-muted">
        <span>
          Authored by{' '}
          <a href="https://shoyogin.github.io/portfolio/" target="_blank" rel="noopener noreferrer"
             className="text-ink2 underline underline-offset-2">
            Ginevra Cerri
          </a>
        </span>
        <span aria-hidden="true">·</span>
        <a href="https://github.com/shoyogin" target="_blank" rel="noopener noreferrer"
           className="text-ink2 underline underline-offset-2">
          github.com/shoyogin
        </a>
      </footer>
    </div>
  )
}

export default function App() {
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  )
}
