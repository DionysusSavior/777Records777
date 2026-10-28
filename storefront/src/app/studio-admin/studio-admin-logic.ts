/**
 * Everything on the studio admin page that is not drawing it.
 *
 * Kept free of React so `scripts/test-studio-admin.ts` can drive the same
 * functions the page calls, with two different accounts and a fake service.
 *
 * What may be stored, and where:
 * - The id token lives in page memory only. Never sessionStorage, never
 *   localStorage, never the address bar.
 * - sessionStorage holds three things, all under `studio-admin.`: the PKCE
 *   verifier and the OAuth state for the length of one Cognito redirect, and
 *   the invitation id so it survives that redirect. Sign-out removes every
 *   key under the prefix.
 * - A connection string is shown once from page memory and never stored.
 */

export const STORAGE_PREFIX = "studio-admin."

export const KEYS = {
  verifier: `${STORAGE_PREFIX}pkce`,
  state: `${STORAGE_PREFIX}state`,
  invite: `${STORAGE_PREFIX}invite`,
} as const

export type SessionStore = {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type StudioConfig = {
  serviceUrl: string
  cognitoDomain: string
  clientId: string
}

const httpsOrigin = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === "https:" ? url : null
  } catch {
    return null
  }
}

/** Null when anything is missing, so the page says "not connected" and guesses nothing. */
export const studioConfig = (serviceUrl: string, cognitoDomain: string, clientId: string): StudioConfig | null => {
  const service = httpsOrigin(serviceUrl.trim())
  const cognito = httpsOrigin(cognitoDomain.trim())
  const client = clientId.trim()
  if (!service || !cognito || !/^[A-Za-z0-9]+$/.test(client)) return null
  return {
    serviceUrl: service.toString().replace(/\/+$/, ""),
    cognitoDomain: cognito.origin,
    clientId: client,
  }
}

