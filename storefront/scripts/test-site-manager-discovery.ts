import { readFileSync } from "node:fs"
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

/**
 * A source assertion, not a behaviour one, because no test of this pure
 * function could have caught the bug it guards.
 *
 * The resolver was correct and its 13 checks passed while production answered
 * 503. The fault was the CALL: `resolveSiteManagerEndpoint(process.env, ...)`
 * hands Next an object it cannot statically analyse, so the literal
 * `process.env.FOO` substitutions never happen and the SSR Lambda reads its own
 * environment - which on Amplify does not carry console variables. Direct
 * member access at the call site is what makes the values exist at all, so
 * that is the thing worth asserting.
 */
check("the route names each variable directly instead of passing process.env", () => {
  const source = readFileSync(
    new URL("../src/app/.well-known/om7-site-manager.json/route.ts", import.meta.url),
    "utf8"
  )
  // Comments are stripped first. The comment explaining this bug quotes the
  // broken call verbatim, which tripped this very assertion on the first run.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
  assert.ok(
    !/resolveSiteManagerEndpoint\(\s*process\.env\b/.test(code),
    "route.ts passes process.env wholesale, which defeats Next's build-time inlining"
  )
  for (const name of [
    "OM7_SITE_MANAGER_ENDPOINT",
    "MEDUSA_BACKEND_URL",
    "NEXT_PUBLIC_MEDUSA_BACKEND_URL",
  ]) {
    assert.ok(
      code.includes(`process.env.${name}`),
      `route.ts must read process.env.${name} by direct member access`
    )
  }
})

/**
 * The guard for the failure that actually happened.
 *
 * Naming the variable directly at the call site is necessary and NOT
 * sufficient. On Amplify a server-side variable that is not listed in
 * next.config.js's `env` block is undefined at request time whatever scope it
 * is set in - branch and app were both tried on 5 Nov and both read empty.
 * Deleting the entry here would not fail a single behavioural test: discovery
 * would quietly fall through to the backend branch and name the wrong host,
 * which is exactly what it did for three builds.
 */
check("next.config.js declares OM7_SITE_MANAGER_ENDPOINT for build-time inlining", () => {
  const config = readFileSync(new URL("../next.config.js", import.meta.url), "utf8")
  const envBlock = config.match(/env:\s*\{[\s\S]*?\n  \}/)
  assert.ok(envBlock, "next.config.js has no env block")
  assert.ok(
    /OM7_SITE_MANAGER_ENDPOINT:\s*process\.env\.OM7_SITE_MANAGER_ENDPOINT/.test(envBlock[0]),
    "OM7_SITE_MANAGER_ENDPOINT is not inlined in next.config.js's env block, so it is undefined at request time on Amplify"
  )
})

console.log(`Site Manager endpoint resolution: ${checks} checks passed`)
