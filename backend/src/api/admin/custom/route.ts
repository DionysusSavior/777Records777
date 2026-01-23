import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

type VariantAvailabilityQuery = {
  variantId?: string;
};

type InventoryLevel = {
  stocked_quantity?: number;
  reserved_quantity?: number;
};

type InventoryItemLink = {
  required_quantity?: number;
  inventory?: {
    location_levels?: InventoryLevel[];
  };
};

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { variantId } = req.query as VariantAvailabilityQuery;

  if (!variantId) {
    return res.status(400).json({ error: "variantId is required" });
  }

  try {
    const query = req.scope.resolve("query");

    const { data } = await query.graph({
      entity: "product_variant",
      filters: { id: variantId },
      fields: [
        "id",
        "allow_backorder",
        "manage_inventory",
        "inventory_items.required_quantity",
        "inventory_items.inventory.location_levels.stocked_quantity",
        "inventory_items.inventory.location_levels.reserved_quantity",
      ],
    });

    const variant = data?.[0];

    if (!variant) {
      return res.status(404).json({ error: "Variant not found" });
    }

    const allowBackorder = variant.allow_backorder === true;
    const manageInventory = variant.manage_inventory === true;

    let preorder = false;
    let sellable = false;

    if (!manageInventory) {
      sellable = true;
    } else if (allowBackorder) {
      sellable = true;
      preorder = true;
    } else {
      const inventoryItems = Array.isArray(variant.inventory_items)
        ? (variant.inventory_items as InventoryItemLink[])
        : [];

      let availableUnits = Infinity;

      for (const link of inventoryItems) {
        const requiredQty = Number(link.required_quantity ?? 1);
        const levels = link.inventory?.location_levels ?? [];
        const available = levels.reduce((sum, level) => {
          const stocked = Number(level.stocked_quantity ?? 0);
          const reserved = Number(level.reserved_quantity ?? 0);
          const net = Math.max(stocked - reserved, 0);
          return sum + net;
        }, 0);

        const units =
          requiredQty > 0 ? Math.floor(available / requiredQty) : 0;
        availableUnits = Math.min(availableUnits, units);
      }

      sellable = Number.isFinite(availableUnits) && availableUnits > 0;
    }

    return res.json({ sellable, preorder });
  } catch (error: any) {
    return res.status(500).json({
      error: error?.message || "Failed to calculate availability",
    });
  }
}
