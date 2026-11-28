import "server-only"

/**
 * Where a feature enquiry for each artist lands, by artist handle.
 *
 * Kept off the artist (src/lib/artists.ts) since 28 Nov 2026, because that
 * file is public twice over. The repository is on GitHub, and the home page
 * hands whole artist objects to a client component, so every field on an
 * artist travels in the page's data to every visitor. Until then both inboxes
 * did, though nothing on the page showed them. A booking address is a
 * person's inbox, so it is read from the environment here, and `server-only`
 * makes importing this file from a client component a build error.
 *
 * Each value is a static `process.env.X` read, listed in next.config.js `env`
 * and written to .env.production by amplify.yml: on Amplify that is the only
 * way a server-side variable reaches a running route (next.config.js says
 * why). Both are set on the Amplify app, beside FEATURE_REQUEST_URL.
 *
 * The mail function checks the address again against its own allowlist
 * (infra/lambda/feature-request/logic.mjs in the OM7 repository), so a new
 * artist needs an address in both places, or the enquiry is refused there.
 */
const BOOKING_EMAILS: Record<string, string | undefined> = {
  viz: process.env.BOOKING_EMAIL_VIZ,
  "dionysus-savior": process.env.BOOKING_EMAIL_DIONYSUS_SAVIOR,
}

/** The artist's booking inbox, or undefined when none is set. */
export const bookingEmailFor = (handle: string): string | undefined => {
  if (!Object.prototype.hasOwnProperty.call(BOOKING_EMAILS, handle)) {
    return undefined
  }
  const address = BOOKING_EMAILS[handle]?.trim()
  return address || undefined
}
