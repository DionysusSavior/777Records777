import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

type PreorderParams = {
  id: string
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params as PreorderParams

  const cartModuleService = req.scope.resolve(Modules.CART)

  const cart = await cartModuleService.retrieveCart(id)
  if (!cart) {
    return res.status(404).json({ message: "Preorder not found" })
  }

  const metadata = {
    ...(cart.metadata || {}),
    preorder_deleted: true,
    preorder_deleted_at: new Date().toISOString(),
  }

  await cartModuleService.updateCarts(id, {
    metadata,
  })

  return res.json({ id, deleted: true })
}
