import { Metadata } from "next"

import { SortOptions } from "@modules/store/components/refinement-list/sort-products"
import StoreTemplate from "@modules/store/templates"

export const metadata: Metadata = {
  title: "Uniforms",
  description: "Explore all of our uniforms.",
}

type Params = {
  searchParams: Promise<{
    sortBy?: SortOptions
    page?: string
  }>
  params: Promise<{
    countryCode: string
  }>
}

export default async function StorePage(props: Params) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const { sortBy, page } = searchParams

  const uniformsProductIds = [
    "prod_01KECR7W439TW1VQBTP0QGY4EF", // White BAMN tee
    "prod_01KFCQJC3979EP6BPWJ089TE4Z", // Black BAMN tee
  ]

  // Default store page currently shows everything; adjust productsIds to filter if needed.
  return (
    <StoreTemplate
      sortBy={sortBy}
      page={page}
      countryCode={params.countryCode}
      productsIds={uniformsProductIds}
      pageTitle="Uniforms"
      productPreviewTextClassName="txt-compact-small-plus"
      productPreviewPriceClassName="text-ui-fg-subtle"
    />
  )
}
