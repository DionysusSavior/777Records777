import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * Delivers a feature enquiry to the artist it was addressed to.
 *
 * This lives on the backend for one reason: the Resend key does. The
 * storefront collects the form, decides the recipient from its own roster and
 * posts here; nothing about the destination is taken from the browser.
 *
 * The recipient is still checked against an allowlist below rather than
 * trusted from the request body. The storefront is the only intended caller,
 * but "only intended caller" is not a control, and an endpoint that mails
 * arbitrary addresses on request is a spam relay.
 */
const RESEND_API_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.PREORDER_FROM_EMAIL

const ALLOWED_RECIPIENTS = new Set([
  "dionysussavior@outlook.com",
  "vizisreal@gmail.com",
])

const escape = (s: string) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

type Body = {
  to?: string
  artistName?: string
  name?: string
  email?: string
  location?: string
  kind?: string
  link?: string
  message?: string
  attachment?: { filename?: string; content?: string } | null
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as Body

  const to = String(body.to ?? "").toLowerCase()
  if (!ALLOWED_RECIPIENTS.has(to)) {
    return res.status(400).json({ error: "Unknown recipient." })
  }

  if (!RESEND_API_KEY || !FROM_EMAIL) {
    console.error("feature-request: RESEND_API_KEY or PREORDER_FROM_EMAIL is not set")
    return res.status(500).json({ error: "Mail is not configured." })
  }

  const kind = body.kind === "video" ? "Video appearance" : "Verse ($500)"
  const rows: [string, string][] = [
    ["Type", kind],
    ["From", `${body.name ?? ""} <${body.email ?? ""}>`],
    ["Location", body.location ?? ""],
    ["Track", body.link || (body.attachment?.filename ? `attached: ${body.attachment.filename}` : "not supplied")],
  ]

  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">
    <p style="margin:0 0 16px"><strong>Feature enquiry for ${escape(body.artistName ?? "")}</strong></p>
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      ${rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:4px 16px 4px 0;color:#666">${escape(k)}</td><td style="padding:4px 0">${escape(v)}</td></tr>`,
        )
        .join("")}
    </table>
    ${body.message ? `<p style="margin:20px 0 0;white-space:pre-wrap">${escape(body.message)}</p>` : ""}
  </div>`

  const payload: Record<string, unknown> = {
    from: FROM_EMAIL,
    to,
    subject: `Feature enquiry — ${kind} — ${body.name ?? "unknown"}`,
    html,
    // So hitting reply in the inbox answers the person who filled in the form
    // rather than the sending domain.
    reply_to: body.email,
  }

  if (body.attachment?.content && body.attachment.filename) {
    payload.attachments = [{ filename: body.attachment.filename, content: body.attachment.content }]
  }

  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })

  if (!sent.ok) {
    console.error("feature-request: resend error", sent.status, await sent.text().catch(() => ""))
    return res.status(502).json({ error: "Could not send." })
  }

  return res.json({ ok: true })
}
