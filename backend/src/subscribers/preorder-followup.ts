import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"

const RESEND_API_KEY = process.env.RESEND_API_KEY
const PREORDER_FROM_EMAIL = process.env.PREORDER_FROM_EMAIL
const PREORDER_REPLY_TO = process.env.PREORDER_REPLY_TO

const PREORDER_EMAIL_SUBJECT = "Thank you for your preorder"
const PREORDER_EMAIL_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Thank you for your preorder</title>
    <style>
      body {
        margin: 0;
        padding: 0;
        background-color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: #111827;
      }
      .container {
        max-width: 600px;
        margin: 0 auto;
        padding: 40px 24px;
      }
      .logo {
        margin-bottom: 32px;
        font-weight: 600;
        font-size: 18px;
        letter-spacing: 0.02em;
      }
      h1 {
        font-size: 22px;
        font-weight: 500;
        margin: 0 0 16px 0;
      }
      p {
        font-size: 15px;
        line-height: 1.6;
        margin: 0 0 16px 0;
        color: #374151;
      }
      .divider {
        height: 1px;
        background-color: #e5e7eb;
        margin: 32px 0;
      }
      .footer {
        font-size: 12px;
        color: #6b7280;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="logo">777Records777 Studio</div>
      <h1>Thank you for your preorder</h1>
      <p>
        We have received your preorder and wanted to personally thank you for
        the early support.
      </p>
      <p>
        We are currently finalizing vendor sourcing and production details to
        ensure quality and consistency before fulfillment begins. Your preorder
        secures your place in the first production run.
      </p>
      <p>
        We will follow up with updates as sourcing is completed and timelines
        are confirmed. No action is needed from you in the meantime.
      </p>
      <div class="divider"></div>
      <p class="footer">
        If you have any questions, simply reply to this email.<br />
        Thank you again for supporting this release.
      </p>
      <p class="footer">-- 777Records777</p>
    </div>
  </body>
</html>`

const hasTruthyFlag = (value: unknown) => value === true || value === "true"

const sendPreorderEmail = async (to: string) => {
  if (!RESEND_API_KEY || !PREORDER_FROM_EMAIL) {
    return
  }

  const payload = {
    from: PREORDER_FROM_EMAIL,
    to,
    subject: PREORDER_EMAIL_SUBJECT,
    html: PREORDER_EMAIL_HTML,
    ...(PREORDER_REPLY_TO ? { reply_to: PREORDER_REPLY_TO } : {}),
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`Resend error (${response.status}): ${message}`)
  }
}

export default async function preorderFollowupHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  if (!RESEND_API_KEY || !PREORDER_FROM_EMAIL) {
    return
  }

  const cartId = event?.data?.id
  if (!cartId) {
    return
  }

  const cartModuleService = container.resolve(Modules.CART)
  const cart = await cartModuleService.retrieveCart(cartId)
  if (!cart) {
    return
  }

  const metadata = cart.metadata || {}

  if (!hasTruthyFlag(metadata.preorder_submitted)) {
    return
  }

  if (hasTruthyFlag(metadata.preorder_deleted)) {
    return
  }

  if (hasTruthyFlag(metadata.preorder_followup_sent)) {
    return
  }

  if (!cart.email) {
    return
  }

  try {
    await sendPreorderEmail(cart.email)
  } catch (error) {
    console.error("Failed to send preorder email", error)
    return
  }

  await cartModuleService.updateCarts(cartId, {
    metadata: {
      ...metadata,
      preorder_followup_sent: true,
      preorder_followup_sent_at: new Date().toISOString(),
    },
  })
}

export const config: SubscriberConfig = {
  event: "cart.updated",
}
