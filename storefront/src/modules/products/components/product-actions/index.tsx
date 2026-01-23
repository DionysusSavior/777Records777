"use client"

import { addToCart } from "@lib/data/cart"
import { useIntersection } from "@lib/hooks/use-in-view"
import { HttpTypes } from "@medusajs/types"
import { Button } from "@medusajs/ui"
import Divider from "@modules/common/components/divider"
import OptionSelect from "@modules/products/components/product-actions/option-select"
import { isEqual } from "lodash"
import { useParams, usePathname, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import ProductPrice from "../product-price"
import MobileActions from "./mobile-actions"
import { useRouter } from "next/navigation"

type ProductActionsProps = {
  product: HttpTypes.StoreProduct
  region: HttpTypes.StoreRegion
  disabled?: boolean
}

const optionsAsKeymap = (
  variantOptions: HttpTypes.StoreProductVariant["options"]
) => {
  return variantOptions?.reduce((acc: Record<string, string>, varopt: any) => {
    // Prefer the product option id key when present.
    const key = varopt.option?.id || varopt.option_id || varopt.optionId

    if (key) acc[key] = varopt.value
    return acc
  }, {})
}

export default function ProductActions({
  product,
  disabled,
}: ProductActionsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [options, setOptions] = useState<Record<string, string | undefined>>({})
  const [isAdding, setIsAdding] = useState(false)
  const countryCode = useParams().countryCode as string

  useEffect(() => {
    // If there is exactly 1 variant, auto-select THAT variant's options (using option_id keys)
    if (product.variants?.length === 1) {
      const v = product.variants[0]
      const variantOptions = optionsAsKeymap(v.options)
      if (!variantOptions) return

      setOptions((prev) =>
        isEqual(prev, variantOptions) ? prev : variantOptions
      )
    }
  }, [product.variants])

  const selectedVariant = useMemo(() => {
    if (!product.variants || product.variants.length === 0) {
      return undefined
    }

    // Hard fallback: if there is only one variant, always select it.
    // This prevents "Select variant" deadlocks when Medusa keeps a Default option.
    if (product.variants.length === 1) {
      return product.variants[0]
    }

    // Normal multi-option matching
    return product.variants.find((v) => {
      const variantOptions = optionsAsKeymap(v.options)
      return isEqual(variantOptions, options)
    })
  }, [product.variants, options])

  // update the options when a variant is selected
  const setOptionValue = (optionId: string, value: string) => {
    setOptions((prev) => ({
      ...prev,
      [optionId]: value,
    }))
  }

  //check if the selected options produce a valid variant
  const isValidVariant = useMemo(() => {
    if (!product.variants || product.variants.length === 0) {
      return false
    }

    // If only one variant exists, options selection should not be required.
    if (product.variants.length === 1) {
      return true
    }

    return product.variants?.some((v) => {
      const variantOptions = optionsAsKeymap(v.options)
      return isEqual(variantOptions, options)
    })
  }, [product.variants, options])

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    const value = isValidVariant ? selectedVariant?.id : null

    if (params.get("v_id") === value) {
      return
    }

    if (value) {
      params.set("v_id", value)
    } else {
      params.delete("v_id")
    }

    router.replace(pathname + "?" + params.toString())
  }, [selectedVariant, isValidVariant])

  // ===== Product Action State Machine =====
  const needsSelection = !selectedVariant || !isValidVariant

  const isSellable =
    !!selectedVariant &&
    (selectedVariant.manage_inventory === false ||
      selectedVariant.allow_backorder === true)

  const isPreorder =
    !!selectedVariant &&
    selectedVariant.manage_inventory === true &&
    selectedVariant.allow_backorder === true

  const isInStock = isSellable && !isPreorder

  const isSoldOut = !!selectedVariant && !isSellable

  const actionLabel = needsSelection
    ? "Select variant"
    : isPreorder
    ? "Preorder"
    : isInStock
    ? "Add to cart"
    : "Out of stock"

  const actionDisabled =
    needsSelection || isAdding || !!disabled || isSoldOut

  const actionsRef = useRef<HTMLDivElement>(null)

  const inView = useIntersection(actionsRef, "0px")

  // add the selected variant to the cart
  const handleAddToCart = async () => {
    if (!selectedVariant?.id) return null

    setIsAdding(true)

    await addToCart({
      variantId: selectedVariant.id,
      quantity: 1,
      countryCode,
    })

    setIsAdding(false)
  }

  return (
    <>
      <div className="flex flex-col gap-y-2" ref={actionsRef}>
        <div>
          {(product.variants?.length ?? 0) > 1 && (
            <div className="flex flex-col gap-y-4">
              {(product.options || []).map((option) => {
                return (
                  <div key={option.id}>
                    <OptionSelect
                      option={option}
                      current={options[option.id]}
                      updateOption={setOptionValue}
                      title={option.title ?? ""}
                      data-testid="product-options"
                      disabled={!!disabled || isAdding}
                    />
                  </div>
                )
              })}
              <Divider />
            </div>
          )}
        </div>

        <ProductPrice product={product} variant={selectedVariant} />

        <Button
          onClick={handleAddToCart}
          disabled={actionDisabled}
          variant="primary"
          className="w-full h-10"
          isLoading={isAdding}
          data-testid="add-product-button"
        >
          {actionLabel}
        </Button>
        {/* TEMP DEBUG: remove after fix */}
        <div className="text-xs opacity-70 break-words">
          <div>variantsLen: {product.variants?.length ?? 0}</div>
          <div>optionsLen: {product.options?.length ?? 0}</div>
          <div>optionsStateKeys: {Object.keys(options).join(",") || "(none)"}</div>
          <div>
            optionsStateVals: {Object.values(options).join(",") || "(none)"}
          </div>
          <div>selectedVariantId: {selectedVariant?.id ?? "(undefined)"}</div>
          <div>
            selectedVariantOpts:{" "}
            {selectedVariant?.options
              ?.map((o: any) => `${o.option_id}:${o.value}`)
              .join(" | ") ?? "(none)"}
          </div>
          <div>isValidVariant: {String(isValidVariant)}</div>
          <div>needsSelection: {String(needsSelection)}</div>
          <div>isSellable: {String(isSellable)}</div>
          <div>
            manage_inventory: {String((selectedVariant as any)?.manage_inventory)}
          </div>
          <div>
            allow_backorder: {String((selectedVariant as any)?.allow_backorder)}
          </div>
          <div>isPreorder: {String(isPreorder)}</div>
          <div>isInStock: {String(isInStock)}</div>
          <div>isSoldOut: {String(isSoldOut)}</div>
        </div>
        <MobileActions
          product={product}
          variant={selectedVariant}
          options={options}
          updateOptions={setOptionValue}
          inStock={isInStock}
          handleAddToCart={handleAddToCart}
          isAdding={isAdding}
          show={!inView}
          optionsDisabled={!!disabled || isAdding}
        />
      </div>
    </>
  )
}
