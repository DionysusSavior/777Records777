"use client"

import { useState } from "react"

/**
 * Booking a feature.
 *
 * A verse has a price because it is the same work wherever it is recorded. A
 * video appearance does not, because it is a flight, a night somewhere and a
 * day gone, and quoting one number for that would be wrong in both directions.
 * So the form asks where, and the answer comes back by mail.
 *
 * The track can be a link or a file. A link is the honest default: most demos
 * live in Drive or Dropbox already and a WAV is bigger than anything that
 * should travel through a form. The upload is there because people expect it,
 * capped where an attachment stops being reliable, and the cap is stated
 * rather than discovered at submit time.
 */
const MAX_FILE_BYTES = 4 * 1024 * 1024

type Status = { kind: "idle" | "sending" | "sent" } | { kind: "error"; message: string }

export default function FeatureRequest({
  artistHandle,
  artistName,
}: {
  artistHandle: string
  artistName: string
}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const [fileName, setFileName] = useState<string | null>(null)

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (status.kind === "sending") return

    const form = e.currentTarget
    const data = new FormData(form)
    const file = data.get("track") as File | null

    if (file && file.size > 0 && file.size > MAX_FILE_BYTES) {
      setStatus({
        kind: "error",
        message: "That file is over 4 MB. Send a link to it instead and it will reach them the same way.",
      })
      return
    }

    setStatus({ kind: "sending" })

    try {
      // Posted to our own route rather than straight to the backend, so the
      // publishable key and the mail credentials stay on the server.
      const res = await fetch("/api/feature-request", { method: "POST", body: data })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? "That did not send.")
      }
      setStatus({ kind: "sent" })
      form.reset()
      setFileName(null)
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "That did not send." })
    }
  }

  if (status.kind === "sent") {
    return (
      <div className="rounded-2xl border border-white/15 bg-white/[0.04] p-8 text-center">
        <p className="text-lg font-semibold text-white">Thank you.</p>
        <p className="mt-2 text-sm text-white/60">We will review and get back to you soon.</p>
        <button
          onClick={() => setStatus({ kind: "idle" })}
          className="mt-6 text-xs uppercase tracking-[0.2em] text-white/40 underline underline-offset-4 hover:text-white/70"
        >
          Send another
        </button>
      </div>
    )
  }

  const field =
    "w-full rounded-xl border border-white/15 bg-black/50 px-4 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-white/40"

  return (
    <form onSubmit={submit} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 small:p-6">
      <input type="hidden" name="artistHandle" value={artistHandle} />

      <div className="grid grid-cols-1 gap-4 small:grid-cols-2">
        <input name="name" required placeholder="Your name" className={field} />
        <input name="email" type="email" required placeholder="Your email" className={field} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 small:grid-cols-2">
        <select name="kind" required defaultValue="verse" className={field}>
          <option value="verse">Verse — $500</option>
          <option value="video">Video appearance — quoted</option>
        </select>
        <input
          name="location"
          required
          placeholder="Location (city, state or country)"
          className={field}
        />
      </div>

      <input name="link" type="url" placeholder="Link to the track (Drive, Dropbox, SoundCloud)" className={`${field} mt-4`} />

      <label className="mt-4 flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-dashed border-white/20 px-4 py-3 text-sm text-white/50 hover:border-white/40">
        <span className="truncate">{fileName ?? "Or attach a music file (up to 4 MB)"}</span>
        <span className="shrink-0 text-xs uppercase tracking-[0.16em] text-white/70">Browse</span>
        <input
          type="file"
          name="track"
          accept="audio/*"
          className="hidden"
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
        />
      </label>

      <textarea
        name="message"
        rows={4}
        placeholder={`Anything ${artistName} should know — dates, the project, the budget`}
        className={`${field} mt-4 resize-y`}
      />

      {status.kind === "error" && <p className="mt-4 text-sm text-red-300">{status.message}</p>}

      <button
        type="submit"
        disabled={status.kind === "sending"}
        className="mt-5 w-full rounded-full bg-white px-6 py-3 text-[12px] font-bold uppercase tracking-[0.16em] text-black transition hover:bg-white/90 disabled:opacity-50"
      >
        {status.kind === "sending" ? "Sending…" : "Send enquiry"}
      </button>
    </form>
  )
}
