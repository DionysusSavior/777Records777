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
 * When this page was written the admin that issued credentials lived on the
 * backend host, which is NOT the proved domain, so the proved domain vouched
 * for the onward link instead. That indirection is no longer load-bearing:
 * since 5 November the studio admin is served from this domain at `/admin`,
 * and discovery names it directly. Check the live document rather than this
 * comment:
 *
 *   curl -s https://777records777.studio/.well-known/om7-site-manager.json
 *
 * So the page is now a plain signpost to a destination on its own origin, kept
 * because the URL is stable and public and because the indirection is needed
 * again the moment the admin moves off this domain. Making it a redirect to
 * `/admin` would be the obvious simplification; that is a behaviour change
 * rather than a correction, so it is Dion's call.
 *
 * Deliberately public and deliberately empty of secrets. It issues nothing and
 * knows nothing, and it reads no environment: a signpost that depends on
 * configuration is a signpost that can point at nothing. Not indexed, because
 * it is for one artist rather than for search.
 */
export default function Om7CredentialPage() {
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
        <p className="text-sm leading-relaxed opacity-70">
          Sign in to studio admin on this site. If somebody invited you to a
          page, open the link they sent and sign in with the email it was sent
          to; the connection string is shown there once. If a page is already
          yours, it is under <strong>Your connections</strong>.
        </p>
        <a
          href="/admin"
          className="inline-flex w-fit items-center gap-2 rounded-full bg-white px-5 py-2 text-xs font-bold uppercase tracking-[0.14em] text-black transition hover:bg-white/90"
        >
          Open studio admin
        </a>
      </div>

      <p className="text-xs leading-relaxed opacity-50">
        The credential is shown once and is never stored by this site — only a
        fingerprint of it is kept, which cannot be used to publish. If it is
        lost, renew the connection; doing so stops the old one working.
      </p>
    </main>
  )
}
