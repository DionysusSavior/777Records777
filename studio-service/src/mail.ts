import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2"

/**
 * The studio domain's mail already lives in us-east-1. This function does
 * not. SES sends across regions; the identity does not move.
 *
 * The link is not a key. Accepting still requires the signed-in account's
 * verified email to be this address, so a forwarded message cannot be used.
 */
export const sendStudioInvite = async (message: { to: string; acceptUrl: string; label: string }) => {
  const from = process.env.STUDIO_INVITE_FROM?.trim()
  if (!from) throw new Error("Invite mail is not configured.")
  const client = new SESv2Client({ region: "us-east-1" })
  await client.send(new SendEmailCommand({
    FromEmailAddress: from,
    Destination: { ToAddresses: [message.to] },
    Content: {
      Simple: {
        Subject: { Data: `Publish to ${message.label}`, Charset: "UTF-8" },
        Body: {
          Text: {
            Charset: "UTF-8",
            Data: [
              `You are invited to publish to ${message.label}.`,
              "",
              "Open this link and sign in with this same email address:",
              message.acceptUrl,
              "",
              "The link does not work for a different account, and it is only good once.",
            ].join("\n"),
          },
        },
      },
    },
  }))
}
