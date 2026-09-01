import type { MedusaResponse } from "@medusajs/framework/http"
import { SiteManagerError } from "./core"

export const authorizationHeader = (value: string | string[] | undefined) =>
  Array.isArray(value) ? undefined : value

export const siteManagerFailure = (res: MedusaResponse, error: unknown) => {
  if (error instanceof SiteManagerError) {
    return res.status(error.status).json({ error: { code: error.code, message: error.message } })
  }

  // Neither storage-provider errors nor configuration details are returned.
  // In particular, never log req.body or Authorization in a caller of this.
  console.error("site-manager request failed", error instanceof Error ? error.message : "unknown error")
  return res.status(503).json({
    error: {
      code: "site_unavailable",
      message: "The site's publishing service is unavailable.",
    },
  })
}
