"use client"

import AdminPeople, { captureAdminInvite } from "./admin-people"
import { useEffect, useReducer, useState } from "react"
import {
  INVITE_LINK_BROKEN,
  acceptInvite,
  beginSignIn,
  captureInvite,
  completeSignIn,
  createInvitation,
  cutOffConnection,
  formatExpiry,
  loadAccount,
  pageReducer,
  recipientProblem,
  removeAccess,
  renewConnection,
  sectionsFor,
  signOut,
  signedOutState,
  studioClient,
  studioConfig,
  type PageDeps,
} from "./studio-admin-logic"

const destinations = [
  { id: "viz-sounds", label: "Viz → 777records777.studio → Sounds" },
  { id: "viz-movies", label: "Viz → 777records777.studio → Movies" },
  { id: "dionysus-savior-sounds", label: "Dionysus Savior → 777records777.studio → Sounds" },
  { id: "dionysus-savior-movies", label: "Dionysus Savior → 777records777.studio → Movies" },
]

const button = "w-fit rounded-full bg-white px-5 py-2 text-xs font-bold uppercase tracking-[0.14em] text-black"
const quiet = "w-fit rounded-full border border-white/30 px-5 py-2 text-xs font-bold uppercase tracking-[0.14em]"

/**
 * The administrator signs in here, names an email, and the site sends the
 * invitation. The person who receives it signs in with that same email and
 * gets a connection string, once, to paste into OM7 Player.
 */
