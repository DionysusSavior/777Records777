/**
 * The studio admin page, without a browser.
 *
 * Two accounts share one fake service. The invitation names an email. A
 * different account opening the link is refused and nothing is consumed.
 * The invited account accepts once and is shown the connection once.
 */
import {
  KEYS,
  acceptInvite,
  captureInvite,
  clearSession,
  createInvitation,
  loadInvite,
  pageReducer,
  copyText,
  recipientProblem,
  signedOutState,
  studioClient,
  type PageAction,
  type PageState,
  type SessionStore,
} from "../src/app/studio-admin/studio-admin-logic"

let failed = 0
const check = (label: string, ok: boolean) => {
  if (!ok) {
    failed += 1
    console.error("FAIL", label)
  }
}

const memory = (): SessionStore => {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    key: (index) => Array.from(values.keys())[index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
  }
}

const copied: string[] = []
const copyDoc = {
  body: {
    appendChild() {},
    removeChild() {},
  },
  createElement() {
    const area = {
      value: "",
      style: { position: "", top: "", left: "", opacity: "", fontSize: "" },
      contentEditable: "",
      readOnly: true,
      setSelectionRange(start: number, end: number) {
        copied.push(area.value.slice(start, end))
      },
    }
    return area
  },
  createRange() {
    return { selectNodeContents() {} }
  },
  getSelection() {
    return { removeAllRanges() {}, addRange() {} }
  },
  execCommand() {
    return true
  },
} as unknown as Document
check("copy takes the whole publishing token", copyText("om7-studio:abc", copyDoc) && copied[0] === "om7-studio:abc")
check("an empty copy does nothing", copyText("", copyDoc) === false)

check("an account id is not an email", recipientProblem("51bb9540-0011-70a3-becb-946be0f408af") !== null)
check("a real email is", recipientProblem("Viz@Example.test") === null)

const storage = memory()
check("a broken link is refused", captureInvite(storage, "?invite=nope") === "malformed")
check("a link is kept for the sign-in redirect", captureInvite(storage, "?invite=invite-12345678") === "stored")
check("and then it is in the session", storage.getItem(KEYS.invite) === "invite-12345678")

type Invite = { id: string; email: string; consumed: boolean }
const invites = new Map<string, Invite>()
const grants: Array<{ id: string; email: string; token: string }> = []

const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

const fetchImpl: typeof fetch = async (input, init) => {
  const url = new URL(String(input))
  const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
  const auth = new Headers(init?.headers).get("authorization") ?? ""
  const email = auth.includes("viz") ? "viz@example.test" : "dion@example.test"
  if (url.pathname === "/admin/invites" && init?.method === "POST") {
    if (email !== "dion@example.test") return respond(403, { error: { code: "forbidden", message: "no" } })
    const id = "invite-12345678"
    invites.set(id, { id, email: String(body.recipientEmail).toLowerCase(), consumed: false })
    return respond(201, {
      inviteId: id,
      expiresAt: "2026-11-01T00:00:00.000Z",
      destination: { label: "Viz → 777records777.studio → Sounds" },
      acceptUrl: `https://777records777.studio/admin?invite=${id}`,
      mailed: true,
    })
  }
  if (url.pathname === "/me/invites/view") {
    const invite = invites.get(String(body.inviteId))
    if (!invite || invite.email !== email) return respond(403, { error: { code: "invite_denied", message: "no" } })
    return respond(200, {
      inviteId: invite.id,
      expiresAt: "2026-11-01T00:00:00.000Z",
      destination: { label: "Viz → 777records777.studio → Sounds", pageUrl: "https://777records777.studio/us/artists/viz" },
    })
  }
  if (url.pathname === "/admin/invites/accept") {
    const invite = invites.get(String(body.inviteId))
    if (!invite || invite.email !== email || invite.consumed) {
      return respond(403, { error: { code: "invite_denied", message: "no" } })
    }
    invite.consumed = true
    const token = "om7-studio:abc"
    grants.push({ id: "grant-1", email, token })
    return respond(201, {
      grantId: "grant-1",
      connection: token,
      destination: { label: "Viz → 777records777.studio → Sounds" },
    })
  }
  if (url.pathname === "/admin/grants") {
    if (email !== "dion@example.test") return respond(403, { error: { code: "forbidden", message: "no" } })
    return respond(200, { grants: [] })
  }
  if (url.pathname === "/me/grants") return respond(200, { grants: [] })
  return respond(404, { error: { code: "not_found", message: "no" } })
}

const run = async (token: string, storage: SessionStore, act: (deps: { client: ReturnType<typeof studioClient>; storage: SessionStore; dispatch: (action: PageAction) => void; state: () => PageState }) => Promise<void>) => {
  let state = signedOutState()
  const dispatch = (action: PageAction) => { state = pageReducer(state, action) }
  await act({
    client: studioClient("https://studio.example", token, fetchImpl),
    storage,
    dispatch,
    state: () => state,
  })
  return state
}

const main = async () => {
const adminStore = memory()
const created = await run("dion-token", adminStore, async (deps) => {
  await createInvitation(deps, "viz-sounds", "Viz@Example.test")
})
check("the email is sent", created.created?.mailed === true)
check("the link is for the studio page", created.created?.acceptUrl === "https://777records777.studio/admin?invite=invite-12345678")

const strangerStore = memory()
strangerStore.setItem(KEYS.invite, "invite-12345678")
const stranger = await run("stranger-token", strangerStore, async (deps) => {
  await loadInvite(deps)
})
check("a different account is told so", stranger.invite.status === "refused" && stranger.invite.message.includes("different email"))
check("and the invitation is not consumed", invites.get("invite-12345678")?.consumed === false)
check("the stored link is dropped after that refusal", strangerStore.getItem(KEYS.invite) === null)

const vizStore = memory()
vizStore.setItem(KEYS.invite, "invite-12345678")
vizStore.setItem(KEYS.verifier, "left-over")
const viz = await run("viz-token", vizStore, async (deps) => {
  await loadInvite(deps)
  const ready = deps.state().invite
  if (ready.status !== "ready") return
  await acceptInvite(deps, ready.invite.inviteId)
})
check("Viz sees the page he was invited to", viz.invite.status === "accepted")
check("the connection is shown from this result", viz.connection?.value === "om7-studio:abc")
check("the invitation cannot be used again", invites.get("invite-12345678")?.consumed === true)
clearSession(vizStore)
check("sign-out leaves nothing in the session", vizStore.length === 0)

if (failed > 0) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log("studio admin page: ok")
}

main()
