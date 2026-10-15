import { useState } from 'react'
import { folderZipUrl, getSummary } from '../lib/api'
import { nf } from '../lib/format'
import DownloadDialog from './DownloadDialog'

/**
 * The reviewed download, with a question in front of it: images nobody has
 * looked at ship silently otherwise. The count is fetched at click time, not
 * taken from whatever the page loaded with.
 */
export default function ConfirmDownload({ version, className, children }) {
  const [ask, setAsk] = useState(null)        // the summary, once the dialog is open
  const [busy, setBusy] = useState(false)
  const url = folderZipUrl(version, true)
  // The server names the zip after the version's last folder.
  const filename = `${version.split('/').pop()}-reviewed.zip`

  const click = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      setAsk(await getSummary(version))
    } catch {
      // A summary we cannot read is no reason to withhold the download.
      setAsk({})
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <a href={url} onClick={click} className={className}>
        {children}
      </a>

      {ask && (
        <DownloadDialog
          title={ask.unflagged > 0
            ? `${nf(ask.unflagged)} of ${nf(ask.total)} images are not flagged`
            : `Download ${version}, reviewed`}
          url={url} filename={filename} onClose={() => setAsk(null)}
        >
          {ask.unflagged > 0 ? (
            <>
              <p className="mt-2 text-sm text-ink2">
                Some of the images have not been marked OK, Not OK, Review or
                Deleted. They will be included in the download exactly as they are
                on disk. Download the dataset anyway?
              </p>
              <dl className="mt-3 grid grid-cols-5 gap-2 text-center text-xs">
                {[['OK', ask.ok, 'text-ok'], ['Not OK', ask.no, 'text-no'],
                  ['Review', ask.review, 'text-review'],
                  ['Deleted', ask.deleted, 'text-no'],
                  ['Unflagged', ask.unflagged, 'text-muted']].map(([l, n, tone]) => (
                  <div key={l} className="rounded-md border border-line py-1.5">
                    <dt className="text-muted">{l}</dt>
                    <dd className={`num font-semibold ${tone}`}>{nf(n || 0)}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink2">
              Corrected labels in place of the originals; Not OK, Review and Deleted
              images left out, with EXCLUDED.csv and CORRECTED.csv inside.
            </p>
          )}
        </DownloadDialog>
      )}

      {busy && <span className="sr-only">checking review state…</span>}
    </>
  )
}
