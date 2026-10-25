"use client"

import { useEffect, useMemo, useState } from "react"

/**
 * Sign-in is Cognito's authorization-code flow with PKCE.
 *
 * The id token stays in memory. It is not written to localStorage and it is
 * not put in the address bar. Being able to sign in does not make someone an
 * administrator; the service refuses a grant from anyone who is not.
 */
type Destination = {
  id: string
  label: string
  artistName: string
  section: string
}

const destinations: Destination[] = [
  { id: "viz-sounds", label: "Viz → 777records777.studio → Sounds", artistName: "Viz", section: "sounds" },
  { id: "viz-movies", label: "Viz → 777records777.studio → Movies", artistName: "Viz", section: "movies" },
  { id: "dionysus-savior-sounds", label: "Dionysus Savior → 777records777.studio → Sounds", artistName: "Dionysus Savior", section: "sounds" },
  { id: "dionysus-savior-movies", label: "Dionysus Savior → 777records777.studio → Movies", artistName: "Dionysus Savior", section: "movies" },
]

const bytes = (size: number) => {
  const values = new Uint8Array(size)
  crypto.getRandomValues(values)
  return values
}

const base64url = (value: Uint8Array) =>
  btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")

async function challenge() {
  const verifier = base64url(bytes(32))
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  const method = base64url(new Uint8Array(digest))
  sessionStorage.setItem("studio-admin.pkce", verifier)
  return method
}

export default function StudioAdmin({
  serviceUrl,
  cognitoDomain,
  clientId,
}: {
  serviceUrl: string
  cognitoDomain: string
  clientId: string
}) {
  const ready = serviceUrl.startsWith("https://") && cognitoDomain.startsWith("https://") && clientId.length > 0
  const [token, setToken] = useState<string | null>(null)
  const [destinationId, setDestinationId] = useState(destinations[0].id)
  const [recipientSub, setRecipientSub] = useState("")
  const [inviteId, setInviteId] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [grants, setGrants] = useState<Array<{ id: string; label: string; revoked: boolean; principalSub: string }>>([])

  const redirectUri = useMemo(() => {
    if (typeof window === "undefined") return ""
    return `${window.location.origin}/studio-admin`
  }, [])

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code")
    const verifier = sessionStorage.getItem("studio-admin.pkce")
    if (!code || !verifier || !ready) return
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: `${window.location.origin}/studio-admin`,
      code_verifier: verifier,
    })
    void fetch(new URL("/oauth2/token", cognitoDomain), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }).then(async (response) => {
      const payload = await response.json()
      if (typeof payload.id_token === "string") setToken(payload.id_token)
      else setNotice("Sign-in did not return a token.")
      sessionStorage.removeItem("studio-admin.pkce")
      window.history.replaceState({}, "", "/studio-admin")
    }).catch(() => setNotice("Sign-in could not be completed."))
  }, [ready, clientId, cognitoDomain])

  async function signIn() {
    const codeChallenge = await challenge()
    const url = new URL("/oauth2/authorize", cognitoDomain)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("client_id", clientId)
    url.searchParams.set("redirect_uri", redirectUri)
    url.searchParams.set("scope", "openid email")
    url.searchParams.set("code_challenge_method", "S256")
    url.searchParams.set("code_challenge", codeChallenge)
    window.location.assign(url.toString())
  }

  async function call(path: string, body?: unknown) {
    const response = await fetch(new URL(path, serviceUrl), {
      method: body ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const payload = await response.json()
    if (!response.ok) {
      throw new Error(payload?.error?.message ?? "The studio service refused that.")
    }
    return payload
  }

  if (!ready) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-16 text-white">
        <h1 className="text-2xl font-bold">Studio admin</h1>
        <p className="text-sm leading-relaxed text-white/70">
          This page is where an artist is invited to one page. The publishing
          service is not connected yet, so there is nothing to sign in to and
          no destination is assumed. The live publisher is still the current
          site admin.
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-16 text-white">
      <h1 className="text-2xl font-bold">Studio admin</h1>
      <p className="text-sm leading-relaxed text-white/70">
        Choose the artist and the section. A grant publishes to that one
        place. It does not make the person an administrator, and it does not
        show customers.
      </p>
      {!token ? (
        <button type="button" onClick={() => void signIn()} className="w-fit rounded-full bg-white px-5 py-2 text-xs font-bold uppercase tracking-[0.14em] text-black">
          Sign in
        </button>
      ) : (
        <>
          <label className="flex flex-col gap-2 text-sm">
            Destination
            <select value={destinationId} onChange={(event) => setDestinationId(event.target.value)} className="rounded border border-white/20 bg-black px-3 py-2">
              {destinations.map((destination) => (
                <option key={destination.id} value={destination.id}>{destination.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm">
            Recipient account id
            <input value={recipientSub} onChange={(event) => setRecipientSub(event.target.value)} className="rounded border border-white/20 bg-black px-3 py-2" placeholder="Cognito sub, not an email" />
          </label>
          <button
            type="button"
            className="w-fit rounded-full bg-white px-5 py-2 text-xs font-bold uppercase tracking-[0.14em] text-black"
            onClick={() => void call("/admin/invites", { destinationId, recipientSub }).then((payload) => {
              setInviteId(payload.inviteId)
              setNotice(`Invitation ${payload.inviteId} is for ${payload.destination.label}.`)
            }).catch((error: Error) => setNotice(error.message))}
          >
            Invite
          </button>
          {inviteId && <p className="text-sm text-white/80">Invite id: {inviteId}</p>}
          <button
            type="button"
            className="w-fit rounded-full border border-white/30 px-5 py-2 text-xs font-bold uppercase tracking-[0.14em]"
            onClick={() => void call("/admin/invites/accept", { inviteId }).then((payload) => {
              setSecret(payload.connection)
              setNotice("The connection string is shown once. It publishes only to the invited page.")
            }).catch((error: Error) => setNotice(error.message))}
          >
            Accept with this sign-in
          </button>
          {secret && <textarea readOnly value={secret} className="h-32 rounded border border-white/20 bg-black p-3 text-xs" />}
          <button
            type="button"
            className="w-fit text-xs uppercase tracking-[0.14em] text-white/70"
            onClick={() => void call("/admin/grants").then((payload) => setGrants(payload.grants)).catch((error: Error) => setNotice(error.message))}
          >
            Show grants
          </button>
          <ul className="flex flex-col gap-2 text-sm">
            {grants.map((grant) => (
              <li key={grant.id} className="flex items-center justify-between gap-3">
                <span>{grant.label} · {grant.principalSub}{grant.revoked ? " · revoked" : ""}</span>
                {!grant.revoked && (
                  <button type="button" className="text-xs uppercase tracking-[0.14em]" onClick={() => void call("/admin/grants/revoke", { grantId: grant.id }).then(() => setNotice("Revoked. A new upload will not be added to the page.")).catch((error: Error) => setNotice(error.message))}>
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {notice && <p className="text-sm text-white/80">{notice}</p>}
    </main>
  )
}
