import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createSiteManagerFromEnv } from "../../../../../site-manager/runtime"

/**
 * Says whether publishing is actually configured, which `/health` cannot.
 *
 * On 3 November the service answered `/health` with OK for a week while every
 * publish attempt returned 503. Medusa's health check proves the process is
 * listening; it says nothing about whether `createSiteManagerFromEnv()` can
 * load its five required variables. The phone was told to publish here and
 * could not, and nothing reported it.
 *
 * DELIBERATELY NOT RENDER'S HEALTH CHECK PATH. Render restarts instances and
 * refuses deploys when the health check fails, so wiring this there would let
 * a publishing misconfiguration take down the shop. The storefront already
 * states the same rule in the other direction - "A COMMERCE OUTAGE MUST NOT
 * TAKE DOWN PAGES THAT SELL NOTHING" - and it holds both ways. Point
 * monitoring at this; point Render at `/health`.
 *
 * Says ready or not ready and nothing else. Which variable is missing, and
 * what it should contain, are not facts an anonymous caller is owed - the same
 * reason `siteManagerFailure` returns a bare `site_unavailable`. The detail
 * goes to the log, where an operator can already see it.
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  try {
    createSiteManagerFromEnv()
    return res.status(200).json({ publishing: "ready" })
  } catch (error) {
    console.error(
      "site-manager is not configured",
      error instanceof Error ? error.message : "unknown error",
    )
    return res.status(503).json({ publishing: "unconfigured" })
  }
}
