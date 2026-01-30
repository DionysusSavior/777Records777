import {
  MedusaRequest,
  MedusaResponse,
  refetchEntities,
} from "@medusajs/framework/http"

type PreorderQuery = {
  limit?: string
  offset?: string
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

const isPreorderCart = (cart: { metadata?: Record<string, unknown> | null }) => {
  const flag = cart?.metadata?.preorder_submitted
  const deleted = cart?.metadata?.preorder_deleted
  if (deleted === true || deleted === "true") {
    return false
  }

  return flag === true || flag === "true"
}

const getSubmittedAt = (cart: {
  metadata?: Record<string, unknown> | null
  created_at?: string
}) => {
  const submittedAt = cart?.metadata?.preorder_submitted_at
  return typeof submittedAt === "string" ? submittedAt : cart.created_at
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { limit, offset } = req.query as PreorderQuery

  const parsedLimit = Number(limit)
  const parsedOffset = Number(offset)

  const take = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT
  const skip = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0

  const { data: carts } = await refetchEntities({
    entity: "cart",
    idOrFilter: {},
    scope: req.scope,
    fields: [
      "id",
      "email",
      "created_at",
      "metadata",
      "shipping_address.*",
      "items.title",
      "items.quantity",
      "items.metadata",
    ],
  })

  const preorders = carts
    .filter(isPreorderCart)
    .sort((a: any, b: any) => {
      const aDate = new Date(getSubmittedAt(a) || 0).getTime()
      const bDate = new Date(getSubmittedAt(b) || 0).getTime()

      return bDate - aDate
    })

  const paged = preorders.slice(skip, skip + take)

  return res.json({
    preorders: paged,
    count: preorders.length,
    offset: skip,
    limit: take,
  })
}
