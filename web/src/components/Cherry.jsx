/** The Pick mark: a pair of cherries, so the name reads "cherry-pick". The
 *  glints are knocked out in the surface colour, so it must sit on bg-surface. */
export default function Cherry({ className = 'size-[22px]' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <g fill="none" stroke="var(--color-cherry)" strokeWidth="1.5" strokeLinecap="round">
        <path d="M6.9 13.4C7.8 9 10.6 5.4 14 3" /><path d="M17.2 11.8C16.9 8 15.6 5 14 3" />
      </g>
      <path d="M14 3C16.4 1.1 19.9 1.6 21.2 3.9 18.6 5.1 15.8 4.7 14 3Z" fill="var(--color-cherry)" />
      <circle cx="6.3" cy="17.6" r="4.3" fill="var(--color-cherry)" />
      <circle cx="17.3" cy="16" r="4.3" fill="var(--color-cherry)" />
      <g fill="none" stroke="var(--color-surface)" strokeWidth="1.1" strokeLinecap="round">
        <path d="M3.9 16.9a2.6 2.6 0 0 1 1.6-1.6" /><path d="M14.9 15.3a2.6 2.6 0 0 1 1.6-1.6" />
      </g>
    </svg>
  )
}
