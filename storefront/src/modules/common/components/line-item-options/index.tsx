import { HttpTypes } from "@medusajs/types"
import { Text, clx } from "@medusajs/ui"

type LineItemOptionsProps = {
  variant: HttpTypes.StoreProductVariant | undefined
  metadata?: Record<string, unknown> | null
  "data-testid"?: string
  "data-value"?: HttpTypes.StoreProductVariant
  className?: string
}

const LineItemOptions = ({
  variant,
  metadata,
  "data-testid": dataTestid,
  "data-value": dataValue,
  className,
}: LineItemOptionsProps) => {
  const preorderSize =
    typeof metadata?.preorder_size === "string"
      ? metadata.preorder_size
      : null

  return (
    <Text
      data-testid={dataTestid}
      data-value={dataValue}
      className={clx(
        "inline-block txt-medium text-ui-fg-subtle w-full overflow-hidden text-ellipsis",
        className
      )}
    >
      {preorderSize ? `Size: ${preorderSize}` : `Variant: ${variant?.title}`}
    </Text>
  )
}

export default LineItemOptions
