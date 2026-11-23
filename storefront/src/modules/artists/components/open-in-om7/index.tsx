"use client"

export default function OpenInOm7({
  href,
  title,
}: {
  href: string
  title: string
}) {
  return (
    <a
      href={href}
      aria-label={`Open ${title} in OM7Player`}
      data-testid="open-in-om7"
      className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-black transition hover:bg-white/90"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M14 4h6v6" />
        <path d="M20 4 10 14" />
        <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
      </svg>
      Open in OM7Player
    </a>
  )
}
