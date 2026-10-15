import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import BoxOverlay from '../components/BoxOverlay'
import DownloadDialog from '../components/DownloadDialog'
import {
  buildZipUrl, getBuildCounts, getBuildHistory, getVersion, imgUrl, runBuild,
} from '../lib/api'
import { GREY, classColor, paletteColor } from '../lib/colors'
import { nf, splitLabel, when } from '../lib/format'
import { useData } from '../lib/store'
import { byGroup } from '../lib/versions'

const PAGE = 120

/** What happened to an image, in legend order. `faded` images were never in
 *  the running; `struck` ones were held back by review. */
const STATES = [
  { key: 'train', label: 'Train', color: paletteColor(0) },
  { key: 'val', label: 'Val', color: paletteColor(1) },
  { key: 'test', label: 'Test', color: paletteColor(6) },
  { key: 'not_taken', label: 'Not taken', color: GREY, hint: 'eligible, but the budget was reached first' },
  { key: 'unrequested', label: 'Other classes only', color: GREY, faded: true, hint: 'holds only classes that are not being balanced' },
  { key: 'duplicate', label: 'Near-duplicate', color: GREY, faded: true, hint: 'dropped by dHash: too close to a kept frame of its shot' },
  { key: 'excluded', label: 'Excluded', color: 'var(--color-no)', faded: true, struck: true, hint: 'Not OK, Deleted, waiting for approval, or never labelled' },
]
const STATE = Object.fromEntries(STATES.map((s) => [s.key, s]))

const DEFAULTS = {
  classes: null, num: 100, empty: 10, val: 0, by: 'instances', repeats: 1,
  dedup: true, hamming: 16, window: 12, seed: 42,
}

const randomSeed = () => Math.floor(Math.random() * 1_000_000)

/** What is wrong with each field, by field name. An emptied field is '' until
 *  it is typed into again, so it is caught here rather than snapping back. */
function validate(p, eligible) {
  const bad = {}
  const need = (k, ok, msg) => {
    if (p[k] === '' || !Number.isFinite(p[k])) bad[k] = 'required'
    else if (!ok(p[k])) bad[k] = msg
  }
  need('num', (v) => Number.isInteger(v) && v >= 1, 'a whole number, at least 1')
  if (!bad.num && eligible != null && p.num > eligible) {
    bad.num = `only ${nf(eligible)} eligible image${eligible === 1 ? '' : 's'} in the selected versions`
  }
  need('empty', (v) => v >= 0 && v <= 100, 'between 0 and 100')
  need('val', (v) => v >= 0 && v < 1, 'from 0 up to, not including, 1')
  need('repeats', (v) => Number.isInteger(v) && v >= 1, 'a whole number, at least 1')
  need('seed', (v) => Number.isInteger(v) && v >= 0, 'a whole number, 0 or more')
  if (p.dedup) {
    need('hamming', (v) => Number.isInteger(v) && v >= 0 && v <= 256, 'a whole number, 0 to 256')
    need('window', (v) => Number.isInteger(v) && v >= 1, 'a whole number, at least 1')
  }
  return bad
}

/** Pick a class-balanced training set from the reviewed images, see what was
 *  taken and why, and download it. Every preview lands in the build history. */
