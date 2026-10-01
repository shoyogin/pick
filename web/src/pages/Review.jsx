import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import BoxOverlay from '../components/BoxOverlay'
import ConfirmDownload from '../components/ConfirmDownload'
import ClassesButton from '../components/ClassesButton'
import { useBoxesShortcut } from '../lib/classPrefs'
import { Bubble, Thread } from '../components/Thread'
import ZoomPane, { BTN, BTN_ON } from '../components/ZoomPane'
import {
  UNOWNED, getItems, getSummary, imgUrl, reviewCsvUrl, saveFlag,
} from '../lib/api'
import { classColor } from '../lib/colors'
import { bytes, nf, splitLabel, when } from '../lib/format'
import { useData } from '../lib/store'

const SHOW = [
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
const PAGE = 120

export default function Review() {
  const { version, stats, meta, classPrefs: prefs, who, nameSelf } = useData()
  const classes = stats?.classes ?? []
  useBoxesShortcut(prefs.toggleAll)

  const [split, setSplit] = useState('')
  const [mode, setMode] = useState('all')
  const [cls, setCls] = useState(() => new Set())
  const [matchAll, setMatchAll] = useState(false)
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(true)
  const [summary, setSummary] = useState({})
  const [open, setOpen] = useState(-1)

  const splits = useMemo(() => Object.keys(stats?.splits ?? {}), [stats])

  useEffect(() => {
    if (!splits.length) return
    setSplit((s) => (splits.includes(s) ? s : splits.includes('train') ? 'train' : splits[0]))
  }, [splits])

  useEffect(() => { setCls(new Set()) }, [version])

  const load = useCallback(async (offset = 0) => {
    if (!version || !split) return
    setBusy(true)
    try {
      const d = await getItems({
        v: version, split, mode, cls: [...cls].join(','),
        clsmode: matchAll ? 'all' : 'any', offset, limit: PAGE,
      })
      setTotal(d.total)
      setItems((prev) => (offset ? [...prev, ...d.items] : d.items))
    } finally {
      setBusy(false)
    }
  }, [version, split, mode, cls, matchAll])

  useEffect(() => { load(0) }, [load])

  const reloadSummary = useCallback(() => {
    if (version) getSummary(version).then(setSummary).catch(() => { })
  }, [version])
  useEffect(reloadSummary, [reloadSummary])

  const toggleClass = (i) => setCls((prev) => {
    const next = new Set(prev)
    next.has(i) ? next.delete(i) : next.add(i)
    return next
  })

  // A verdict updates the one card in place — re-fetching the page would make
  // the image you just judged jump out from under the cursor.
  const applyFlag = useCallback((name, flag) => {
    setItems((prev) => prev.map((it) => (it.name === name ? { ...it, flag } : it)))
    reloadSummary()
  }, [reloadSummary])

  const done = (summary.ok || 0) + (summary.no || 0) + (summary.review || 0)
    + (summary.deleted || 0)
  // Rejects and fixes still waiting on approval both stay out of the export.
  const held = (summary.no || 0) + (summary.review || 0) + (summary.deleted || 0)

  return (
    <div className="flex h-full">
      <aside className="w-64 shrink-0 overflow-y-auto border-r border-line bg-surface p-4">
        <Group label="Split">
          <div className="flex flex-wrap gap-1.5">
            {splits.map((s) => (
              <button
                key={s} onClick={() => setSplit(s)}
                className={`flex-1 rounded-md border px-2 py-1.5 text-xs ${s === split ? 'border-ink bg-ink font-semibold text-page'
                    : 'border-rule bg-card hover:bg-hover'}`}
              >
                {splitLabel(s)} <span className="num opacity-65">{stats.splits[s]}</span>
              </button>
            ))}
          </div>
        </Group>

        <Group label="Show">
          <select
            value={mode} onChange={(e) => setMode(e.target.value)}
            className="w-full rounded-md border border-rule bg-card px-2 py-1.5 text-sm"
          >
            {SHOW.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Group>

        <Group
          label="Classes"
          right={
            <>
              <button
                onClick={() => setMatchAll((v) => !v)}
                title="Any: the image has at least one ticked class. All: it has every one."
                className={`rounded-full border px-2 py-0.5 text-[11px] ${matchAll ? 'border-ink bg-ink text-page' : 'border-rule bg-card text-ink2'}`}
              >
                {matchAll ? 'all' : 'any'}
              </button>
              <button
                onClick={() => setCls(new Set())}
                className="rounded-full border border-rule bg-card px-2 py-0.5 text-[11px] text-ink2"
              >
                clear
              </button>
            </>
          }
        >
          <ul className="-mx-1.5 max-h-[38vh] overflow-y-auto">
            {classes.map((name, i) => (
              <li key={i}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-hover">
                  <input
                    type="checkbox" checked={cls.has(i)} onChange={() => toggleClass(i)}
                    className="size-4 accent-brand"
                  />
                  <span className="size-2.5 rounded-[2px]" style={{ background: classColor(i) }} />
                  <span className="flex-1 truncate text-sm">{name}</span>
                  <span className="num text-xs text-muted">
                    {nf(stats.class_counts[i] || 0)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </Group>

        <div className="mt-5 space-y-1 border-t border-line pt-4 text-sm">
          <Fact label="Reviewed" value={`${nf(done)} / ${nf(stats?.total || 0)}`} />
          <Fact label="OK" value={nf(summary.ok || 0)} />
          <Fact label="Review" value={nf(summary.review || 0)} accent="text-review" />
          <Fact label="Not OK" value={nf(summary.no || 0)} accent="text-no" />
          <Fact label="Deleted" value={nf(summary.deleted || 0)} accent="text-no" />
        </div>

        <div className="mt-4 space-y-2">
          <ConfirmDownload
            version={version}
            className="block cursor-pointer rounded-md bg-ink px-3 py-2 text-center text-sm font-semibold text-page hover:opacity-90"
          >
            Download reviewed dataset
            {held ? <span className="font-normal opacity-80"> — {nf(held)} left out</span> : null}
          </ConfirmDownload>
          <a
            href={reviewCsvUrl(version)} download
            className="block rounded-md border border-rule bg-card px-3 py-2 text-center text-sm hover:bg-hover"
          >
            Download review.csv
          </a>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {meta?.user_header && !meta.user && (
          <div className="border-b border-line bg-no-fill px-5 py-2 text-[13px] text-no-ink">
            <b>Nobody's name is reaching the server.</b> It is set up to take the
            reviewer from the <code>{meta.user_header}</code> header, but the proxy
            is not sending it, so verdicts and comments are being filed under
            “{UNOWNED}”. They are saved, just unattributed — worth fixing before
            reviewing further.
          </div>
        )}

        <div className="flex items-center gap-3 border-b border-line bg-surface px-5 py-2.5 text-sm">
          <strong>{version} · {splitLabel(split)}</strong>
          <span className="num text-muted">{nf(items.length)} of {nf(total)}</span>
          {busy && <span className="text-muted">loading…</span>}
          <span className="flex-1" />
          {cls.size > 0 && (
            <span className="text-xs text-muted">
              {cls.size} class{cls.size > 1 ? 'es' : ''} · {matchAll ? 'all of them' : 'any of them'}
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {total === 0 && !busy ? (
            <p className="py-20 text-center text-sm text-muted">
              Nothing matches. Try another split or clear the class filter.
            </p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3">
              {items.map((it, i) => (
                <Card key={it.name} item={it} classes={classes} hiddenClasses={prefs.hiddenIdx}
                  version={version} split={split} onOpen={() => setOpen(i)} />
              ))}
            </div>
          )}
          {items.length < total && (
            <button
              onClick={() => load(items.length)}
              className="mx-auto mt-5 block rounded-md border border-rule bg-card px-4 py-2 text-sm hover:bg-hover"
            >
              Load {nf(Math.min(PAGE, total - items.length))} more
            </button>
          )}
        </div>
      </section>

      {open >= 0 && items[open] && (
        <Viewer
          items={items} index={open} classes={classes} version={version} split={split}
          who={who} nameSelf={nameSelf} proxyUser={meta?.user}
          prefs={prefs}
          onIndex={setOpen} onClose={() => setOpen(-1)} onFlag={applyFlag}
        />
      )}
    </div>
  )
}

function Group({ label, right, children }) {
  return (
    <div className="mb-5">
      <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-ink2">
        <span>{label}</span>
        <span className="flex-1" />
        {right}
      </div>
      {children}
    </div>
  )
}

const Fact = ({ label, value, accent }) => (
  <div className="flex justify-between text-ink2">
    <span>{label}</span>
    <b className={`num font-semibold ${accent || 'text-ink'}`}>{value}</b>
  </div>
)

// Deleted shares not-OK's red; the pill text and struck filename separate them.
const PILL = {
  ok: ['OK', 'bg-ok-fill text-ok-ink'],
  no: ['not OK', 'bg-no-fill text-no-ink'],
  review: ['Review', 'bg-review-fill text-review-ink'],
  deleted: ['Deleted', 'bg-no-fill text-no-ink'],
}

const OUT = (status) => status === 'no' || status === 'deleted'

function StatusPill({ status }) {
  const pill = PILL[status]
  if (!pill) return null
  return (
    <span className={`absolute right-1.5 top-1.5 z-2 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${pill[1]}`}>
      {pill[0]}
    </span>
  )
}


function Card({ item, classes, version, split, hiddenClasses, onOpen }) {
  const status = item.flag?.status
  const notes = item.flag?.comments?.length || 0
  return (
    <figure
      onClick={onOpen}
      className={`relative m-0 cursor-pointer rounded-lg border bg-card ${OUT(status) ? 'border-no/40' : 'border-line hover:border-rule'}`}
    >
      <StatusPill status={status} />
      <div className="flex h-40 items-center justify-center overflow-hidden rounded-t-lg bg-stage">
        <div className={OUT(status) ? 'flex max-h-full max-w-full opacity-45' : 'flex max-h-full max-w-full'}>
          <BoxOverlay
            src={imgUrl(version, split, item.name, true)} alt={item.name}
            dim={item.dim} boxes={item.boxes} classes={classes}
            hiddenClasses={hiddenClasses}
          />
        </div>
      </div>
      <figcaption className={`flex items-center justify-between gap-2 rounded-b-lg border-t border-line px-2.5 py-1.5 text-xs ${status === 'ok' ? 'shadow-[inset_3px_0_0_var(--color-ok)]'
          : status === 'no' ? 'shadow-[inset_3px_0_0_var(--color-no)]'
            : status === 'review' ? 'shadow-[inset_3px_0_0_var(--color-review-fill)]'
              : status === 'deleted' ? 'shadow-[inset_3px_0_0_var(--color-no)]' : ''}`}>
        <span className={`truncate text-ink2 ${status === 'deleted' ? 'line-through' : ''}`}>
          {item.name}
        </span>
        {notes > 0 && (
          <span className="num flex shrink-0 items-center gap-1 text-muted"
            title={`${notes} comment${notes === 1 ? '' : 's'}`}>
            <Bubble />{notes}
          </span>
        )}
        {item.labeled
          ? <span className="num shrink-0 text-muted">{item.boxes.length} box{item.boxes.length === 1 ? '' : 'es'}</span>
          : <span className="shrink-0 font-medium text-no">no label</span>}
      </figcaption>
    </figure>
  )
}

function Viewer({ items, index, classes, version, split, who, nameSelf, proxyUser,
  prefs, onIndex, onClose, onFlag }) {
  const item = items[index]
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')
  const composeRef = useRef(null)

  useEffect(() => {
    setError('')
    setSaved(item.flag?.status
      ? `${item.flag.reviewer || 'anon'} · ${when(item.flag.ts)}` : '')
  }, [item])

  const status = item.flag?.status
  // Four eyes: the server refuses an OK from whoever drew the boxes, so the
  // button says so rather than letting the click fail.
  const mine = !!item.flag?.corrected &&
    item.flag.corrected_by === (who.trim() || 'anon')

  const commit = useCallback(async (verdict) => {
    setError('')
    try {
      const flag = await saveFlag({
        v: version, split, image: item.name, status: verdict, reviewer: who.trim(),
      })
      onFlag(item.name, flag)
      setSaved(`${flag.reviewer || 'anon'} · ${when(flag.ts)}`)
      // Keep moving on an OK; a rejection wants its reason typed first.
      if (verdict === 'ok' && index < items.length - 1) onIndex(index + 1)
      else if (verdict === 'no') composeRef.current?.focus()
    } catch (e) {
      setError(e.message)
    }
  }, [version, split, item, who, index, items.length, onFlag, onIndex])

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.matches('textarea, input')) {
        if (e.key === 'Escape') e.target.blur()
        return
      }
      if (e.key === 'Escape') onClose()
      if (e.key === '1') { e.preventDefault(); commit('ok') }
      if (e.key === '2') { e.preventDefault(); commit('no') }
      if (e.key === '3') { e.preventDefault(); commit(status === 'deleted' ? '' : 'deleted') }
      if (e.key === 'ArrowRight') onIndex(Math.min(index + 1, items.length - 1))
      if (e.key === 'ArrowLeft') onIndex(Math.max(index - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [commit, status, index, items.length, onIndex, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
      onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="grid h-[94vh] w-full max-w-6xl grid-cols-1 overflow-hidden rounded-xl bg-surface md:grid-cols-[1fr_320px] md:grid-rows-[minmax(0,1fr)]"
      >
        <ZoomPane
          dim={item.dim} resetKey={item.name}
          toolbarExtra={<ClassesButton classes={classes} prefs={prefs}
                                       btn={BTN} btnOn={BTN_ON} />}
        >
          {(frame) => (
            <BoxOverlay
              src={imgUrl(version, split, item.name)} alt={item.name} big size={frame}
              dim={item.dim} boxes={item.boxes} classes={classes} tagMin={[0.05, 0.03]}
              hiddenClasses={prefs.hiddenIdx}
            />
          )}
        </ZoomPane>

        <div className="flex min-h-0 flex-col border-l border-line bg-card p-4">
          {/* capped so a long box table cannot squeeze the thread to nothing */}
          <div className="max-h-[55%] shrink-0 overflow-y-auto">
          <div className="flex items-start gap-2">
            <h2 className="min-w-0 flex-1 break-all text-sm font-semibold">{item.name}</h2>
            <button onClick={onClose}
              className="rounded border border-line px-2 py-0.5 text-xs text-ink2 hover:bg-hover">
              esc
            </button>
          </div>

          <div className="mt-3 space-y-1 text-sm text-ink2">
            <Fact label="Boxes" value={item.labeled ? nf(item.boxes.length) : 'no label file'} />
            <Fact label="File size" value={bytes(item.size)} />
            {item.dim && <Fact label="Pixels" value={`${item.dim[0]} × ${item.dim[1]}`} />}
          </div>

          {item.boxes.length > 0 && (
            <table className="mt-3 w-full border-collapse text-xs">
              <thead>
                <tr className="text-muted">
                  {['class', 'x', 'y', 'w', 'h'].map((h) => (
                    <th key={h} className="border-b border-rule py-1 pr-2 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {item.boxes.map(([c, ...rest], i) => (
                  <tr key={i}>
                    <td className="border-b border-line py-1 pr-2">
                      <span className="mr-1.5 inline-block size-2.5 rounded-[2px] align-middle"
                        style={{ background: classColor(c) }} />
                      {classes[c] ?? c}
                    </td>
                    {rest.map((v, j) => (
                      <td key={j} className="num border-b border-line py-1 pr-2">{v.toFixed(3)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="mt-5 border-t border-line pt-4">
            <h3 className="mb-2 text-xs font-medium text-ink2">Is this label correct?</h3>
            {item.flag?.corrected && (
              <p className="mb-2 rounded-md px-2 py-1.5 text-[11px]"
                style={{
                  background: 'var(--color-review-fill)',
                  color: 'var(--color-review-ink)'
                }}>
                Boxes redrawn by {mine ? 'you' : item.flag.corrected_by}
                {item.flag.corrected_ts ? ` · ${when(item.flag.corrected_ts)}` : ''}.
                {mine ? ' Someone else has to accept it.' : ' Accepting puts it back in the dataset.'}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => commit('ok')} disabled={mine}
                title={mine ? 'You corrected this image — someone else has to accept it' : undefined}
                className={`flex-1 rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-45 ${status === 'ok' ? 'border-ok-fill bg-ok-fill font-semibold text-ok-ink'
                    : 'border-rule bg-card hover:bg-hover'}`}
              >
                OK
              </button>
              <button
                onClick={() => commit('no')}
                className={`flex-1 rounded-md border px-3 py-2 text-sm ${status === 'no' ? 'border-no-fill bg-no-fill font-semibold text-no-ink'
                    : 'border-rule bg-card hover:bg-hover'}`}
              >
                Not OK
              </button>
            </div>

            <button
              onClick={() => commit(status === 'deleted' ? '' : 'deleted')}
              className={`mt-2 w-full rounded-md border px-3 py-1.5 text-xs ${status === 'deleted'
                  ? 'border-no-fill bg-no-fill font-semibold text-no-ink'
                  : 'border-rule bg-card text-ink2 hover:bg-hover hover:text-no'}`}
            >
              {status === 'deleted'
                ? 'Deleted — click to restore'
                : 'Delete image'}
            </button>

            <p className={`mt-2 min-h-4 text-[11px] ${error ? 'text-no' : 'text-muted'}`}>
              {error || saved}
            </p>

            {proxyUser == null && (
              <label className="mt-2 flex items-center gap-2 text-xs text-ink2">
                Reviewer
                <input
                  value={who}
                  onChange={(e) => nameSelf(e.target.value)}
                  placeholder="your name"
                  className="flex-1 rounded-md border border-rule bg-card px-2 py-1 text-xs"
                />
              </label>
            )}
          </div>
          </div>

          <Thread
            key={item.name} item={item} version={version} split={split}
            who={who} boxRef={composeRef}
            onSaved={(flag) => onFlag(item.name, flag)}
          />

          <div className="mt-3 flex shrink-0 items-center gap-2 text-[11px] text-muted">
            <button onClick={() => onIndex(Math.max(index - 1, 0))}
              className="rounded border border-line px-2 py-0.5 hover:bg-hover">←</button>
            <button onClick={() => onIndex(Math.min(index + 1, items.length - 1))}
              className="rounded border border-line px-2 py-0.5 hover:bg-hover">→</button>
            <span>move · <b>1</b> OK · <b>2</b> not OK · <b>3</b> delete · <b>b</b> boxes · <b>esc</b> close</span>
          </div>
        </div>
      </div>
    </div>
  )
}


/** Every comment left on one image, oldest first, plus the box to add another.
 *  Comments are independent of the verdict — an image can collect a question
 *  from one reviewer and an answer from the next without anyone judging it. */


