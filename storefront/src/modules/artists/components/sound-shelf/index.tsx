import Image from "next/image"

import { listProductsWithSort } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import { getSoundDownload, getArtworkRotationClassName } from "@lib/sounds"

/**
 * The releases, with the file itself one click away.
 *
 * There used to be a product page between a visitor and the download. That
 * page existed to sell a decision nobody has to make here: the tracks are
 * free, so a step that only asks "are you sure" is a step that loses people.
 *
 * The download sits on the right, apart from the artwork and with its own
 * space, because it is the one irreversible-feeling thing in the row and it
 * should never be the thing a thumb lands on by accident.
 */
export default async function SoundShelf({
  countryCode,
  productIds,
}: {
  countryCode: string
  productIds: string[]
}) {
  const region = await getRegion(countryCode)
  if (!region || productIds.length === 0) {
    return <p className="text-ui-fg-subtle txt-medium">Coming soon.</p>
  }

  const {
    response: { products },
  } = await listProductsWithSort({
    page: 1,
    queryParams: { limit: 12, id: productIds },
    sortBy: "created_at",
    countryCode,
  })

  if (products.length === 0) {
    return <p className="text-ui-fg-subtle txt-medium">Coming soon.</p>
  }

  return (
    <ul className="flex flex-col gap-4">
      {products.map((product) => {
        const download = getSoundDownload(product)
        const art = product.thumbnail ?? product.images?.[0]?.url ?? null

        return (
          <li
            key={product.id}
            className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 small:flex-row small:items-center small:gap-6 small:p-5"
          >
            <div className="relative aspect-square w-full shrink-0 overflow-hidden rounded-xl bg-black/60 small:w-28">
              {art && (
                <Image
                  src={art}
                  alt={product.title}
                  fill
                  sizes="(min-width: 1024px) 112px, 100vw"
                  className={`object-cover ${getArtworkRotationClassName(product)}`}
                />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <h3 className="luxury-title truncate text-[1.05rem] tracking-[0.045em] text-white">{product.title}</h3>
              <p className="mt-1 text-xs uppercase tracking-[0.2em] text-white/40">Free download</p>
            </div>

            {download && (
              <a
                href={download.url}
                download
                // Far from the artwork and full width only once it has a row to
                // itself, so a mistap on a phone hits nothing.
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-[12px] font-bold uppercase tracking-[0.16em] text-black transition hover:bg-white/90 small:ml-6"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 3v12" />
                  <path d="m7 10 5 5 5-5" />
                  <path d="M5 21h14" />
                </svg>
                Download
              </a>
            )}
          </li>
        )
      })}
    </ul>
  )
}