export default function StudioAdmin({
  serviceUrl,
  cognitoDomain,
  clientId,
}: {
  serviceUrl: string
  cognitoDomain: string
  clientId: string
}) {
  const config = studioConfig(serviceUrl, cognitoDomain, clientId)
  const [state, dispatch] = useReducer(pageReducer, null, signedOutState)
  const [destinationId, setDestinationId] = useState(destinations[0].id)
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const sections = sectionsFor(config, state)

  useEffect(() => {
    if (!config) return
    const storage = window.sessionStorage
    const search = window.location.search
    captureAdminInvite()
    const captured = captureInvite(storage, search)
    if (captured === "malformed") dispatch({ type: "invite-refused", message: INVITE_LINK_BROKEN })
    if (captured === "stored") dispatch({ type: "invite-waiting" })
    const redirectUri = `${window.location.origin}/${new URLSearchParams(search).get("legacyCallback") === "1" ? "studio-admin" : "admin"}`
    void completeSignIn(storage, search, config, redirectUri, fetch).then(async (result) => {
      const stripped = new URL(window.location.href)
      for (const name of ["code", "state", "error", "error_description", "invite", "adminInvite", "legacyCallback"]) stripped.searchParams.delete(name)
      window.history.replaceState({}, "", `${stripped.pathname}${stripped.search}${stripped.hash}`)
      if (result.kind === "signed-in") {
        dispatch({ type: "signed-in", token: result.token })
        await loadAccount(depsFor(result.token))
        return
      }
      if (result.kind === "failed") dispatch({ type: "sign-in-failed", message: result.message })
    })
    // The config values are the only inputs, and they do not change after render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const depsFor = (token: string): PageDeps => ({
    client: studioClient(config!.serviceUrl, token, fetch),
    storage: window.sessionStorage,
    dispatch,
  })

  if (!sections.notConnected && !config) return null

  if (sections.notConnected) {
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

  const ready = config!

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-16 text-white">
      <h1 className="text-2xl font-bold">Studio admin</h1>
      {sections.signIn && (
        <>
          <p className="text-sm leading-relaxed text-white/70">
            {state.invite.status === "waiting" || state.invite.status === "loading"
              ? "Sign in with the OM7 account for the email this invitation was sent to."
              : "Sign in with your OM7 account. Being able to sign in does not by itself let you invite anyone."}
          </p>
          <button
            type="button"
            className={button}
            onClick={() => void beginSignIn(window.sessionStorage, ready, `${window.location.origin}/admin`).then((url) => {
              window.location.assign(url)
            })}
          >
            Sign in
          </button>
        </>
      )}

      {state.identity && (
        <p className="text-sm text-white/70">
          Signed in{state.identity.email ? ` as ${state.identity.email}` : ""}.
          <button
            type="button"
            className="ml-3 text-xs uppercase tracking-[0.14em] text-white/70"
            onClick={() => {
              window.location.assign(signOut(window.sessionStorage, ready, window.location.origin))
            }}
          >
            Sign out
          </button>
        </p>
      )}

      {state.token && <AdminPeople token={state.token} serviceUrl={ready.serviceUrl} refresh={() => loadAccount(depsFor(state.token!))} />}

      {state.invite.status === "ready" && (
        <section className="flex flex-col gap-3 rounded border border-white/15 p-4">
          <p className="text-sm">{state.invite.invite.label}</p>
          <p className="text-sm text-white/70">Expires {formatExpiry(state.invite.invite.expiresAt)}.</p>
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => {
              if (!state.token) return
              setBusy(true)
              void acceptInvite(depsFor(state.token), state.invite.status === "ready" ? state.invite.invite.inviteId : "").finally(() => setBusy(false))
            }}
          >
            Accept
          </button>
        </section>
      )}
      {state.invite.status === "accepting" && <p className="text-sm text-white/70">Accepting…</p>}
      {(state.invite.status === "refused" || state.invite.status === "failed") && (
        <p className="text-sm text-white/80">{state.invite.message}</p>
      )}

      {state.connection && (
        <section className="flex flex-col gap-3 rounded border border-white/15 p-4">
          <p className="text-sm">
            {state.connection.replacesOld
              ? `New connection for ${state.connection.label}. The old one stops working.`
              : `Connection for ${state.connection.label}.`}
            {" "}Paste this into OM7 Player, under Publish. It is shown once.
          </p>
          <textarea readOnly value={state.connection.value} className="h-32 rounded border border-white/20 bg-black p-3 text-xs" />
          <button type="button" className={quiet} onClick={() => void navigator.clipboard.writeText(state.connection?.value ?? "")}>
            Copy
          </button>
          <button type="button" className="w-fit text-xs uppercase tracking-[0.14em] text-white/70" onClick={() => dispatch({ type: "connection-dismissed" })}>
            Dismiss
          </button>
        </section>
      )}

      {sections.myConnections && state.myConnections && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">Your connections</h2>
          {state.myConnections.length === 0 && <p className="text-sm text-white/70">None yet.</p>}
          {state.myConnections.map((connection) => (
            <div key={connection.id} className="flex flex-col gap-2 rounded border border-white/15 p-4 text-sm">
              <p>{connection.label}{connection.revoked ? " · removed" : ""}</p>
              {connection.reconnectRequired && !connection.revoked && (
                <p className="text-white/70">This one needs a new connection. The old one no longer works.</p>
              )}
              {!connection.revoked && (
                <button
                  type="button"
                  className={quiet}
                  onClick={() => state.token && void renewConnection(depsFor(state.token), connection.id)}
                >
                  New connection
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {sections.admin && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-bold">Publishing permissions</h2>
          <p className="text-sm text-white/70">
            Choose the page, then the person's email. The site sends them a link.
            It only works when they sign in with that same email.
          </p>
          <label className="flex flex-col gap-2 text-sm">
            Page
            <select value={destinationId} onChange={(event) => setDestinationId(event.target.value)} className="rounded border border-white/20 bg-black px-3 py-2">
              {destinations.map((destination) => (
                <option key={destination.id} value={destination.id}>{destination.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm">
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} className="rounded border border-white/20 bg-black px-3 py-2" placeholder="name@example.com" />
          </label>
          {recipientProblem(email) && email.trim() !== "" && (
            <p className="text-sm text-white/70">{recipientProblem(email)}</p>
          )}
          <button
            type="button"
            className={button}
            onClick={() => state.token && void createInvitation(depsFor(state.token), destinationId, email)}
          >
            Send invitation
          </button>
          {state.created && (
            <div className="flex flex-col gap-2 text-sm">
              <p>
                {state.created.mailed
                  ? `An email is on its way for ${state.created.label}. It expires ${formatExpiry(state.created.expiresAt)}.`
                  : `The invitation for ${state.created.label} exists, but the email could not be sent. Copy the link. It expires ${formatExpiry(state.created.expiresAt)}.`}
              </p>
              <textarea readOnly value={state.created.acceptUrl} className="h-20 rounded border border-white/20 bg-black p-3 text-xs" />
              <button type="button" className={quiet} onClick={() => void navigator.clipboard.writeText(state.created?.acceptUrl ?? "")}>
                Copy link
              </button>
            </div>
          )}
          <h2 className="text-lg font-bold">Access</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {state.access.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-white/15 p-3">
                <span>{entry.accountId} · {entry.label}{entry.revoked ? " · removed" : ""}{entry.reconnectRequired && !entry.revoked ? " · needs a new connection" : ""}</span>
                {!entry.revoked && state.token && (
                  <span className="flex gap-3">
                    <button type="button" className="text-xs uppercase tracking-[0.14em]" onClick={() => {
                      if (window.confirm("Cut off this connection? They will have to make a new one on this page.")) {
                        void cutOffConnection(depsFor(state.token as string), entry.id)
                      }
                    }}>
                      Cut off connection
                    </button>
                    <button type="button" className="text-xs uppercase tracking-[0.14em]" onClick={() => {
                      if (window.confirm("Remove this access? New uploads to that page will be refused.")) {
                        void removeAccess(depsFor(state.token as string), entry.id)
                      }
                    }}>
                      Remove
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {state.notice && <p className="text-sm text-white/80">{state.notice}</p>}
    </main>
  )
}
