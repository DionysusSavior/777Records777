import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "OM7 publishing credential",
  description:
    "Where to get the credential that lets the OM7 app publish to this site.",
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

/**
 * Where an artist is sent to get their OM7 publishing credential.
 *
 * This page exists because of a rule in the OM7 protocol, and the rule is
 * worth keeping. `credentialUrl` in the Site Manager discovery document must
 * be HTTPS ON THE PROVED DOMAIN, because that link is handed to a person under
 * the heading of a domain they proved they own — a document free to point it
 * anywhere would be a way to borrow an artist's trust for somebody else's
 * page, which is the shape of every credential-phishing link ever sent.
 *
 * The admin that actually issues the credential lives on the backend host
 * (Render here, and some other platform for somebody else), which is NOT the
 * proved domain. So the proved domain vouches for the onward link instead:
 * OM7 sends the artist here, and this page — served from the domain they
 * proved — names where the admin is. The security property survives and the
 * artist still gets one tap from the app to the right screen.
 *
 * Deliberately public and deliberately empty of secrets. It issues nothing and
 * knows nothing; it is a signpost. Not indexed, because it is for one artist
 * rather than for search.
 */
export default function Om7CredentialPage() {
  const backend =
    process.env.MEDUSA_BACKEND_URL ??
    process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL ??
    ""
  // Medusa serves its admin at /app. Absent configuration this stays null and
  // the page says where to look rather than printing a broken link.
  const adminUrl = backend
    ? new URL("/app/om7-credential", backend).toString()
    : null

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">OM7 publishing credential</h1>
        <p className="text-sm leading-relaxed opacity-70">
          The OM7 app publishes songs, reels and videos from a phone straight
          into this site&rsquo;s own storage. It asks for one credential, and
          this site issues it.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-white/15 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider opacity-60">
          Where to get it
        </h2>
        {adminUrl ? (
          <>
            <p className="text-sm leading-relaxed opacity-70">
              Sign in to this site&rsquo;s admin and open{" "}
              <strong>OM7 publishing</strong>. One button issues a credential
              and shows it once.
            </p>
            <a
              href={adminUrl}
              className="inline-flex w-fit items-center gap-2 rounded-full bg-white px-5 py-2 text-xs font-bold uppercase tracking-[0.14em] text-black transition hover:bg-white/90"
            >
              Open the site admin
            </a>
          </>
        ) : (
          <p className="text-sm leading-relaxed opacity-70">
            Sign in to this site&rsquo;s admin and open{" "}
            <strong>OM7 publishing</strong>.
          </p>
        )}
      </div>

      <p className="text-xs leading-relaxed opacity-50">
        The credential is shown once and is never stored by this site — only a
        fingerprint of it is kept, which cannot be used to publish. If it is
        lost, issue a new one; doing so stops the old one working.
      </p>
    </main>
  )
}
