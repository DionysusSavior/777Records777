"use client"

import { useEffect, useState } from "react"

const FLAG = "om7-open-links"

/**
 * "Open in OM7Player", shown only to somebody who has switched it on.
 *
 * WHY IT IS HIDDEN. The link works in an app build from 1 November 2026 or
 * later. On 12 November the App Store was still serving a build from August,
 * and om7.foundation has told iOS that /open belongs to the app since
 * October. So for somebody on the public build, this button would leave the
 * site, open the app, and do nothing at all. A button that opens an app into
 * silence is worse than no button.
 *
 * Switch it on for one browser by visiting any page with `?om7open=1`, and
 * off again with `?om7open=0`. It is remembered on that device only.
 *
 * WHEN A BUILD THAT ANSWERS THE LINK IS PUBLIC, delete the gate: set
 * `shown` to true from the start and remove the effect. Nothing else changes.
 *
 * A plain link and not a script, on purpose. iOS opens the app only for a
 * link a person tapped; a redirect made by code stays in the browser.
 */
export default function OpenInOm7({
  href,
  title,
}: {
  href: string
  title: string
}) {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    try {
      const asked = new URLSearchParams(window.location.search).get("om7open")
      if (asked === "1") window.localStorage.setItem(FLAG, "1")
      if (asked === "0") window.localStorage.removeItem(FLAG)
      setShown(window.localStorage.getItem(FLAG) === "1")
    } catch {
      // Private browsing can refuse storage. Hidden is the safe answer.
      setShown(false)
    }
  }, [])

  if (!shown) return null

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
