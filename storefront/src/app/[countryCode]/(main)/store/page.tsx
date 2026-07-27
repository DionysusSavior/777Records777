import { Metadata } from "next"

import { SortOptions } from "@modules/store/components/refinement-list/sort-products"
import StoreTemplate from "@modules/store/templates"
import { UNIFORM_PRODUCT_IDS } from "@lib/uniforms"

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

  return (
    <StoreTemplate
      sortBy={sortBy}
      page={page}
      countryCode={params.countryCode}
      productsIds={UNIFORM_PRODUCT_IDS}
      pageTitle="Uniforms"
      productPreviewTextClassName="txt-compact-small-plus"
      productPreviewPriceClassName="text-ui-fg-subtle"
    />
  )
}
