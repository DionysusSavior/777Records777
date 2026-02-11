"use client"

import { addToCart } from "@lib/data/cart"
import { useIntersection } from "@lib/hooks/use-in-view"
import { HttpTypes } from "@medusajs/types"
import { Button, clx } from "@medusajs/ui"
import Divider from "@modules/common/components/divider"
import OptionSelect from "@modules/products/components/product-actions/option-select"
import { isEqual } from "lodash"
import { useParams, usePathname, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import ProductPrice from "../product-price"
import MobileActions from "./mobile-actions"
import { useRouter } from "next/navigation"
import { getSoundDownload } from "@lib/sounds"

const PREORDER_SIZES = [
  "Drone Operator (S)",
  "Close Combat (M)",
  "Mass Effects  (L)",
  "Breakthrough Element (XL)",
  "War-Level  (XXL)",
] as const

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
  const [preorderSize, setPreorderSize] = useState<string | undefined>(
    undefined
  )
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

  const hasSizeOption = useMemo(() => {
    return (product.options || []).some((option) => {
      return (option.title || "").trim().toLowerCase() === "size"
    })
  }, [product.options])

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

  const isPreorder = Boolean(product?.metadata?.preorder)

  const requiresPreorderSize = isPreorder && !hasSizeOption
  const needsPreorderSize = requiresPreorderSize && !preorderSize

  const canBuy = !!selectedVariant && !needsSelection && !needsPreorderSize

  const soundDownload = getSoundDownload(product)
  const isDownloadOnly = Boolean(soundDownload)

  const shouldPulsePreorder = isPreorder && canBuy && !isAdding

  const actionLabel = needsSelection
    ? "Select variant"
    : needsPreorderSize
    ? "Select size"
    : isPreorder
    ? "Preorder"
    : "Add to cart"

  const actionDisabled =
    needsSelection || needsPreorderSize || isAdding || !selectedVariant

  const actionsRef = useRef<HTMLDivElement>(null)

  const inView = useIntersection(actionsRef, "0px")

  // add the selected variant to the cart
  const handleAddToCart = async () => {
    if (!selectedVariant?.id) return null
    if (needsPreorderSize) return null

    setIsAdding(true)

    await addToCart({
      variantId: selectedVariant.id,
      quantity: 1,
      countryCode,
      metadata:
        requiresPreorderSize && preorderSize
          ? {
              preorder_size: preorderSize,
            }
          : undefined,
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

        {!isDownloadOnly && (
          <ProductPrice product={product} variant={selectedVariant} />
        )}

        {requiresPreorderSize && (
          <div className="flex flex-col gap-y-3">
            <span className="text-sm">Select size</span>
            <div className="flex flex-wrap gap-2">
              {PREORDER_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setPreorderSize(size)}
                  disabled={!!disabled || isAdding}
                  className={clx(
                    "border-ui-border-base bg-ui-bg-subtle border text-small-regular h-10 rounded-rounded px-4 flex-1 min-w-[96px]",
                    {
                      "border-ui-border-interactive": size === preorderSize,
                      "hover:shadow-elevation-card-rest transition-shadow ease-in-out duration-150":
                        size !== preorderSize,
                    }
                  )}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        )}

        {!isDownloadOnly && (
          <Button
            onClick={handleAddToCart}
            disabled={actionDisabled}
            variant="primary"
            className={clx("w-full h-10", {
              "pulse-glow": shouldPulsePreorder,
            })}
            isLoading={isAdding}
            data-testid="add-product-button"
          >
            {actionLabel}
          </Button>
        )}
        {soundDownload && (
          <>
            <Button asChild variant="primary" className="w-full h-10">
              <a
                href={soundDownload.url}
                download
                target="_blank"
                rel="noreferrer"
              >
                {soundDownload.label}
              </a>
            </Button>
            {soundDownload.om7PlayerUrl ? (
              <Button asChild variant="secondary" className="w-full h-10">
                <a
                  href={soundDownload.om7PlayerUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download OM7Player
                </a>
              </Button>
            ) : (
              <Button variant="secondary" className="w-full h-10" disabled>
                Download OM7Player
              </Button>
            )}
          </>
        )}
        {/*
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
          <div>canBuy: {String(canBuy)}</div>
          <div>isPreorder: {String(isPreorder)}</div>
        </div>
        */}
        {!isDownloadOnly && (
          <MobileActions
            product={product}
            variant={selectedVariant}
            options={options}
            updateOptions={setOptionValue}
            canBuy={canBuy}
            isPreorder={isPreorder}
            showPreorderSize={requiresPreorderSize}
            preorderSize={preorderSize}
            setPreorderSize={setPreorderSize}
            preorderSizes={PREORDER_SIZES}
            pulsePreorder={shouldPulsePreorder}
            handleAddToCart={handleAddToCart}
            isAdding={isAdding}
            show={!inView}
            optionsDisabled={!!disabled || isAdding}
          />
        )}
      </div>
    </>
  )
}
