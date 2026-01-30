import {
  MedusaRequest,
  MedusaResponse,
  refetchEntities,
} from "@medusajs/framework/http"

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

const toCsvCell = (value: unknown) => {
  if (value === null || value === undefined) {
    return ""
  }

  const str = String(value)
  if (str.includes(",") || str.includes("\n") || str.includes("\"")) {
    return `"${str.replace(/"/g, "\"\"")}"`
  }

  return str
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
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

  const header = [
    "submitted_at",
    "preorder_id",
    "email",
    "first_name",
    "last_name",
    "phone",
    "address_1",
    "address_2",
    "city",
    "province",
    "postal_code",
    "country",
    "items",
  ]

  const rows = preorders.map((cart: any) => {
    const address = cart.shipping_address || {}
    const items = (cart.items || []).map((item: any) => {
      const size =
        typeof item?.metadata?.preorder_size === "string"
          ? ` (Size: ${item.metadata.preorder_size})`
          : ""
      return `${item.title || "Item"} x${item.quantity ?? 0}${size}`
    })

    return [
      getSubmittedAt(cart) || "",
      cart.id || "",
      cart.email || "",
      address.first_name || "",
      address.last_name || "",
      address.phone || "",
      address.address_1 || "",
      address.address_2 || "",
      address.city || "",
      address.province || "",
      address.postal_code || "",
      (address.country_code || "").toUpperCase(),
      items.join(" | "),
    ]
  })

  const csv = [header, ...rows]
    .map((row) => row.map(toCsvCell).join(","))
    .join("\n")

  const dateStamp = new Date().toISOString().slice(0, 10)
  res.setHeader("Content-Type", "text/csv; charset=utf-8")
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="preorders-${dateStamp}.csv"`
  )

  return res.send(csv)
}
