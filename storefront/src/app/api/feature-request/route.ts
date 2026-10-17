import { NextRequest, NextResponse } from "next/server"

import { getArtist } from "@lib/artists"

/**
 * Takes a feature enquiry and hands it to the mail function.
 *
 * This hop exists so the browser never sees the function URL, and so the
 * destination address is decided here from the artist handle rather than
 * posted by the client. A form that carried its own recipient would be an
 * open relay wearing a booking form as a disguise. The function checks the
 * address again; this hop is not the only control.
 *
 * FEATURE_REQUEST_URL is the Lambda function URL from MailStack. It is
 * server-only on purpose. There is no Medusa fallback: a deploy of this
 * route before that URL is set answers 503 rather than quietly mailing
 * through Render.
 */
const FEATURE_REQUEST_URL = process.env.FEATURE_REQUEST_URL ?? ""

/** Matches the cap stated in the form, enforced again because the client can lie. */
const MAX_FILE_BYTES = 4 * 1024 * 1024

const str = (v: FormDataEntryValue | null, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : ""

export async function POST(req: NextRequest) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: "Could not read that form." }, { status: 400 })
  }

  const artist = getArtist(str(form.get("artistHandle"), 60))
  if (!artist) {
    return NextResponse.json({ error: "Unknown artist." }, { status: 400 })
  }

  const name = str(form.get("name"), 120)
  const email = str(form.get("email"), 200)
  const location = str(form.get("location"), 200)
  const kind = str(form.get("kind"), 20) === "video" ? "video" : "verse"
  const link = str(form.get("link"), 500)
  const message = str(form.get("message"), 4000)

  if (!name || !email.includes("@") || !location) {
    return NextResponse.json({ error: "Name, a valid email and a location are required." }, { status: 400 })
  }

  let attachment: { filename: string; content: string } | null = null
  const file = form.get("track")
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "That file is over 4 MB. Send a link instead." }, { status: 413 })
    }
    attachment = {
      filename: file.name.slice(0, 120),
      content: Buffer.from(await file.arrayBuffer()).toString("base64"),
    }
  }

  if (!FEATURE_REQUEST_URL) {
    console.error("feature-request: FEATURE_REQUEST_URL is not set")
    return NextResponse.json({ error: "That did not send. Try again in a moment." }, { status: 503 })
  }

  const res = await fetch(FEATURE_REQUEST_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      to: artist.bookingEmail,
      artistName: artist.name,
      name,
      email,
      location,
      kind,
      link,
      message,
      attachment,
    }),
  })

  if (!res.ok) {
    // The reason is logged where it can be read and not handed to the browser,
    // which has nothing useful to do with a backend error string.
    console.error("feature-request failed", res.status, await res.text().catch(() => ""))
    return NextResponse.json({ error: "That did not send. Try again in a moment." }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
