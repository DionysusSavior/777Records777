import assert from "node:assert/strict"
import { resolveSiteManagerEndpoint } from "../src/lib/site-manager-discovery.ts"

let checks = 0
const check = (name: string, fn: () => void) => {
  fn()
  checks += 1
  void name
}

// The fallback has to keep producing exactly what it produced before, or every
// site that has not set the override silently changes endpoint.
check("backend derivation is unchanged", () => {
  const r = resolveSiteManagerEndpoint(
    { MEDUSA_BACKEND_URL: "https://seven77records777.onrender.com" },
    { requireHttps: true }
  )
  assert(r.ok)
  assert.equal(r.endpoint, "https://seven77records777.onrender.com/om7/site-manager/v1")
  assert.equal(r.source, "backend")
})

check("a path on the backend URL is replaced, not nested", () => {
  const r = resolveSiteManagerEndpoint(
    { MEDUSA_BACKEND_URL: "https://shop.example/store" },
    { requireHttps: true }
  )
  assert(r.ok)
  assert.equal(r.endpoint, "https://shop.example/om7/site-manager/v1")
})

check("NEXT_PUBLIC_MEDUSA_BACKEND_URL is the second choice", () => {
  const r = resolveSiteManagerEndpoint(
    { NEXT_PUBLIC_MEDUSA_BACKEND_URL: "https://shop.example" },
    { requireHttps: true }
  )
  assert(r.ok)
  assert.equal(r.endpoint, "https://shop.example/om7/site-manager/v1")
})

// The override is the whole point: a base, used as given.
check("the override is used verbatim with no path appended", () => {
  const r = resolveSiteManagerEndpoint(
    {
      OM7_SITE_MANAGER_ENDPOINT: "https://publish.777records777.studio",
      MEDUSA_BACKEND_URL: "https://seven77records777.onrender.com",
    },
    { requireHttps: true }
  )
  assert(r.ok)
  assert.equal(r.endpoint, "https://publish.777records777.studio")
  assert.equal(r.source, "override")
})

check("the override keeps a path it was given", () => {
  const r = resolveSiteManagerEndpoint(
    { OM7_SITE_MANAGER_ENDPOINT: "https://pub.example/om7/v1" },
    { requireHttps: true }
  )
  assert(r.ok)
  assert.equal(r.endpoint, "https://pub.example/om7/v1")
})

check("a trailing slash is stripped", () => {
  const r = resolveSiteManagerEndpoint(
    { OM7_SITE_MANAGER_ENDPOINT: "https://publish.777records777.studio/" },
    { requireHttps: true }
  )
  assert(r.ok)
  assert.equal(r.endpoint, "https://publish.777records777.studio")
})

// This deployment really did ship a variable with a trailing space.
check("surrounding whitespace is trimmed", () => {
  const r = resolveSiteManagerEndpoint(
    { OM7_SITE_MANAGER_ENDPOINT: "  https://publish.777records777.studio " },
    { requireHttps: true }
  )
  assert(r.ok)
  assert.equal(r.endpoint, "https://publish.777records777.studio")
})

check("an empty or whitespace-only override falls through to the backend", () => {
  const r = resolveSiteManagerEndpoint(
    { OM7_SITE_MANAGER_ENDPOINT: "   ", MEDUSA_BACKEND_URL: "https://shop.example" },
    { requireHttps: true }
  )
  assert(r.ok)
  assert.equal(r.source, "backend")
  assert.equal(r.endpoint, "https://shop.example/om7/site-manager/v1")
})

check("http is refused in production, for the override and the backend alike", () => {
  const o = resolveSiteManagerEndpoint(
    { OM7_SITE_MANAGER_ENDPOINT: "http://publish.example" },
    { requireHttps: true }
  )
  assert.equal(o.ok, false)
  assert.equal(o.ok === false && o.reason, "insecure")

  const b = resolveSiteManagerEndpoint(
    { MEDUSA_BACKEND_URL: "http://shop.example" },
    { requireHttps: true }
  )
  assert.equal(b.ok, false)
  assert.equal(b.ok === false && b.reason, "insecure")
})

check("http is allowed when https is not required, so local dev still works", () => {
  const r = resolveSiteManagerEndpoint({}, { requireHttps: false })
  assert(r.ok)
  assert.equal(r.endpoint, "http://localhost:9000/om7/site-manager/v1")
})

check("the localhost default is refused in production", () => {
  const r = resolveSiteManagerEndpoint({}, { requireHttps: true })
  assert.equal(r.ok, false)
})

// A typo answers 503 rather than throwing a 500 out of the route.
check("an unparseable value is reported, not thrown", () => {
  const o = resolveSiteManagerEndpoint(
    { OM7_SITE_MANAGER_ENDPOINT: "publish.777records777.studio" },
    { requireHttps: true }
  )
  assert.equal(o.ok, false)
  assert.equal(o.ok === false && o.reason, "unparseable")

  const b = resolveSiteManagerEndpoint(
    { MEDUSA_BACKEND_URL: "not a url at all" },
    { requireHttps: true }
  )
  assert.equal(b.ok, false)
  assert.equal(b.ok === false && b.reason, "unparseable")
})

/**
 * The cutover itself, asserted against the live shape rather than described.
 *
 * The client appends these four itself (OM7SiteManager.swift:500-650). All
 * four were confirmed answering on the replacement on 4 Nov - 403
 * destination_denied, 400 invalid_receipt, 401 unauthorized, 400
 * invalid_request - while Render answered 404 Cannot POST on the last two,
 * having never implemented them.
 */
check("the cutover value produces the four routes the client calls", () => {
  const r = resolveSiteManagerEndpoint(
    { OM7_SITE_MANAGER_ENDPOINT: "https://publish.777records777.studio" },
    { requireHttps: true }
  )
  assert(r.ok)
  const base = new URL(r.endpoint + "/")
  assert.equal(new URL("uploads", base).toString(), "https://publish.777records777.studio/uploads")
  assert.equal(new URL("uploads/complete", base).toString(), "https://publish.777records777.studio/uploads/complete")
  assert.equal(new URL("catalogue", base).toString(), "https://publish.777records777.studio/catalogue")
  assert.equal(new URL("catalogue/remove", base).toString(), "https://publish.777records777.studio/catalogue/remove")
})

console.log(`Site Manager endpoint resolution: ${checks} checks passed`)