export const base64url = (value: Uint8Array) => {
  let binary = ""
  for (let index = 0; index < value.length; index += 1) {
    binary += String.fromCharCode(value[index])
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

const decodeBase64url = (value: string) => {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new TextDecoder().decode(bytes)
}

const randomString = (size: number) => {
  const values = new Uint8Array(size)
  crypto.getRandomValues(values)
  return base64url(values)
}

export type Identity = { accountId: string; email: string | null }

/**
 * For display only: who this page thinks is signed in. The service verifies
 * the token itself and does not trust anything read here.
 */
export const identityFromIdToken = (token: string): Identity | null => {
  const parts = token.split(".")
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(decodeBase64url(parts[1])) as unknown
    if (!isRecord(payload) || typeof payload.sub !== "string" || !payload.sub) return null
    return { accountId: payload.sub, email: typeof payload.email === "string" ? payload.email : null }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Sign-in: Authorization Code + PKCE, with state.

export async function beginSignIn(storage: SessionStore, config: StudioConfig, redirectUri: string) {
  const verifier = randomString(32)
  const state = randomString(32)
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  storage.setItem(KEYS.verifier, verifier)
  storage.setItem(KEYS.state, state)
  const url = new URL("/oauth2/authorize", config.cognitoDomain)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("scope", "openid email")
  url.searchParams.set("state", state)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("code_challenge", base64url(new Uint8Array(digest)))
  return url.toString()
}

/**
 * Hands back the PKCE verifier only when the returned state matches the one
 * this browser sent. Both are removed either way: a state is good for one
 * return, and a mismatch means the code did not come from this sign-in.
 */
export const takeSignInSecrets = (storage: SessionStore, returnedState: string | null) => {
  const expected = storage.getItem(KEYS.state)
  const verifier = storage.getItem(KEYS.verifier)
  storage.removeItem(KEYS.state)
  storage.removeItem(KEYS.verifier)
  if (!expected || !returnedState || expected !== returnedState || !verifier) return null
  return verifier
}

export type SignInResult =
  | { kind: "none" }
  | { kind: "signed-in"; token: string }
  | { kind: "failed"; message: string }

export const SIGN_IN_MESSAGES = {
  cancelled: "Sign-in was cancelled or refused. Try again.",
  unconfirmed: "Sign-in could not be confirmed, so it was stopped. Try again.",
  unfinished: "Sign-in did not finish. Try again.",
} as const

export async function completeSignIn(
  storage: SessionStore,
  search: string,
  config: StudioConfig,
  redirectUri: string,
  fetchImpl: FetchLike,
): Promise<SignInResult> {
  const params = new URLSearchParams(search)
  const code = params.get("code")
  const error = params.get("error")
  if (code === null && error === null) return { kind: "none" }
  const verifier = takeSignInSecrets(storage, params.get("state"))
  if (error !== null) return { kind: "failed", message: SIGN_IN_MESSAGES.cancelled }
  if (!verifier || !code) return { kind: "failed", message: SIGN_IN_MESSAGES.unconfirmed }
  try {
    const response = await fetchImpl(new URL("/oauth2/token", config.cognitoDomain).toString(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }).toString(),
      credentials: "omit",
      cache: "no-store",
    })
    const payload = (await response.json()) as unknown
    if (!response.ok || !isRecord(payload) || typeof payload.id_token !== "string") {
      return { kind: "failed", message: SIGN_IN_MESSAGES.unfinished }
    }
    return { kind: "signed-in", token: payload.id_token }
  } catch {
    return { kind: "failed", message: SIGN_IN_MESSAGES.unfinished }
  }
}

/**
 * Copies text during the tap, the same way selecting it by hand does.
 *
 * `navigator.clipboard` rejects on this site and the rejection was ignored, so
 * the button looked dead. The selection has to happen before the click ends;
 * waiting on the clipboard promise is too late for the browser to allow it.
 */
export function copyText(value: string, doc: Document = document): boolean {
  if (value.length === 0) return false
  const area = doc.createElement("textarea")
  area.value = value
  area.style.position = "fixed"
  area.style.top = "0"
  area.style.left = "0"
  area.style.opacity = "0"
  area.style.fontSize = "16px"
  doc.body.appendChild(area)
  area.contentEditable = "true"
  area.readOnly = false
  const range = doc.createRange()
  range.selectNodeContents(area)
  const selection = doc.getSelection()
  if (selection) {
    selection.removeAllRanges()
    selection.addRange(range)
  }
  area.setSelectionRange(0, value.length)
  let copied = false
  try {
    copied = doc.execCommand("copy")
  } catch {
    copied = false
  }
  doc.body.removeChild(area)
  return copied
}

/** Removes everything sign-in and invitations put in the address bar. Null when there is nothing to remove. */
export const stripPageParams = (href: string) => {
  const url = new URL(href)
  let changed = false
  for (const name of ["code", "state", "error", "error_description", "invite"]) {
    if (url.searchParams.has(name)) {
      url.searchParams.delete(name)
      changed = true
    }
  }
  return changed ? `${url.pathname}${url.search}${url.hash}` : null
}

export function signOut(storage: SessionStore, config: StudioConfig, origin: string) {
  clearSession(storage)
  const url = new URL("/logout", config.cognitoDomain)
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("logout_uri", `${origin}/admin`)
  return url.toString()
}

export const clearSession = (storage: SessionStore) => {
  const keys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key !== null && key.startsWith(STORAGE_PREFIX)) keys.push(key)
  }
  keys.forEach((key) => storage.removeItem(key))
}

// ---------------------------------------------------------------------------
// Invitations in the address bar.

const INVITE_ID = /^[A-Za-z0-9_-]{8,128}$/

/** Moves `?invite=` into sessionStorage so it survives the Cognito redirect. */
export const captureInvite = (storage: SessionStore, search: string): "none" | "stored" | "malformed" => {
  const raw = new URLSearchParams(search).get("invite")
  if (raw === null) return "none"
  if (!INVITE_ID.test(raw)) return "malformed"
  storage.setItem(KEYS.invite, raw)
  return "stored"
}

