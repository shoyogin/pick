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
           className="inline-flex items-center gap-1 text-ink2 underline underline-offset-2">
          <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor" aria-label="GitHub">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
          shoyogin
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