export default function Build() {
  const { versions: all, version, who } = useData()
  const [params, setParams] = useState(() => ({ ...DEFAULTS, versions: version ? [version] : [] }))
  const [classes, setClasses] = useState([])
  const [view, setView] = useState(null)
  const [ran, setRan] = useState('')          // the params of the shown preview, as JSON
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('selection')
  const [history, setHistory] = useState([])
  const [counts, setCounts] = useState({})      // version -> {total, eligible, excluded}

  const set = (patch) => setParams((p) => ({ ...p, ...patch }))

  // Fetched for a version the first time it is ticked; only the total shows.
  const asked = useRef(new Set())
  useEffect(() => {
    for (const v of params.versions) {
      if (asked.current.has(v)) continue
      asked.current.add(v)
      getBuildCounts(v)
        .then((c) => setCounts((m) => ({ ...m, [v]: c })))
        .catch(() => asked.current.delete(v))
    }
  }, [params.versions])

  // Known only once every ticked version has its count.
  const eligible = params.versions.every((v) => counts[v])
    ? params.versions.reduce((a, v) => a + counts[v].eligible, 0) : null
  const problems = validate(params, eligible)
  const held = eligible == null ? 0
    : params.versions.reduce((a, v) => a + counts[v].total - counts[v].eligible, 0)

  // Class names come from the first version; the server refuses a mix.
  const first = params.versions[0]
  useEffect(() => {
    if (!first) return setClasses([])
    getVersion(first).then((s) => setClasses(s.classes)).catch(() => setClasses([]))
  }, [first])

  const loadHistory = useCallback(() => {
    getBuildHistory().then((d) => setHistory(d.history)).catch(() => {})
  }, [])
  useEffect(loadHistory, [loadHistory])

  // What goes over the wire: no null classes, and the name to log it under.
  const request = useMemo(() => {
    const { classes: c, ...rest } = params
    return { ...rest, ...(c ? { classes: c } : {}), reviewer: who || '' }
  }, [params, who])
  const fresh = ran === JSON.stringify(request)

  const preview = async () => {
    setBusy(true)
    setError('')
    try {
      setView(await runBuild(request))
      setRan(JSON.stringify(request))
      setTab('selection')
      loadHistory()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const restore = (p) => {
    setParams({ ...DEFAULTS, ...p, classes: p.classes ?? null })
    setTab('selection')
  }

  return (
    <div className="flex h-full">
      <Options
        all={all} params={params} set={set} classes={classes}
        eligible={eligible} held={held} problems={problems}
        busy={busy} fresh={fresh} error={error} onPreview={preview}
        zip={buildZipUrl(request)} onDownload={() => setTimeout(loadHistory, 1500)}
      />
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1 border-b border-line bg-surface px-5 py-2">
          {[['selection', 'Selection'], ['history', `History · ${nf(history.length)}`]].map(([k, l]) => (
            <button
              key={k} onClick={() => setTab(k)}
              className={`rounded-md px-3 py-1 text-sm ${tab === k ? 'bg-ink font-semibold text-page' : 'text-ink2 hover:bg-hover'}`}
            >
              {l}
            </button>
          ))}
          <span className="flex-1" />
          {view && !fresh && tab === 'selection' && (
            <span className="text-xs text-review">Options changed — press Preview to update.</span>
          )}
        </div>
        {tab === 'history'
          ? <History history={history} onRestore={restore} />
          : view
            ? <Selection view={view} stale={!fresh} />
            : <p className="p-8 text-sm text-muted">
                Choose the versions and options on the left, then press <b>Preview</b>.
              </p>}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- options

function Options({ all, params, set, classes, eligible, held, problems, busy, fresh, error, onPreview, zip, onDownload }) {
  const [downloading, setDownloading] = useState(false)
  const toggleVersion = (v) => set({
    versions: params.versions.includes(v)
      ? params.versions.filter((x) => x !== v) : [...params.versions, v],
  })
  const ticked = params.classes ?? classes.map((_, i) => i)
  const toggleClass = (i) => {
    const next = ticked.includes(i) ? ticked.filter((c) => c !== i) : [...ticked, i].sort((a, b) => a - b)
    set({ classes: next.length === classes.length ? null : next })
  }

  return (
    <Resizable>
    <aside className="h-full overflow-y-auto border-r border-line bg-surface p-4 text-sm">
      <Group
        label="Versions"
        hint={params.versions.length
          ? `${eligible == null ? '…' : nf(eligible)} eligible images in ${params.versions.length} version${params.versions.length === 1 ? '' : 's'}${held ? ` (${nf(held)} held back by review)` : ''} · must share one class list`
          : 'tick at least one · must share one class list'}
      >
        {/* Tall enough for a grouped disk; drag the corner for more. */}
        <div className="h-64 min-h-24 resize-y overflow-y-auto rounded-md border border-line bg-card p-1.5">
          {byGroup(all).map(([group, vs]) => (
            <div key={group}>
              {group && <div className="px-1.5 pt-1 text-[11px] text-muted">{group}</div>}
              {vs.map(({ value, label }) => (
                <label key={value} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 hover:bg-hover">
                  <input type="checkbox" className="size-4 accent-brand"
                         checked={params.versions.includes(value)} onChange={() => toggleVersion(value)} />
                  {label}
                </label>
              ))}
            </div>
          ))}
        </div>
      </Group>

      <Group label="Images" hint="train and val together" error={problems.num}>
        <Num bad={!!problems.num} value={params.num} min={1} step={1} onChange={(num) => set({ num })} />
      </Group>

      <Group
        label="Classes to balance"
        right={params.classes && (
          <button onClick={() => set({ classes: null })}
                  className="rounded-full border border-rule bg-card px-2 py-0.5 text-[11px] text-ink2">all</button>
        )}
      >
        <ul className="-mx-1.5 max-h-44 overflow-y-auto">
          {classes.map((name, i) => (
            <li key={i}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 hover:bg-hover">
                <input type="checkbox" className="size-4 accent-brand"
                       checked={ticked.includes(i)} onChange={() => toggleClass(i)} />
                <span className="size-2.5 rounded-[2px]" style={{ background: classColor(i) }} />
                <span className="truncate">{name}</span>
              </label>
            </li>
          ))}
        </ul>
      </Group>

      <div className="grid grid-cols-2 gap-3">
        <Group label="Empty %" hint="negatives per split" error={problems.empty}>
          <Num bad={!!problems.empty} value={params.empty} min={0} max={100} step={1} onChange={(empty) => set({ empty })} />
        </Group>
        <Group label="Val fraction" hint="0 = one test list" error={problems.val}>
          <Num bad={!!problems.val} value={params.val} min={0} max={0.95} step={0.05} onChange={(val) => set({ val })} />
        </Group>
      </div>

      <Group label="Balance by">
        <div className="flex gap-1.5">
          {[['instances', 'Boxes'], ['images', 'Images']].map(([v, l]) => (
            <button key={v} onClick={() => set({ by: v })}
                    className={`flex-1 rounded-md border px-2 py-1 text-xs ${params.by === v
                      ? 'border-ink bg-ink font-semibold text-page' : 'border-rule bg-card hover:bg-hover'}`}>
              {l}
            </button>
          ))}
        </div>
      </Group>

      <Group label="Max repeats" hint="oversample rare classes in train" error={problems.repeats}>
        <Num bad={!!problems.repeats} value={params.repeats} min={1} step={1} onChange={(repeats) => set({ repeats })} />
      </Group>

      <Group label="Seed" error={problems.seed}>
        <div className="flex gap-1.5">
          <Num bad={!!problems.seed} value={params.seed} min={0} step={1} onChange={(seed) => set({ seed })} />
          <button onClick={() => set({ seed: randomSeed() })} title="New random seed"
                  className="rounded-md border border-rule bg-card px-2.5 hover:bg-hover">🎲</button>
        </div>
      </Group>

      <details className="mb-4">
        <summary className="cursor-pointer text-xs font-medium text-ink2">Near-duplicates</summary>
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input type="checkbox" className="size-4 accent-brand" checked={params.dedup}
                 onChange={(e) => set({ dedup: e.target.checked })} />
          Drop near-duplicate frames
        </label>
        {params.dedup && (
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Group label="Hamming" hint="bits of 256" error={problems.hamming}>
              <Num bad={!!problems.hamming} value={params.hamming} min={0} max={256} step={1} onChange={(hamming) => set({ hamming })} />
            </Group>
            <Group label="Window" hint="kept frames compared" error={problems.window}>
              <Num bad={!!problems.window} value={params.window} min={1} step={1} onChange={(window) => set({ window })} />
            </Group>
          </div>
        )}
      </details>

      <div className="space-y-2 border-t border-line pt-4">
        <button
          onClick={onPreview}
          disabled={busy || !params.versions.length || Object.keys(problems).length > 0}
          className="w-full rounded-md bg-ink px-3 py-2 text-sm font-semibold text-page hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Selecting…' : 'Preview'}
        </button>
        <button
          onClick={() => setDownloading(true)} disabled={!fresh}
          title={fresh ? undefined : 'Preview these options first'}
          className="block w-full rounded-md border border-rule bg-card px-3 py-2 text-center text-sm hover:bg-hover disabled:opacity-50"
        >
          Download dataset (.zip)
        </button>
        {downloading && (
          <DownloadDialog
            title={`Download ${nf(params.num)} images, seed ${params.seed}`}
            url={zip} filename={`pick-${params.num}-seed${params.seed}.zip`}
            onStart={onDownload} onClose={() => setDownloading(false)}
          >
            <p className="mt-2 text-sm text-ink2">
              The selection you previewed, rebuilt from the same seed. A terminal
              download is logged to the history too.
            </p>
          </DownloadDialog>
        )}
        <p className="text-[11px] text-muted">
          Images with their reviewed labels, train/val (or test) lists, data.yaml
          and manifest.json. Not OK, Deleted and unaccepted fixes never make it in.
        </p>
        {error && <p className="text-[11px] text-no">{error}</p>}
      </div>
    </aside>
    </Resizable>
  )
}

const SIDE = { min: 240, max: 640, initial: 288, key: 'build-sidebar' }

/** The sidebar, widened or narrowed by dragging its right edge. The width is a
 *  per-browser convenience, so storage failing just means the default. */
function Resizable({ children }) {
  const [width, setWidth] = useState(() => {
    try { return Number(localStorage.getItem(SIDE.key)) || SIDE.initial } catch { return SIDE.initial }
  })
  const drag = useRef(null)

  const down = (e) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, w: width }
  }
  const move = (e) => {
    if (!drag.current) return
    const w = Math.min(SIDE.max, Math.max(SIDE.min, drag.current.w + e.clientX - drag.current.x))
    setWidth(w)
  }
  const up = () => {
    if (!drag.current) return
    drag.current = null
    try { localStorage.setItem(SIDE.key, String(width)) } catch { /* default next time */ }
  }

  return (
    <div className="relative h-full shrink-0" style={{ width }}>
      {children}
      <div
        role="separator" aria-orientation="vertical" aria-label="Resize the options panel"
        title="Drag to resize · double-click to reset"
        onPointerDown={down} onPointerMove={move} onPointerUp={up}
        onDoubleClick={() => {
          setWidth(SIDE.initial)
          try { localStorage.removeItem(SIDE.key) } catch { /* nothing stored */ }
        }}
        className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize hover:bg-brand/30 active:bg-brand/50"
      />
    </div>
  )
}

function Group({ label, hint, error, right, children }) {
  return (
    <div className="mb-4">
      <div className="mb-1 flex items-baseline gap-2 text-xs font-medium text-ink2">
        <span>{label}</span>
        <span className="flex-1" />
        {right}
      </div>
      {children}
      {error ? <p className="mt-1 text-[11px] text-no">{error}</p>
        : hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  )
}

/** A number field that can be emptied: '' stays '' until something valid is
 *  typed, instead of the last value snapping back. */
const Num = ({ value, onChange, bad, ...rest }) => (
  <input
    type="number" value={value} {...rest} aria-invalid={bad || undefined}
    onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
    className={`num w-full rounded-md border bg-card px-2 py-1 ${bad ? 'border-no' : 'border-rule'}`}
  />
)

// ---------------------------------------------------------------- selection

function Selection({ view, stale }) {
  const [show, setShow] = useState(() => new Set())     // states
  const [cls, setCls] = useState(() => new Set())       // classes
  const [matchAll, setMatchAll] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [open, setOpen] = useState(null)
  useEffect(() => { setShow(new Set()); setCls(new Set()); setLimit(PAGE) }, [view])
  useEffect(() => { setLimit(PAGE) }, [show, cls, matchAll])

  const hasClass = useCallback((it) => {
    if (!cls.size) return true
    const have = new Set(it.boxes.map((b) => b[0]))
    return matchAll ? [...cls].every((c) => have.has(c)) : [...cls].some((c) => have.has(c))
  }, [cls, matchAll])
  const hasState = useCallback((it) => !show.size || show.has(it.state), [show])

  // Each row of chips counts what the *other* filter lets through, so a chip
  // says how many images clicking it would show.
  const stateCounts = useMemo(() => {
    const c = {}
    for (const it of view.items) if (hasClass(it)) c[it.state] = (c[it.state] || 0) + 1
    return c
  }, [view, hasClass])
  const classCounts = useMemo(() => {
    const c = {}
    for (const it of view.items) {
      if (!hasState(it)) continue
      for (const k of new Set(it.boxes.map((b) => b[0]))) c[k] = (c[k] || 0) + 1
    }
    return c
  }, [view, hasState])
  const shown = useMemo(
    () => view.items.filter((it) => hasState(it) && hasClass(it)),
    [view, hasState, hasClass])

  const flip = (setter) => (k) => setter((prev) => {
    const next = new Set(prev)
    next.has(k) ? next.delete(k) : next.add(k)
    return next
  })
  const toggle = flip(setShow)
  const toggleClass = flip(setCls)
  const chip = (on) => `flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${on
    ? 'border-ink bg-ink text-page' : 'border-rule bg-card text-ink2 hover:bg-hover'}`

  return (
    <div className={`min-h-0 flex-1 overflow-y-auto p-4 ${stale ? 'opacity-70' : ''}`}>
      <Report view={view} />

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="w-14 text-xs text-muted">State</span>
        {STATES.filter((s) => stateCounts[s.key] || show.has(s.key)).map((s) => (
          <button key={s.key} onClick={() => toggle(s.key)} title={s.hint} className={chip(show.has(s.key))}>
            <span className="size-2.5 rounded-full" style={{ background: s.color }} />
            {s.label} <span className="num opacity-70">{nf(stateCounts[s.key] || 0)}</span>
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="w-14 text-xs text-muted">Classes</span>
        {view.classes.map((name, i) => (classCounts[i] || cls.has(i)) && (
          <button key={i} onClick={() => toggleClass(i)} className={chip(cls.has(i))}>
            <span className="size-2.5 rounded-[2px]" style={{ background: classColor(i) }} />
            {name} <span className="num opacity-70">{nf(classCounts[i] || 0)}</span>
          </button>
        ))}
        {cls.size > 1 && (
          <button onClick={() => setMatchAll((v) => !v)}
                  title="Any: the image has at least one ticked class. All: it has every one."
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${matchAll
                    ? 'border-ink bg-ink text-page' : 'border-rule bg-card text-ink2'}`}>
            {matchAll ? 'all of them' : 'any of them'}
          </button>
        )}
        <span className="flex-1" />
        <span className="num text-xs text-muted">{nf(shown.length)} of {nf(view.items.length)} shown</span>
        {(show.size > 0 || cls.size > 0) && (
          <button onClick={() => { setShow(new Set()); setCls(new Set()) }}
                  className="text-xs text-muted underline">clear filters</button>
        )}
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {shown.slice(0, limit).map((it) => (
          <Card key={`${it.v}|${it.split}|${it.name}`} item={it} classes={view.classes}
                onOpen={() => setOpen(it)} />
        ))}
      </div>
      {shown.length > limit && (
        <button onClick={() => setLimit((l) => l + PAGE)}
                className="mx-auto mt-4 block rounded-md border border-rule bg-card px-4 py-1.5 text-sm hover:bg-hover">
          Show more · {nf(shown.length - limit)} left
        </button>
      )}
      {open && <Detail item={open} classes={view.classes} onClose={() => setOpen(null)} />}
    </div>
  )
}

function Card({ item, classes, onOpen }) {
  const s = STATE[item.state] || STATE.not_taken
  const picked = item.repeats > 0
  return (
    <figure
      onClick={onOpen} title={item.reason || s.label}
      className="relative m-0 cursor-pointer rounded-lg border-2 bg-card"
      style={{ borderColor: picked ? s.color : 'var(--color-line)' }}
    >
      <div className="absolute top-1.5 left-1.5 z-10 flex gap-1">
        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
              style={{ background: s.color, color: picked ? '#fff' : 'var(--color-ink)' }}>
          {s.label}
        </span>
        {item.repeats > 1 && (
          <span className="rounded bg-ink px-1.5 py-0.5 text-[10px] font-semibold text-page">×{item.repeats}</span>
        )}
        {picked && !item.boxes.length && (
          <span className="rounded border border-rule bg-card px-1.5 py-0.5 text-[10px]">empty</span>
        )}
      </div>
      <div className="flex h-32 items-center justify-center overflow-hidden rounded-t-md bg-stage">
        <div className={`flex max-h-full max-w-full ${s.faded ? 'opacity-35 grayscale' : ''}`}>
          <BoxOverlay src={imgUrl(item.v, item.split, item.name, true)} alt={item.name}
                      dim={item.dim} boxes={item.boxes} classes={classes} />
        </div>
      </div>
      <figcaption className="flex items-center gap-2 border-t border-line px-2 py-1 text-[11px]">
        <span className={`min-w-0 flex-1 truncate text-ink2 ${s.struck ? 'line-through' : ''}`}>{item.name}</span>
        <span className="shrink-0 text-muted">{splitLabel(item.split)}</span>
      </figcaption>
    </figure>
  )
}

function Detail({ item, classes, onClose }) {
  const s = STATE[item.state] || STATE.not_taken
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-surface">
        <div className="flex h-[70vh] items-center justify-center bg-stage p-2">
          {/* Scaled up as well as down: a small frame should still fill the viewer. */}
          <div className="max-h-full max-w-full"
               style={{ height: '100%', aspectRatio: item.dim ? `${item.dim[0]} / ${item.dim[1]}` : '4 / 3' }}>
          <BoxOverlay src={imgUrl(item.v, item.split, item.name)} alt={item.name} big
                      size={{ width: '100%', height: '100%' }}
                      dim={item.dim} boxes={item.boxes} classes={classes} tagMin={[0.05, 0.03]} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-sm">
          <span className="rounded px-2 py-0.5 text-xs font-semibold"
                style={{ background: s.color, color: item.repeats ? '#fff' : 'var(--color-ink)' }}>
            {s.label}{item.repeats > 1 ? ` ×${item.repeats}` : ''}
          </span>
          <b className="break-all">{item.name}</b>
          <span className="text-muted">{item.v} · {splitLabel(item.split)}</span>
          {item.reason && <span className="text-ink2">{item.reason}</span>}
          {item.status && <span className="text-muted">review: {item.status}</span>}
          <span className="flex-1" />
          <button onClick={onClose} className="rounded border border-line px-2 py-0.5 text-xs text-ink2 hover:bg-hover">esc</button>
        </div>
      </div>
    </div>
  )
}

/** The script's console report, per split. */
function Report({ view }) {
  const r = view.report
  const sides = ['train', 'val', 'test'].filter((k) => r[k])
  return (
    <div className="mb-4 space-y-3">
      <p className="text-xs text-muted">
        {nf(r.scan.candidates)} images · {nf(r.scan.excluded)} excluded by review ·{' '}
        {nf(r.scan.duplicates)} near-duplicates dropped · {nf(r.scan.kept)} kept in {nf(r.scan.shots)} shots ·{' '}
        {nf(r.scan.empty)} empty
        {r.scan.unrequested_only ? ` · ${nf(r.scan.unrequested_only)} with other classes only` : ''}
      </p>
      <div className={`grid gap-3 ${sides.length > 1 ? 'lg:grid-cols-2' : ''}`}>
        {sides.map((k) => {
          const s = r[k]
          return (
            <div key={k} className="rounded-lg border border-line bg-card p-4">
              <div className="mb-2 flex items-baseline gap-2">
                <span className="size-2.5 rounded-full" style={{ background: STATE[k].color }} />
                <b className="text-sm">{STATE[k].label}</b>
                <span className="num text-sm">{nf(s.images)} images</span>
                {s.unique_images !== s.images && <span className="text-xs text-muted">({nf(s.unique_images)} unique)</span>}
                <span className="flex-1" />
                {s.imbalance != null && (
                  <span className={`text-xs ${s.imbalance >= 2 ? 'text-no' : 'text-muted'}`}>
                    imbalance {s.imbalance.toFixed(2)}×
                  </span>
                )}
              </div>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="text-muted">
                    <th className="border-b border-rule py-1 text-left font-medium">class</th>
                    <th className="border-b border-rule py-1 text-right font-medium">available</th>
                    <th className="border-b border-rule py-1 text-right font-medium">selected ({s.unit === 'instances' ? 'boxes' : 'images'})</th>
                    {r.val_share && <th className="border-b border-rule py-1 text-right font-medium">in val</th>}
                  </tr>
                </thead>
                <tbody>
                  {s.classes.map((c) => (
                    <tr key={c.id}>
                      <td className="border-b border-line py-1">
                        <span className="mr-1.5 inline-block size-2.5 rounded-[2px] align-middle"
                              style={{ background: classColor(c.id) }} />
                        {c.name}
                        {c.exhausted && <span className="ml-1.5 text-review" title="every image of this class is used">all used</span>}
                      </td>
                      <td className="num border-b border-line py-1 text-right text-muted">{nf(c.available)}</td>
                      <td className="num border-b border-line py-1 text-right font-semibold">{nf(c.selected)}</td>
                      {r.val_share && (
                        <td className="num border-b border-line py-1 text-right text-muted">
                          {r.val_share[c.name] == null ? '–' : `${Math.round(r.val_share[c.name] * 100)}%`}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-muted">
                Empty: {nf(s.empty.selected)} of {nf(s.empty.requested)} requested ({nf(s.empty.available)} available)
                {s.labeled.selected < s.labeled.requested && (
                  <span className="text-no"> · only {nf(s.labeled.selected)} of {nf(s.labeled.requested)} labelled
                    images could be selected — raise max repeats or lower the image count</span>
                )}
                {Object.keys(s.unrequested_in_selected).length > 0 && (
                  <> · also contains {Object.entries(s.unrequested_in_selected).map(([n, k]) => `${n} (${k})`).join(', ')}</>
                )}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- history

function History({ history, onRestore }) {
  if (!history.length) {
    return <p className="p-8 text-sm text-muted">No builds yet. Every preview and download is listed here.</p>
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="text-left text-muted">
            {['when', 'who', '', 'seed', 'versions', 'options', 'result', ''].map((h, i) => (
              <th key={i} className="border-b border-rule py-1.5 pr-3 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {history.map((h) => {
            const p = h.params
            return (
              <tr key={h.id} className="align-top">
                <td className="num border-b border-line py-1.5 pr-3 whitespace-nowrap">{when(h.ts)}</td>
                <td className="border-b border-line py-1.5 pr-3">{h.reviewer}</td>
                <td className="border-b border-line py-1.5 pr-3">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${h.kind === 'download'
                    ? 'bg-ink text-page' : 'border border-rule text-ink2'}`}>{h.kind}</span>
                </td>
                <td className="num border-b border-line py-1.5 pr-3 font-semibold">{p.seed}</td>
                <td className="border-b border-line py-1.5 pr-3">{p.versions.join(', ')}</td>
                <td className="border-b border-line py-1.5 pr-3 text-ink2">
                  {nf(p.num)} images · empty {p.empty}% · val {p.val} · by {p.by}
                  {p.repeats > 1 ? ` · repeats ${p.repeats}` : ''}
                  {p.dedup ? ` · dedup ${p.hamming}/${p.window}` : ' · no dedup'}
                  {p.classes ? ` · ${p.classes.length} classes` : ''}
                </td>
                <td className="border-b border-line py-1.5 pr-3 text-ink2">
                  {Object.entries(h.summary).map(([k, s]) => (
                    <div key={k}>{k} {nf(s.images)}{s.imbalance != null ? ` · ${s.imbalance.toFixed(2)}×` : ''}</div>
                  ))}
                </td>
                <td className="border-b border-line py-1.5">
                  <button onClick={() => onRestore(p)}
                          className="rounded-md border border-rule bg-card px-2 py-0.5 hover:bg-hover">Restore</button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