export const storedInvite = (storage: SessionStore) => {
  const value = storage.getItem(KEYS.invite)
  return value !== null && INVITE_ID.test(value) ? value : null
}

export const clearInvite = (storage: SessionStore) => storage.removeItem(KEYS.invite)

// ---------------------------------------------------------------------------
// Talking to the studio service.

export class ServiceError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    Object.setPrototypeOf(this, ServiceError.prototype)
    this.name = "ServiceError"
    this.status = status
    this.code = code
  }
}

const MESSAGES: Record<string, string> = {
  invite_denied:
    "This invitation is for a different email. Sign out, then open the link again and sign in with the OM7 account for that email.",
  email_unverified:
    "That OM7 account's email is not confirmed yet, so this invitation cannot be accepted.",
  invite_used:
    "This invitation has already been used. If it was you, choose New connection under Your connections to get a fresh one.",
  invite_expired: "This invitation has expired. Ask the studio for a new one.",
  forbidden: "This account is not allowed to do that.",
  unauthorized: "Your sign-in has run out. Sign in again.",
  destination_denied: "That page is not one the studio publishes to.",
  not_found: "The studio service could not find that. Reload the page and try again.",
  rate_limited: "Too many requests. Wait a minute and try again.",
  site_unavailable: "The studio service is not available right now. Try again shortly.",
  network: "The studio service could not be reached. Check your connection and try again.",
  bad_response: "The studio service answered in a way this page does not understand. Reload the page before trying again.",
}

export const INVITE_LINK_BROKEN = "That invitation link is not complete. Ask the studio to send it again."

export const messageFor = (error: unknown) => {
  if (!(error instanceof ServiceError)) return MESSAGES.network
  const known = MESSAGES[error.code]
  if (known) return known
  if (error.code === "invalid_request") return error.message || "The studio service could not read that request."
  return "The studio service refused that. Try again, or ask the studio for help."
}

/** Refusals that will not change by retrying with this account, so the stored invitation is dropped. */
const DEFINITIVE_INVITE_REFUSALS = ["invite_denied", "invite_used", "invite_expired", "destination_denied", "invalid_request"]

export const isDefinitiveInviteRefusal = (error: unknown) =>
  error instanceof ServiceError && DEFINITIVE_INVITE_REFUSALS.indexOf(error.code) !== -1

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const text = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null)

export type InviteDetails = { inviteId: string; expiresAt: string; label: string; pageUrl: string | null }
export type IssuedConnection = { grantId: string; label: string; value: string }
export type MyConnection = { id: string; label: string; revoked: boolean; reconnectRequired: boolean }
export type AccessEntry = MyConnection & { accountId: string }
export type CreatedInvite = { inviteId: string; expiresAt: string; label: string; acceptUrl: string; mailed: boolean }

const badResponse = () => new ServiceError(200, "bad_response", "")

const destinationLabel = (payload: Record<string, unknown>) => {
  const destination = isRecord(payload.destination) ? payload.destination : {}
  return text(payload.label) ?? text(destination.label) ?? text(destination.id) ?? text(payload.destinationId)
}

const issued = (payload: Record<string, unknown>): IssuedConnection => {
  const grantId = text(payload.grantId)
  const value = text(payload.connection)
  const label = destinationLabel(payload)
  if (!grantId || !label || !value || !value.startsWith("om7-studio:")) throw badResponse()
  return { grantId, label, value }
}

const connectionEntry = (raw: unknown): MyConnection => {
  if (!isRecord(raw)) throw badResponse()
  const id = text(raw.id)
  const label = destinationLabel(raw)
  if (!id || !label) throw badResponse()
  return { id, label, revoked: raw.revoked === true, reconnectRequired: raw.reconnectRequired === true }
}

const list = (payload: Record<string, unknown>) => {
  if (!Array.isArray(payload.grants)) throw badResponse()
  return payload.grants as unknown[]
}

