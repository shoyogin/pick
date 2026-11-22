import { useCallback, useEffect, useMemo, useState } from 'react'
import BoxOverlay from '../components/BoxOverlay'
import {
  getVlmResults, getVlmStatus, imgUrl, pingVlm, startVlm, stopVlm, vlmCsvUrl, vlmOverlayUrl,
} from '../lib/api'
import { GREY } from '../lib/colors'
import { nf, pct, splitLabel } from '../lib/format'
import { useData } from '../lib/store'

const PAGE = 120

/** What the model said, as a card colour. */
const VERDICT = {
  ok: { label: 'Model: OK', color: 'var(--color-ok)' },
  not_ok: { label: 'Model: not OK', color: 'var(--color-no)' },
  error: { label: 'Error', color: 'var(--color-review-fill)' },
  none: { label: 'Not checked', color: GREY },
}
const HUMAN = { ok: 'OK', no: 'not OK', review: 'Review', deleted: 'Deleted' }
const SCOPES = [
  ['todo', 'Not checked by the model yet'],
  ['unreviewed', 'Not reviewed by a person yet'],
  ['all', 'Every image (re-check)'],
]
const ISSUE_LABEL = {
  missing_box: 'missing box', wrong_class: 'wrong class', loose_box: 'loose box',
  false_positive: 'false positive', duplicate: 'duplicate', other: 'other',
}

const verdictOf = (it) => it.vlm?.verdict ?? 'none'
// A person's Not OK or Deleted is a "no"; the model's verdict is ok / not_ok.
const disagrees = (it) => {
  const h = { ok: 'ok', no: 'no', deleted: 'no' }[it.human]
  const m = it.vlm?.verdict
  return h && (m === 'ok' || m === 'not_ok') && (h === 'ok') !== (m === 'ok')
}

/** A vision model's second opinion on the labels of one split. Advisory only:
 *  its results sit beside the review log, never in it. */
