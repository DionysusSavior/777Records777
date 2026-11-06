import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2"

/**
 * Sends through SES, not Resend.
 *
 * Resend was never needed here. SES already has 777records777.studio as a
 * verified domain identity with DKIM and its own MAIL FROM, the account has
 * production access rather than sandbox, and MailStack's FeatureRequestFn has
 * been sending through it all along - the storefront's feature-request form
 * stopped going through Medusa when that Lambda was built. This subscriber was
 * the last thing in the project still holding a Resend key, which meant a
 * third-party secret had to survive the move off Render for one email.
 *
 * REGION IS NOT THE TASK'S REGION. The identity lives in us-east-1, where
 * MailStack is pinned because inbound SES receiving only exists in a few
 * regions; this service runs in us-east-2. Defaulting to the task's region
 * would fail with a message about an unverified identity, which sends you
 * looking at DNS rather than at the region.
 *
 * No key, no header, no secret: the Fargate task role carries ses:SendEmail,
 * scoped by a condition on the From address.
 */
const PREORDER_FROM_EMAIL =
  process.env.PREORDER_FROM_EMAIL?.trim() || "noreply@777records777.studio"
const PREORDER_SUPPORT_EMAIL =
  process.env.PREORDER_REPLY_TO?.trim() || "support@777records777.studio"
const SES_REGION = process.env.PREORDER_SES_REGION?.trim() || "us-east-1"

const ses = new SESv2Client({ region: SES_REGION })

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
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" class="panel" style="width: 600px; max-width: 600px; background-color: #0b0f1c; border: 1px solid #1b2233; border-radius: 16px; overflow: hidden;">
            <tr>
              <td style="padding: 28px 32px; background: linear-gradient(135deg, rgba(120, 240, 255, 0.14), rgba(120, 120, 255, 0.06)); border-bottom: 1px solid #1b2233; text-align: center;">
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
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td width="72" valign="top" style="padding-right: 12px;">
                      <img
                        src="https://777records777.studio/Store_Background_Eagle.png"
                        alt="777Records777 Eagle"
                        width="72"
                        style="display: block; width: 72px; height: auto; opacity: 1;"
                      />
                    </td>
                    <td valign="top">
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
                    <td width="72" valign="top" style="padding-left: 12px;">
                      <img
                        src="https://777records777.studio/Store_Background_Eagle.png"
                        alt="777Records777 Eagle"
                        width="72"
                        style="display: block; width: 72px; height: auto; opacity: 1;"
                      />
                    </td>
                  </tr>
                </table>
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
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: PREORDER_FROM_EMAIL,
      Destination: { ToAddresses: [to] },
      ReplyToAddresses: [PREORDER_SUPPORT_EMAIL],
      Content: {
        Simple: {
          Subject: { Data: PREORDER_EMAIL_SUBJECT, Charset: "UTF-8" },
          Body: { Html: { Data: PREORDER_EMAIL_HTML, Charset: "UTF-8" } },
        },
      },
    })
  )
}

export default async function preorderFollowupHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
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
