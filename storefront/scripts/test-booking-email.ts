import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * A booking inbox stays off the artist and out of the browser (28 Nov 2026).
 *
 * Read as source rather than imported: booking-email.ts imports
 * "server-only", which throws outside a React server build, and that throw is
 * the point of it.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const read = (path: string) => readFileSync(join(root, path), "utf8")

const artists = read("src/lib/artists.ts")
const booking = read("src/lib/booking-email.ts")
const route = read("src/app/api/feature-request/route.ts")
const nextConfig = read("next.config.js")
const amplify = read("../amplify.yml")

let checks = 0
const check = (name: string, fn: () => void) => {
  try {
    fn()
  } catch (error) {
    console.error(`booking email: ${name}`)
    throw error
  }
  checks += 1
}

const handles = Array.from(artists.matchAll(/^\s+handle: "([^"]+)"/gm), (m) => m[1])
const envName = (handle: string) => `BOOKING_EMAIL_${handle.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`

check("the artists file names no inbox", () => {
  // Everything on an artist reaches the browser: the home page passes whole
  // artists to a client component, and the file is public on GitHub.
  assert.doesNotMatch(artists, /bookingEmail\s*:/)
  assert.doesNotMatch(artists, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/)
})

check("the inboxes are read on the server only", () => {
  assert.match(booking, /^import "server-only"\n/)
  assert.doesNotMatch(booking, /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/)
})

check("every artist has an inbox, by a static read Next can inline", () => {
  assert.ok(handles.length >= 2, `found handles: ${handles.join(", ")}`)
  for (const handle of handles) {
    const name = envName(handle)
    const key = /^[a-z0-9]+$/.test(handle) ? handle : `"${handle}"`
    assert.ok(booking.includes(`  ${key}: process.env.${name},`), `${handle} reads ${name}`)
    assert.ok(nextConfig.includes(`    ${name}: process.env.${name},`), `next.config.js inlines ${name}`)
  }
  assert.match(amplify, /grep -E '\^\(FEATURE_REQUEST_URL\|BOOKING_EMAIL_\[A-Z_\]\+\)=' >> \.env\.production/)
})

check("the route sends to the server's inbox, and refuses without one", () => {
  assert.match(route, /import \{ bookingEmailFor \} from "@lib\/booking-email"/)
  assert.match(route, /const to = bookingEmailFor\(artist\.handle\)\n\s+if \(!to\) \{/)
  assert.match(route, /^\s+to,\n/m)
  assert.doesNotMatch(route, /artist\.bookingEmail/)
})

check("only the route imports it", () => {
  // A second importer is how an inbox finds its way into a client bundle;
  // "server-only" stops a client one at build time, and this names the rest.
  const walk = (dir: string): string[] =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
    )
  const importers = walk("src")
    .filter((file) => /\.(ts|tsx|js|jsx|mjs)$/.test(file))
    .filter((file) => /lib\/booking-email["']/.test(read(file)))
  assert.deepEqual(importers, [join("src", "app", "api", "feature-request", "route.ts")])
})

console.log(`booking email: ${checks} checks passed`)
