/**
 * Where the Site Manager publishing endpoint comes from.
 *
 * It used to be derived from MEDUSA_BACKEND_URL with `/om7/site-manager/v1`
 * appended. That coupled publishing to the shop: the two could not be moved
 * apart, because the one variable naming the endpoint is also the variable the
 * storefront buys through. On 4 November that coupling WAS the outage -
 * discovery named a Render endpoint whose configuration had been broken since
 * 29 October, while a complete service answered correctly on another origin
 * and there was no way to name it without moving commerce too.
 *
 * So OM7_SITE_MANAGER_ENDPOINT overrides it, and is used VERBATIM.
 *
 * Verbatim matters. The client appends `uploads`, `uploads/complete`,
 * `catalogue` and `catalogue/remove` to this value itself
 * (OM7SiteManager.swift:500-650), so what belongs here is a BASE. The
 * `/om7/site-manager/v1` prefix is one service's shape, not the protocol's -
 * the replacement serves those four routes at its own origin - which is why
 * the override must not have a path forced onto it the way the fallback does.
 */

export type SiteManagerEndpointSource = "override" | "backend"

export type ResolvedSiteManagerEndpoint =
  | { ok: true; endpoint: string; source: SiteManagerEndpointSource }
  | { ok: false; reason: "unparseable" | "insecure" }

export type SiteManagerDiscoveryEnv = {
  OM7_SITE_MANAGER_ENDPOINT?: string
  MEDUSA_BACKEND_URL?: string
  NEXT_PUBLIC_MEDUSA_BACKEND_URL?: string
}

const BACKEND_ENDPOINT_PATH = "/om7/site-manager/v1"

/**
 * Every value here is trimmed before parsing. Not defensive habit: this
 * deployment shipped NEXT_PUBLIC_BASE_URL with a trailing space for weeks.
 * `new URL()` happens to tolerate it, so the bug stayed invisible rather than
 * being absent - trimming makes it absent.
 */
const read = (value: string | undefined): string => (value ?? "").trim()

const withoutTrailingSlash = (value: string): string => value.replace(/\/$/, "")

export const resolveSiteManagerEndpoint = (
  env: SiteManagerDiscoveryEnv,
  { requireHttps }: { requireHttps: boolean }
): ResolvedSiteManagerEndpoint => {
  const override = read(env.OM7_SITE_MANAGER_ENDPOINT)

  if (override) {
    let parsed: URL
    try {
      parsed = new URL(override)
    } catch {
      return { ok: false, reason: "unparseable" }
    }
    if (requireHttps && parsed.protocol !== "https:") {
      return { ok: false, reason: "insecure" }
    }
    // The override keeps its own path. A site may well serve the protocol
    // under a prefix; that is its business, and appending ours would break it.
    return {
      ok: true,
      endpoint: withoutTrailingSlash(parsed.toString()),
      source: "override",
    }
  }

  const backend =
    read(env.MEDUSA_BACKEND_URL) ||
    read(env.NEXT_PUBLIC_MEDUSA_BACKEND_URL) ||
    "http://localhost:9000"

  let backendUrl: URL
  try {
    backendUrl = new URL(backend)
  } catch {
    return { ok: false, reason: "unparseable" }
  }
  if (requireHttps && backendUrl.protocol !== "https:") {
    return { ok: false, reason: "insecure" }
  }

  // Absolute, so any path already on the backend URL is replaced rather than
  // nested. Unchanged from the original derivation on purpose: this branch
  // still has to produce byte-identical output for every site that has not
  // set the override.
  return {
    ok: true,
    endpoint: withoutTrailingSlash(
      new URL(BACKEND_ENDPOINT_PATH, backendUrl).toString()
    ),
    source: "backend",
  }
}
