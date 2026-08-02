import { NextRequest, NextResponse } from "next/server"

import { getArtist } from "@lib/artists"

/**
 * Takes a feature enquiry and hands it to the backend, which owns the mail
 * credentials.
 *
 * This hop exists so the browser never sees the publishable key or the Resend
 * key, and so the destination address is decided here from the artist handle
 * rather than posted by the client. A form that carried its own recipient
 * would be an open relay wearing a booking form as a disguise.
 */
const BACKEND =
  process.env.MEDUSA_BACKEND_URL ||
  process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ||
  "https://seven77records777.onrender.com"

const PUBLISHABLE_KEY =
  process.env.MEDUSA_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || ""

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

  const res = await fetch(`${BACKEND}/store/feature-request`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(PUBLISHABLE_KEY ? { "x-publishable-api-key": PUBLISHABLE_KEY } : {}),
    },
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
