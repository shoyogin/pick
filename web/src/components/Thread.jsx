import { useState } from 'react'
import { UNOWNED, addComment, deleteComment, editComment } from '../lib/api'
import { when } from '../lib/format'

/** Small speech bubble. Drawn rather than set in type: the caption line is
 *  already carrying a filename and a count, and a glyph reads faster there. */
export const Bubble = ({ className = '' }) => (
  <svg viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor"
    strokeWidth="1.1" strokeLinejoin="round"
    className={`size-3 shrink-0 ${className}`}>
    <path d="M1.8 2.2h8.4v5.4H5.4L3 9.8V7.6H1.8z" />
  </svg>
)

export function Thread({ item, version, split, who, boxRef, onSaved }) {
  const comments = item.flag?.comments ?? []
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const me = who.trim() || 'anon'
  // A comment the proxy failed to attribute belongs to nobody, and the server
  // lets anyone tidy those up. Mirror that here or the buttons never appear.
  const mine = (c) => (c.reviewer || 'anon') === me || c.reviewer === UNOWNED

  const save = async (id, text) => {
    onSaved(await editComment({
      v: version, split, image: item.name, id, text, reviewer: who.trim(),
    }))
  }

  const send = async () => {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    setError('')
    try {
      onSaved(await addComment({
        v: version, split, image: item.name, text: body, reviewer: who.trim(),
      }))
      setText('')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id) => {
    setError('')
    try {
      onSaved(await deleteComment({
        v: version, split, image: item.name, id, reviewer: who.trim(),
      }))
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-line pt-3">
      <h3 className="mb-2 flex shrink-0 items-center gap-1.5 text-xs font-medium text-ink2">
        <Bubble />
        Comments {comments.length > 0 && <span className="num">({comments.length})</span>}
      </h3>

      {comments.length === 0 ? (
        <p className="min-h-0 flex-1 text-[11px] text-muted">None yet.</p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
          {comments.map((c) => (
            <Comment
              key={c.id} c={c} mine={mine(c)}
              onEdit={(text) => save(c.id, text)} onDelete={() => remove(c.id)}
            />
          ))}
        </ul>
      )}

      <div className="shrink-0 pt-2">
      <textarea
        ref={boxRef} value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter alone has to stay a newline: these run to several lines.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() }
        }}
        placeholder="box is off, wrong class, blurred…"
        className="min-h-[58px] w-full resize-y rounded-md border border-rule bg-card p-2 text-sm"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={send} disabled={busy || !text.trim()}
          className="rounded-md border border-rule bg-card px-2.5 py-1 text-xs hover:bg-hover disabled:opacity-45"
        >
          {busy ? 'Saving…' : 'Add comment'}
        </button>
        <span className="text-[11px] text-muted">⌘↵ / ctrl↵</span>
      </div>

      {error && <p className="mt-1 text-[11px] text-no">{error}</p>}
      <p className="mt-2 text-[11px] text-muted">
        Every comment on an image marked not OK travels with it into EXCLUDED.csv.
      </p>
      </div>
    </div>
  )
}


/** One comment, readable until you click edit. Only the author's own comments
 *  offer the buttons; the server enforces the same rule regardless. */
function Comment({ c, mine, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(c.text)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const start = () => { setDraft(c.text); setError(''); setEditing(true) }

  const commit = async () => {
    const text = draft.trim()
    if (!text || busy) return
    if (text === c.text) return setEditing(false)
    setBusy(true)
    try {
      await onEdit(text)
      setEditing(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const drop = async () => {
    setError('')
    try {
      await onDelete()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <li className="rounded-md border border-line bg-page px-2.5 py-1.5">
      <div className="flex items-baseline gap-2 text-[11px] text-muted">
        <b className="font-semibold text-ink2">{c.reviewer || 'anon'}</b>
        <span className="num">{when(c.ts)}</span>
        {c.edited && <span title={`edited ${when(c.edited)}`}>edited</span>}
        <span className="flex-1" />
        {mine && !editing && (
          <>
            <button onClick={start} title="Edit this comment"
              className="rounded px-1 hover:bg-hover hover:text-ink">edit</button>
            <button onClick={drop} title="Delete this comment"
              className="rounded px-1 leading-none hover:bg-hover hover:text-no">×</button>
          </>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Both keys are claimed by the viewer behind this panel, so stop
              // them here: esc would close the image, not the edit box.
              if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault(); e.stopPropagation(); commit()
              }
            }}
            className="mt-1 min-h-[58px] w-full resize-y rounded-md border border-rule bg-card p-2 text-sm"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={commit} disabled={busy || !draft.trim()}
              className="rounded-md border border-rule bg-card px-2.5 py-1 text-xs hover:bg-hover disabled:opacity-45"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setEditing(false)}
              className="rounded-md px-2 py-1 text-xs text-ink2 hover:bg-hover">
              Cancel
            </button>
            <span className="text-[11px] text-muted">⌘↵ save · esc cancel</span>
          </div>
        </>
      ) : (
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{c.text}</p>
      )}

      {error && <p className="mt-1 text-[11px] text-no">{error}</p>}
    </li>
  )
}