/**
 * Each answer is copied field by field into the shape the page renders, so a
 * token the service sent where none was expected is never held, never drawn
 * and never kept.
 */
export const studioClient = (serviceUrl: string, token: string, fetchImpl: FetchLike) => {
  const call = async (path: string, body?: Record<string, unknown>) => {
    let response: Response
    try {
      response = await fetchImpl(`${serviceUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined
          ? { authorization: `Bearer ${token}` }
          : { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "omit",
        cache: "no-store",
      })
    } catch {
      throw new ServiceError(0, "network", "")
    }
    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    if (!response.ok) {
      const error = isRecord(payload) && isRecord(payload.error) ? payload.error : {}
      throw new ServiceError(
        response.status,
        text(error.code) ?? (response.status >= 500 ? "site_unavailable" : `http_${response.status}`),
        text(error.message) ?? "",
      )
    }
    if (!isRecord(payload)) throw badResponse()
    return payload
  }

  return {
    async viewInvite(inviteId: string): Promise<InviteDetails> {
      const payload = await call("/me/invites/view", { inviteId })
      const label = destinationLabel(payload)
      const expiresAt = text(payload.expiresAt)
      if (!label || !expiresAt) throw badResponse()
      const destination = isRecord(payload.destination) ? payload.destination : {}
      return { inviteId, expiresAt, label, pageUrl: text(destination.pageUrl) }
    },
    async acceptInvite(inviteId: string) {
      return issued(await call("/admin/invites/accept", { inviteId }))
    },
    async myConnections() {
      return list(await call("/me/grants")).map(connectionEntry)
    },
    async renewMine(grantId: string) {
      return issued(await call("/me/grants/rotate", { grantId }))
    },
    async createInvite(destinationId: string, recipientEmail: string): Promise<CreatedInvite> {
      const payload = await call("/admin/invites", { destinationId, recipientEmail })
      const inviteId = text(payload.inviteId)
      const expiresAt = text(payload.expiresAt)
      const label = destinationLabel(payload)
      const acceptUrl = text(payload.acceptUrl)
      if (!inviteId || !expiresAt || !label || !acceptUrl || !httpsOrigin(acceptUrl)) throw badResponse()
      return { inviteId, expiresAt, label, acceptUrl, mailed: payload.mailed === true }
    },
    async access(): Promise<AccessEntry[]> {
      return list(await call("/admin/grants")).map((raw) => {
        const entry = connectionEntry(raw)
        const accountId = isRecord(raw) ? text(raw.principalSub) : null
        if (!accountId) throw badResponse()
        return { ...entry, accountId }
      })
    },
    async removeAccess(grantId: string) {
      const payload = await call("/admin/grants/revoke", { grantId })
      if (payload.revoked !== true) throw badResponse()
    },
    async cutOff(grantId: string) {
      await call("/admin/grants/rotate", { grantId })
    },
  }
}

export type StudioClient = ReturnType<typeof studioClient>

// ---------------------------------------------------------------------------
// Page state. One reducer, so sign-out has a single thing to reset.

export type InviteState =
  | { status: "none" }
  | { status: "waiting" }
  | { status: "loading" }
  | { status: "ready"; invite: InviteDetails }
  | { status: "accepting"; invite: InviteDetails }
  | { status: "accepted"; label: string }
  | { status: "refused"; message: string }
  | { status: "failed"; message: string }

export type ShownConnection = IssuedConnection & { replacesOld: boolean }

export type PageState = {
  token: string | null
  identity: Identity | null
  invite: InviteState
  connection: ShownConnection | null
  myConnections: MyConnection[] | null
  admin: "unknown" | "yes" | "no"
  access: AccessEntry[]
  created: CreatedInvite | null
  notice: string | null
}

export const signedOutState = (): PageState => ({
  token: null,
  identity: null,
  invite: { status: "none" },
  connection: null,
  myConnections: null,
  admin: "unknown",
  access: [],
  created: null,
  notice: null,
})

export type PageAction =
  | { type: "invite-waiting" }
  | { type: "invite-loading" }
  | { type: "invite-ready"; invite: InviteDetails }
  | { type: "invite-accepting" }
  | { type: "invite-accepted"; connection: IssuedConnection }
  | { type: "invite-refused"; message: string }
  | { type: "invite-failed"; message: string }
  | { type: "signed-in"; token: string }
  | { type: "sign-in-failed"; message: string }
  | { type: "connection-renewed"; connection: IssuedConnection }
  | { type: "connection-dismissed" }
  | { type: "my-connections"; connections: MyConnection[] }
  | { type: "admin-access"; access: AccessEntry[] }
  | { type: "admin-hidden" }
  | { type: "invite-created"; created: CreatedInvite }
  | { type: "notice"; message: string | null }
  | { type: "session-expired" }
  | { type: "signed-out" }

export function pageReducer(state: PageState, action: PageAction): PageState {
  switch (action.type) {
    case "invite-waiting":
      return { ...state, invite: { status: "waiting" } }
    case "invite-loading":
      return { ...state, invite: { status: "loading" } }
    case "invite-ready":
      return { ...state, invite: { status: "ready", invite: action.invite } }
    case "invite-accepting":
      return state.invite.status === "ready" ? { ...state, invite: { status: "accepting", invite: state.invite.invite } } : state
    case "invite-accepted":
      return {
        ...state,
        invite: { status: "accepted", label: action.connection.label },
        connection: { ...action.connection, replacesOld: false },
      }
    case "invite-refused":
      return { ...state, invite: { status: "refused", message: action.message } }
    case "invite-failed":
      return { ...state, invite: { status: "failed", message: action.message } }
    case "signed-in":
      return { ...state, token: action.token, identity: identityFromIdToken(action.token), notice: null }
    case "sign-in-failed":
      return { ...state, notice: action.message }
    case "connection-renewed":
      return { ...state, connection: { ...action.connection, replacesOld: true } }
    case "connection-dismissed":
      return { ...state, connection: null }
    case "my-connections":
      return { ...state, myConnections: action.connections }
    case "admin-access":
      return { ...state, admin: "yes", access: action.access }
    case "admin-hidden":
      return { ...state, admin: "no", access: [], created: null }
    case "invite-created":
      return { ...state, created: action.created }
    case "notice":
      return { ...state, notice: action.message }
    case "session-expired": {
      // A connection on screen is kept until dismissed: it belongs to this
      // person and cannot be shown again. Everything that needs the token goes.
      const invite: InviteState = state.invite.status === "accepted" || state.invite.status === "refused" || state.invite.status === "none"
        ? state.invite
        : { status: "waiting" }
      return { ...signedOutState(), invite, connection: state.connection, notice: MESSAGES.unauthorized }
    }
    case "signed-out":
      return signedOutState()
  }
}

export type Sections = {
  notConnected: boolean
  signIn: boolean
  invite: boolean
  connection: boolean
  myConnections: boolean
  admin: boolean
}

export const sectionsFor = (config: StudioConfig | null, state: PageState): Sections => {
  if (!config) {
    return { notConnected: true, signIn: false, invite: false, connection: false, myConnections: false, admin: false }
  }
  const signedIn = state.token !== null
  return {
    notConnected: false,
    signIn: !signedIn,
    invite: state.invite.status !== "none",
    connection: state.connection !== null,
    myConnections: signedIn && state.myConnections !== null,
    admin: signedIn && state.admin === "yes",
  }
}

// ---------------------------------------------------------------------------
// What the buttons do. The page and the test call these same functions.

export type PageDeps = {
  client: StudioClient
  storage: SessionStore
  dispatch: (action: PageAction) => void
}

const expired = (deps: PageDeps, error: unknown) => {
  if (error instanceof ServiceError && error.code === "unauthorized") {
    deps.dispatch({ type: "session-expired" })
    return true
  }
  return false
}

const inviteFailure = (deps: PageDeps, error: unknown) => {
  if (expired(deps, error)) return
  if (isDefinitiveInviteRefusal(error)) {
    clearInvite(deps.storage)
    deps.dispatch({ type: "invite-refused", message: messageFor(error) })
    return
  }
  deps.dispatch({ type: "invite-failed", message: messageFor(error) })
}

export async function loadInvite(deps: PageDeps) {
  const inviteId = storedInvite(deps.storage)
  if (!inviteId) return
  deps.dispatch({ type: "invite-loading" })
  try {
    deps.dispatch({ type: "invite-ready", invite: await deps.client.viewInvite(inviteId) })
  } catch (error) {
    inviteFailure(deps, error)
  }
}

export async function loadMyConnections(deps: PageDeps) {
  try {
    deps.dispatch({ type: "my-connections", connections: await deps.client.myConnections() })
  } catch (error) {
    if (!expired(deps, error)) deps.dispatch({ type: "notice", message: messageFor(error) })
  }
}

export async function loadAdmin(deps: PageDeps) {
  try {
    deps.dispatch({ type: "admin-access", access: await deps.client.access() })
  } catch (error) {
    if (expired(deps, error)) return
    deps.dispatch({ type: "admin-hidden" })
    if (!(error instanceof ServiceError && error.code === "forbidden")) {
      deps.dispatch({ type: "notice", message: messageFor(error) })
    }
  }
}

export async function loadAccount(deps: PageDeps) {
  await Promise.all([loadInvite(deps), loadMyConnections(deps), loadAdmin(deps)])
}

export async function acceptInvite(deps: PageDeps, inviteId: string) {
  deps.dispatch({ type: "invite-accepting" })
  try {
    const connection = await deps.client.acceptInvite(inviteId)
    clearInvite(deps.storage)
    deps.dispatch({ type: "invite-accepted", connection })
  } catch (error) {
    inviteFailure(deps, error)
    return
  }
  await loadMyConnections(deps)
}

export async function renewConnection(deps: PageDeps, grantId: string) {
  try {
    deps.dispatch({ type: "connection-renewed", connection: await deps.client.renewMine(grantId) })
  } catch (error) {
    if (!expired(deps, error)) deps.dispatch({ type: "notice", message: messageFor(error) })
    return
  }
  await loadMyConnections(deps)
}

const EMAIL = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/

export const recipientProblem = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return "Enter the person's email address."
  if (!EMAIL.test(trimmed)) return "That does not look like an email address."
  return null
}

export async function createInvitation(deps: PageDeps, destinationId: string, recipient: string) {
  const problem = recipientProblem(recipient)
  if (problem) {
    deps.dispatch({ type: "notice", message: problem })
    return
  }
  try {
    deps.dispatch({ type: "invite-created", created: await deps.client.createInvite(destinationId, recipient.trim()) })
    deps.dispatch({ type: "notice", message: null })
  } catch (error) {
    if (!expired(deps, error)) deps.dispatch({ type: "notice", message: messageFor(error) })
  }
}

export const ADMIN_NOTICES = {
  removed: "Access removed. New uploads to that page are refused. Anything already published stays.",
  cutOff: "Connection cut off. The person has to make a new connection on this page before they can publish again.",
} as const

async function adminChange(deps: PageDeps, change: () => Promise<void>, done: string) {
  try {
    await change()
  } catch (error) {
    if (!expired(deps, error)) deps.dispatch({ type: "notice", message: messageFor(error) })
    return
  }
  deps.dispatch({ type: "notice", message: done })
  await Promise.all([loadAdmin(deps), loadMyConnections(deps)])
}

export const removeAccess = (deps: PageDeps, grantId: string) =>
  adminChange(deps, () => deps.client.removeAccess(grantId), ADMIN_NOTICES.removed)

export const cutOffConnection = (deps: PageDeps, grantId: string) =>
  adminChange(deps, () => deps.client.cutOff(grantId), ADMIN_NOTICES.cutOff)

export const formatExpiry = (iso: string) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })
}
