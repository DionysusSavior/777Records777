"use client"

import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect, useRef, useState } from "react"

const CONSENT_TEXT =
  "Email me first about new releases from 777Records777. Unsubscribe any time."

/**
 * Where a pre-ticked box is not consent. Mirrors the server list; the server
 * is the one that matters, this only decides what the visitor SEES ticked.
 */
const EXPLICIT_CONSENT_REQUIRED = new Set([
  "at", "be", "bg", "hr", "cy", "cz", "dk", "ee", "fi", "fr", "de", "gr", "hu",
  "ie", "it", "lv", "lt", "lu", "mt", "nl", "pl", "pt", "ro", "sk", "si", "es",
  "se", "gb", "uk", "is", "li", "no", "ch", "ca",
])

/**
 * Posted straight to AWS, not through this site's own server.
 *
 * SES already verifies this domain and the signup function lives in the mail
 * stack beside it, so the browser talks to AWS directly and no part of this
 * runs on the Medusa backend. That backend is on Render and Render is being
 * removed; a feature routed through it is a feature that has to be migrated
 * with it. The function's origin allow-list is what keeps the endpoint
 * answering only to this site.
 */
const ENDPOINT = process.env.NEXT_PUBLIC_LIST_SIGNUP_URL

const ASKED = "777.priorityList.asked"
const JOINED = "777.priorityList.joined"

// Reading storage can throw outright in a locked-down browser, so every read
// answers false rather than taking the page down with it.
const flag = (key: string) => {
  try {
    return window.localStorage.getItem(key) === "1"
  } catch {
    return false
  }
}
const setFlag = (key: string) => {
  try {
    window.localStorage.setItem(key, "1")
  } catch {
    /* a visitor who blocks storage simply gets asked again */
  }
}

/**
 * Priority delivery: asked once, after a download has already started.
 *
 * THE ORDER IS THE WHOLE POINT. The file is already downloading before this
 * appears, and nothing is withheld if it is ignored. Reciprocity done the
 * honest way round - value first, then the ask - rather than a wall in front
 * of the thing somebody came for.
 *
 * It listens for clicks on `a[download]` anywhere on the page rather than
 * being wired into each shelf. Sounds and Movies both already render ordinary
 * download links, and a delegated listener leaves both files untouched;
 * anything added later that is a real download link is covered for free.
 *
 * Asked ONCE. After that the only way back is the small corner affordance,
 * which never nags and never covers anything.
 */
export default function PriorityList({ countryCode }: { countryCode?: string }) {
  const [open, setOpen] = useState(false)
  const [joined, setJoined] = useState(false)
  const [email, setEmail] = useState("")
  const [consent, setConsent] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)

  const explicit = EXPLICIT_CONSENT_REQUIRED.has(String(countryCode ?? "").toLowerCase())

  useEffect(() => {
    setJoined(flag(JOINED))
    // Unticked where a pre-ticked box is not valid consent.
    if (explicit) setConsent(false)
  }, [explicit])

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = (event.target as HTMLElement | null)?.closest?.("a[download]")
      if (!link) return
      if (flag(ASKED) || flag(JOINED)) return
      setFlag(ASKED)
      // After the click has done its work. The download is the browser's
      // business and this must not be in the way of it.
      window.setTimeout(() => setOpen(true), 900)
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [])

  const submit = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      if (!ENDPOINT) {
        setError("The list is not set up yet.")
        return
      }
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          consent,
          countryCode,
          // True where the box could not lawfully start ticked, so a true
          // consent from there is an act rather than a default. The server
          // refuses those regions without it, so a caller that forgets the
          // rule fails closed instead of quietly adding somebody.
          explicitConsent: explicit,
          consentText: CONSENT_TEXT,
          source: "download",
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? "That did not go through.")
        return
      }
      setFlag(JOINED)
      setJoined(true)
      window.setTimeout(() => setOpen(false), 1600)
    } catch {
      setError("That did not go through. Try again in a moment.")
    } finally {
      setBusy(false)
    }
  }, [email, consent, countryCode, explicit])

  const canSubmit = email.trim().length > 3 && consent && !busy

  return (
    <>
      {/* The way back, for somebody who decided later. Small, in the corner,
          over nothing, and gone once they have joined. */}
      {!joined && !open && (
        <button
          type="button"
          onClick={() => {
            setFlag(ASKED)
            setOpen(true)
            window.setTimeout(() => field.current?.focus(), 350)
          }}
          className="fixed bottom-4 right-4 z-40 rounded-full border border-white/15 bg-black/70 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/70 backdrop-blur transition hover:border-white/40 hover:text-white"
        >
          Priority delivery
        </button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            role="dialog"
            aria-label="Priority delivery"
            className="fixed bottom-4 right-4 z-50 w-[min(92vw,360px)] rounded-large border border-white/15 bg-black/90 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.6)] backdrop-blur-xl"
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute right-3 top-3 text-white/40 transition hover:text-white"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>

            {joined ? (
              <p className="text-sm text-white">You&rsquo;re on the list. Talk soon.</p>
            ) : (
              <>
                <p className="luxury-title text-[0.8rem] uppercase tracking-[0.14em] text-white">
                  Priority delivery
                </p>
                <p className="mt-2 text-xs leading-relaxed text-white/60">
                  Your download is on its way. Want the next one before it goes
                  public?
                </p>

                <input
                  ref={field}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canSubmit) void submit()
                  }}
                  placeholder="you@example.com"
                  aria-label="Email address"
                  className="mt-4 w-full rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none"
                />

                <label className="mt-3 flex cursor-pointer items-start gap-2 text-[11px] leading-relaxed text-white/60">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-white"
                  />
                  <span>{CONSENT_TEXT}</span>
                </label>

                {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}

                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!canSubmit}
                  className="mt-4 w-full rounded-full bg-white px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? "Adding…" : "Join the list"}
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