export default function Vlm() {
  const { version, stats, who } = useData()
  const splits = useMemo(() => Object.keys(stats?.splits ?? {}), [stats])
  const [split, setSplit] = useState('')
  const [status, setStatus] = useState(null)
  const [data, setData] = useState(null)
  const [scope, setScope] = useState('todo')
  const [limit, setLimit] = useState('')
  const [error, setError] = useState('')
  const [ping, setPing] = useState(null)

  useEffect(() => {
    if (!splits.length) return
    setSplit((s) => (splits.includes(s) ? s : splits.includes('train') ? 'train' : splits[0]))
  }, [splits])

  const loadStatus = useCallback(() => getVlmStatus().then(setStatus).catch(() => {}), [])
  const loadResults = useCallback(() => {
    if (version && split) getVlmResults(version, split).then(setData).catch((e) => setError(e.message))
  }, [version, split])
  useEffect(() => { loadStatus() }, [loadStatus])
  useEffect(() => { setData(null); loadResults() }, [loadResults])

  // While a run is going, follow it; results fill in as they land.
  const running = !!status?.job?.running
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => { loadStatus(); loadResults() }, 1500)
    return () => clearInterval(t)
  }, [running, loadStatus, loadResults])
  // One last refresh when a run ends, so its final results show.
  useEffect(() => { if (!running) loadResults() }, [running, loadResults])

  const start = async () => {
    setError('')
    try {
      await startVlm({ v: version, split, scope, limit: limit === '' ? null : Number(limit), reviewer: who || '' })
      loadStatus()
    } catch (e) {
      setError(e.message)
    }
  }
  const test = async () => {
    setPing({ busy: true })
    try { setPing(await pingVlm()) } catch (e) { setPing({ error: e.message }) }
  }

  if (!status) return <p className="p-8 text-sm text-muted">Loading…</p>
  if (!status.configured) return <Setup />

  const job = status.job
  const here = job && job.version === version && job.split === split

  return (
    <div className="flex h-full">
      <aside className="w-72 shrink-0 overflow-y-auto border-r border-line bg-surface p-4 text-sm">
        <Group label="Model">
          <div className="rounded-md border border-line bg-card px-2.5 py-2 text-xs">
            <div className="font-semibold break-all">{status.model}</div>
            <div className="text-muted">
              {status.server} · {status.workers} at a time
              {status.thinking != null && <> · thinking {status.thinking ? 'on' : 'off'}</>}
            </div>
            <button onClick={test} disabled={ping?.busy}
                    className="mt-2 rounded border border-rule px-2 py-0.5 hover:bg-hover disabled:opacity-50">
              {ping?.busy ? 'Testing…' : 'Test connection'}
            </button>
            {ping && !ping.busy && (
              <p className={`mt-1.5 ${ping.error || !ping.sees_images ? 'text-no' : 'text-ok'}`}>
                {ping.error
                  ? ping.error
                  : ping.sees_images
                    ? `Sees images ✓ — answered “${ping.answer}” in ${(ping.ms / 1000).toFixed(1)} s`
                    : `Answered “${ping.answer}” but missed the red test image — is this a vision model?`}
              </p>
            )}
          </div>
        </Group>

        <Group label="Split">
          <div className="flex flex-wrap gap-1.5">
            {splits.map((s) => (
              <button key={s} onClick={() => setSplit(s)}
                      className={`flex-1 rounded-md border px-2 py-1.5 text-xs ${s === split
                        ? 'border-ink bg-ink font-semibold text-page' : 'border-rule bg-card hover:bg-hover'}`}>
                {splitLabel(s)} <span className="num opacity-65">{stats.splits[s]}</span>
              </button>
            ))}
          </div>
        </Group>

        <Group label="Check">
          <select value={scope} onChange={(e) => setScope(e.target.value)}
                  className="w-full rounded-md border border-rule bg-card px-2 py-1.5 text-sm">
            {SCOPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Group>

        <Group label="At most" hint="leave empty for all of them — try 20 first">
          <input type="number" min={1} value={limit} placeholder="all"
                 onChange={(e) => setLimit(e.target.value)}
                 className="num w-full rounded-md border border-rule bg-card px-2 py-1" />
        </Group>

        {running ? (
          <button onClick={() => stopVlm().then(loadStatus)}
                  className="w-full rounded-md border border-no px-3 py-2 text-sm font-semibold text-no hover:bg-hover">
            Stop
          </button>
        ) : (
          <button onClick={start} disabled={!version || !split}
                  className="w-full rounded-md bg-ink px-3 py-2 text-sm font-semibold text-page hover:opacity-90 disabled:opacity-40">
            Check with the model
          </button>
        )}
        {job && <Progress job={job} here={here} />}
        {error && <p className="mt-2 text-[11px] text-no">{error}</p>}

        <p className="mt-4 text-[11px] text-muted">
          A second opinion only: nothing here changes a verdict. Each image is sent
          with its boxes drawn and numbered, exactly as shown when you open it.
        </p>
        {data?.summary.checked > 0 && (
          <a href={vlmCsvUrl(version, split)} download
             className="mt-3 block rounded-md border border-rule bg-card px-3 py-2 text-center text-sm hover:bg-hover">
            Download report (.csv)
          </a>
        )}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-line bg-surface px-5 py-2.5 text-sm">
          <strong>{version} · {splitLabel(split)}</strong>
          {data && <span className="num text-muted">{nf(data.summary.checked)} of {nf(data.summary.total)} checked</span>}
        </div>
        {data ? <Results data={data} version={version} split={split} /> : <p className="p-8 text-sm text-muted">Loading…</p>}
      </section>
    </div>
  )
}

function Setup() {
  return (
    <div className="mx-auto max-w-xl p-8 text-sm text-ink2">
      <h1 className="mb-2 text-base font-semibold text-ink">No vision model configured</h1>
      <p>Pick talks to any OpenAI-compatible endpoint. Its address and key live in an
        untracked file, so they never reach the repository:</p>
      <pre className="my-3 overflow-x-auto rounded-md border border-line bg-surface p-3 text-xs">
{`cp vlm.env.example vlm.env
\${EDITOR:-nano} vlm.env          # VLM_BASE_URL, VLM_API_KEY, VLM_MODEL
docker compose up -d pick       # or restart python3 pick.py`}
      </pre>
      <p>Then reload this page.</p>
    </div>
  )
}

