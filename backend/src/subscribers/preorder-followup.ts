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
    <meta http-equiv="x-ua-compatible" content="ie=edge" />
    <title>Thank you for your preorder</title>
    <style>
      body {
        margin: 0;
        padding: 0;
        background-color: #05060a;
        font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
        color: #e7ecff;
        -webkit-text-size-adjust: 100%;
        -ms-text-size-adjust: 100%;
      }
      .glow {
        text-shadow: 0 0 12px rgba(120, 240, 255, 0.6),
          0 0 24px rgba(120, 240, 255, 0.35);
      }
      .panel {
        background: #0b0f1c;
        border: 1px solid #1b2233;
        border-radius: 16px;
        overflow: hidden;
      }
      .muted {
        color: #9aa6d8;
      }
      .accent {
        color: #78f0ff;
      }
    </style>
  </head>
  <body style="margin: 0; padding: 0; background-color: #05060a; color: #e7ecff;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #05060a;">
      <tr>
        <td align="center" style="padding: 32px 16px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" class="panel" background="https://777records777.studio/Store_Background_Eagle.png" style="width: 600px; max-width: 600px; background-color: #0b0f1c; background-image: url('https://777records777.studio/Store_Background_Eagle.png'); background-repeat: no-repeat; background-position: center 140px; background-size: 360px auto; border: 1px solid #1b2233; border-radius: 16px; overflow: hidden;">
            <tr>
              <td style="padding: 28px 32px; background: linear-gradient(135deg, rgba(120, 240, 255, 0.14), rgba(120, 120, 255, 0.06)); border-bottom: 1px solid #1b2233;">
                <div style="font-size: 11px; letter-spacing: 0.35em; text-transform: uppercase; color: #9db4ff;">
                  777Records777 Studio
                </div>
                <div class="glow" style="font-size: 26px; font-weight: 600; margin-top: 8px; color: #f8fbff; text-shadow: 0 0 12px rgba(120, 240, 255, 0.6), 0 0 24px rgba(120, 240, 255, 0.35);">
                  Thank you for your preorder
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding: 28px 32px; font-size: 15px; line-height: 1.6; color: #c9d4ff;">
                <p style="margin: 0 0 16px 0;">
                  We have received your preorder and wanted to personally thank you for the early support.
                </p>
                <p style="margin: 0 0 16px 0;">
                  We are currently finalizing vendor sourcing and production details to ensure quality and consistency before fulfillment begins. Your preorder secures your place in the first production run.
                </p>
                <p style="margin: 0 0 20px 0;">
                  We will follow up with updates as sourcing is completed and timelines are confirmed. No action is needed from you in the meantime.
                </p>
                <div style="height: 1px; background: linear-gradient(90deg, transparent, rgba(120, 240, 255, 0.5), transparent); margin: 24px 0;"></div>
                <p style="margin: 0 0 8px 0; font-size: 12px; color: #9aa6d8;">
                  If you have any questions, simply reply to this email.
                </p>
                <p style="margin: 0; font-size: 12px; color: #9aa6d8;">
                  -- 777Records777
                </p>
              </td>
            </tr>
          </table>
          <div style="margin-top: 16px; font-size: 11px; color: #67709a;">
            Thank you again for supporting this release.
          </div>
        </td>
      </tr>
    </table>
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
