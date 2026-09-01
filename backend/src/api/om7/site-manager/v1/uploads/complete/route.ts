import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { authorizationHeader, siteManagerFailure } from "../../../../../../site-manager/http"
import { createSiteManagerFromEnv } from "../../../../../../site-manager/runtime"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = (req.body ?? {}) as { uploadReceipt?: unknown }
    const result = await createSiteManagerFromEnv().complete(
      authorizationHeader(req.headers.authorization),
      body.uploadReceipt,
    )
    return res.status(200).json(result)
  } catch (error) {
    return siteManagerFailure(res, error)
  }
}
