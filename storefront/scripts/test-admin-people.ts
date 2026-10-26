/**
 * The People panel's invitation capture, without a browser.
 *
 * A value that is not an invitation id is ignored. A real id is kept only in
 * sessionStorage, and signing the account out removes it with the rest of
 * the studio session.
 */
import { captureAdminInvite } from "../src/app/studio-admin/admin-people"
import { KEYS, clearSession, type SessionStore } from "../src/app/studio-admin/studio-admin-logic"

let failed = 0
const check = (label: string, ok: boolean) => {
  if (!ok) {
    failed += 1
    console.error("FAIL", label)
  }
}

const values = new Map<string, string>()
const storage: SessionStore = {
  get length() { return values.size },
  key: (index) => Array.from(values.keys())[index] ?? null,
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value) },
  removeItem: (key) => { values.delete(key) },
}

const install = (search: string) => {
  Object.assign(globalThis, {
    window: {
      location: { search },
      sessionStorage: storage,
    },
  })
}

install("?adminInvite=not-an-id&next=https://evil.example")
captureAdminInvite()
check("a non-id invitation is ignored", storage.getItem("studio-admin.adminInvite") === null)

install("?adminInvite=11111111-1111-4111-8111-111111111111")
captureAdminInvite()
check("a real invitation id is stored", storage.getItem("studio-admin.adminInvite") === "11111111-1111-4111-8111-111111111111")
storage.setItem(KEYS.verifier, "left-over")
clearSession(storage)
check("sign-out removes the administrator invitation", storage.length === 0)

if (failed > 0) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log("admin people: ok")