function Progress({ job, here }) {
  const share = job.total ? job.done / job.total : 0
  return (
    <div className="mt-3 text-[11px] text-muted">
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full bg-brand transition-all" style={{ width: `${share * 100}%` }} />
      </div>
      <p className="mt-1">
        {job.running ? 'Checking' : job.stopped ? 'Stopped at' : 'Done:'} {nf(job.done)} / {nf(job.total)}
        {!here && <> in {job.version} · {splitLabel(job.split)}</>}
        {job.errors > 0 && <span className="text-no"> · {nf(job.errors)} failed</span>}
        {job.done > 0 && <> · {((((job.finished ?? Date.now() / 1000) - job.started) / job.done)).toFixed(1)} s/image</>}
      </p>
      {job.last_error && <p className="mt-0.5 text-no">{job.last_error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------- results

const FILTERS = [
  ['not_ok', 'Model: not OK', (it) => verdictOf(it) === 'not_ok'],
  ['ok', 'Model: OK', (it) => verdictOf(it) === 'ok'],
  ['error', 'Error', (it) => verdictOf(it) === 'error'],
  ['none', 'Not checked', (it) => verdictOf(it) === 'none'],
  ['disagree', 'Disagrees with a person', disagrees],
]

function Results({ data, version, split }) {
  const [filter, setFilter] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [open, setOpen] = useState(null)
  useEffect(() => { setLimit(PAGE) }, [filter, version, split])

  const counts = useMemo(() => Object.fromEntries(
    FILTERS.map(([k, , f]) => [k, data.items.filter(f).length])), [data])
  const shown = useMemo(() => {
    const f = FILTERS.find(([k]) => k === filter)?.[2]
    return f ? data.items.filter(f) : data.items
  }, [data, filter])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <Agreement data={data} />

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {FILTERS.filter(([k]) => counts[k] || filter === k).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(filter === k ? '' : k)}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${filter === k
                    ? 'border-ink bg-ink text-page' : 'border-rule bg-card text-ink2 hover:bg-hover'}`}>
            {VERDICT[k] && <span className="size-2.5 rounded-full" style={{ background: VERDICT[k].color }} />}
            {label} <span className="num opacity-70">{nf(counts[k])}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        {shown.slice(0, limit).map((it) => (
          <Card key={it.name} item={it} classes={data.classes} version={version} split={split}
                onOpen={() => setOpen(it)} />
        ))}
      </div>
      {shown.length > limit && (
        <button onClick={() => setLimit((l) => l + PAGE)}
                className="mx-auto mt-4 block rounded-md border border-rule bg-card px-4 py-1.5 text-sm hover:bg-hover">
          Show more · {nf(shown.length - limit)} left
        </button>
      )}
      {open && <Detail item={open} version={version} split={split} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** How often the model matches a person, on images both have judged. */
function Agreement({ data }) {
  const { summary: s, agreement: a } = data
  const both = a['ok/ok'] + a['ok/not_ok'] + a['no/ok'] + a['no/not_ok']
  const agreed = a['ok/ok'] + a['no/not_ok']
  return (
    <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto]">
      <div className="grid grid-cols-4 gap-3">
        {[['Checked', `${nf(s.checked)} / ${nf(s.total)}`], ['Model: OK', nf(s.ok)],
          ['Model: not OK', nf(s.not_ok)], ['Errors', nf(s.error)]].map(([l, v]) => (
          <div key={l} className="rounded-lg border border-line bg-card px-4 py-3">
            <div className="text-xs text-ink2">{l}</div>
            <div className="num mt-0.5 text-xl font-semibold">{v}</div>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-line bg-card px-4 py-3 text-xs">
        <div className="mb-1.5 flex gap-2 text-ink2">
          <span>Against people</span><span className="flex-1" />
          <b className="text-ink">{both ? `${pct(agreed, both, 0)} agree` : 'nothing to compare yet'}</b>
        </div>
        <table className="num border-collapse">
          <thead><tr className="text-muted"><th /><th className="px-2 font-medium">model OK</th><th className="px-2 font-medium">model not OK</th></tr></thead>
          <tbody>
            <tr><td className="pr-2 text-muted">person OK</td>
              <td className="px-2 text-center font-semibold">{a['ok/ok']}</td>
              <td className="px-2 text-center text-no">{a['ok/not_ok']}</td></tr>
            <tr><td className="pr-2 text-muted">person not OK</td>
              <td className="px-2 text-center text-no">{a['no/ok']}</td>
              <td className="px-2 text-center font-semibold">{a['no/not_ok']}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Card({ item, classes, version, split, onOpen }) {
  const v = VERDICT[verdictOf(item)]
  const issues = item.vlm?.issues?.length || 0
  return (
    <figure onClick={onOpen} title={item.vlm?.reason || v.label}
            className="relative m-0 cursor-pointer rounded-lg border-2 bg-card"
            style={{ borderColor: item.vlm ? v.color : 'var(--color-line)' }}>
      <div className="absolute top-1.5 left-1.5 z-10 flex gap-1">
        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ background: v.color, color: item.vlm ? '#fff' : 'var(--color-ink)' }}>{v.label}</span>
        {item.human && (
          <span className={`rounded border bg-card px-1.5 py-0.5 text-[10px] ${disagrees(item) ? 'border-no text-no' : 'border-rule text-ink2'}`}>
            person: {HUMAN[item.human] ?? item.human}
          </span>
        )}
      </div>
      <div className="flex h-36 items-center justify-center overflow-hidden rounded-t-md bg-stage">
        <div className="flex max-h-full max-w-full">
          <BoxOverlay src={imgUrl(version, split, item.name, true)} alt={item.name}
                      dim={item.dim} boxes={item.boxes} classes={classes} />
        </div>
      </div>
      <figcaption className="border-t border-line px-2 py-1.5 text-[11px]">
        <div className="flex gap-2">
          <span className="min-w-0 flex-1 truncate text-ink2">{item.name}</span>
          {issues > 0 && <span className="shrink-0 text-no">{issues} issue{issues > 1 ? 's' : ''}</span>}
        </div>
        {item.vlm?.reason && <div className="truncate text-muted">{item.vlm.reason}</div>}
      </figcaption>
    </figure>
  )
}

function Detail({ item, version, split, onClose }) {
  const r = item.vlm
  const v = VERDICT[verdictOf(item)]
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           className="grid max-h-full w-full max-w-6xl grid-cols-1 overflow-hidden rounded-xl bg-surface md:grid-cols-[1fr_340px]">
        <div className="flex h-[70vh] items-center justify-center bg-stage p-2">
          {/* The overlay the model was sent: box numbers match the issues. */}
          <img src={vlmOverlayUrl(version, split, item.name)} alt={item.name}
               className="size-full object-contain" />
        </div>
        <div className="flex min-h-0 flex-col overflow-y-auto border-l border-line bg-card p-4 text-sm">
          <div className="flex items-start gap-2">
            <h2 className="min-w-0 flex-1 font-semibold break-all">{item.name}</h2>
            <button onClick={onClose} className="rounded border border-line px-2 py-0.5 text-xs text-ink2 hover:bg-hover">esc</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            <span className="rounded px-2 py-0.5 font-semibold"
                  style={{ background: v.color, color: r ? '#fff' : 'var(--color-ink)' }}>{v.label}</span>
            <span className="rounded border border-rule px-2 py-0.5 text-ink2">
              person: {item.human ? HUMAN[item.human] ?? item.human : 'not reviewed'}
            </span>
          </div>
          {r ? (
            <>
              {r.reason && <p className="mt-3 text-ink2">{r.reason}</p>}
              {r.issues?.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {r.issues.map((x, i) => (
                    <li key={i} className="rounded-md border border-line px-2.5 py-1.5 text-xs">
                      <b>{ISSUE_LABEL[x.type] ?? x.type}</b>
                      {x.box ? <> · box {x.box}</> : null}
                      {x.class ? <> · {x.class}</> : null}
                      {x.note && <div className="text-muted">{x.note}</div>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-auto pt-4 text-[11px] text-muted">
                {r.model} · {r.ms ? `${(r.ms / 1000).toFixed(1)} s` : ''} · {r.ts?.replace('T', ' ').slice(0, 16)}
                {r.by ? ` · run by ${r.by}` : ''}
              </p>
            </>
          ) : (
            <p className="mt-3 text-muted">The model has not checked this image yet.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function Group({ label, hint, children }) {
  return (
    <div className="mb-4">
      <div className="mb-1 text-xs font-medium text-ink2">{label}</div>
      {children}
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  )
}
