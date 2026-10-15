import { useEffect, useMemo, useState } from 'react'
import { copyText } from '../lib/copy'
import { useData } from '../lib/store'

/** Single-quoted for a POSIX shell: the query string is percent-encoded, but a
 *  quote in a version name must not end the argument early. */
const sh = (s) => `'${s.replaceAll("'", `'\\''`)}'`

/**
 * Two ways to fetch a download: the browser, or a curl command to paste into a
 * terminal — handy on a remote machine, or for a dataset too big to babysit in
 * a tab. Behind the proxy the command names the reviewer and curl asks for the
 * password; it is never written into the command.
 */
export default function DownloadDialog({ title, url, filename, children, onStart, onClose }) {
  const { meta } = useData()
  const [copied, setCopied] = useState(null)       // true, false (failed), or null

  const user = meta?.user_header ? meta.user : null
  const command = useMemo(() => [
    'curl -fL',
    user ? `-u ${sh(user)}` : null,
    `-o ${sh(filename)}`,
    sh(new URL(url, window.location.origin).href),
  ].filter(Boolean).join(' '), [url, filename, user])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = async () => {
    setCopied(await copyText(command))
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           className="w-full max-w-xl rounded-xl border border-line bg-card p-5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {children}

        <h3 className="mt-4 mb-1.5 text-xs font-medium text-ink2">From a terminal</h3>
        <div className="flex items-stretch overflow-hidden rounded-md border border-rule bg-surface">
          <code className="min-w-0 flex-1 overflow-x-auto px-3 py-2 font-mono text-[12px] whitespace-nowrap text-ink">
            {command}
          </code>
          <button onClick={copy}
                  className={`shrink-0 border-l border-rule px-3 text-xs font-semibold ${copied === false
                    ? 'text-no' : 'text-ink2 hover:bg-hover'}`}>
            {copied ? 'Copied ✓' : copied === false ? 'Copy failed' : 'Copy'}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-muted">
          Saves <code>{filename}</code> in the current folder.
          {user && <> curl asks for <b>{user}</b>’s Pick password.</>}
          {copied === false && <> Select the command and copy it by hand.</>}
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose}
                  className="rounded-md border border-rule bg-card px-3 py-1.5 text-sm hover:bg-hover">
            Cancel
          </button>
          <a href={url} download={filename} onClick={() => { onStart?.(); onClose() }}
             className="rounded-md bg-ink px-3 py-1.5 text-sm font-semibold text-page hover:opacity-90">
            Download in browser
          </a>
        </div>
      </div>
    </div>
  )
}
