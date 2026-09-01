import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { authorizationHeader, siteManagerFailure } from "../../../../../site-manager/http"
import { createSiteManagerFromEnv } from "../../../../../site-manager/runtime"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const result = await createSiteManagerFromEnv().begin(
      authorizationHeader(req.headers.authorization),
      (req.body ?? {}) as Record<string, unknown>,
    )
    return res.status(201).json(result)
  } catch (error) {
    return siteManagerFailure(res, error)
  }
}
