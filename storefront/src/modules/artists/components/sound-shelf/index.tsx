import { listProductsWithSort } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import { getSoundDownload, getArtworkRotationClassName } from "@lib/sounds"
import ScrollRail from "@modules/common/components/scroll-rail"
import Thumbnail from "@modules/products/components/thumbnail"

/**
 * The releases, as playing panels, with the file one click away.
 *
 * The artwork on these is not artwork: every sound's only media is a lyric
 * video, and Thumbnail plays it muted on a loop. That is what makes the row
 * feel alive, and it is the whole reason to use Thumbnail here rather than an
 * Image. Reaching for next/image directly is what broke it — the optimizer was
 * handed a .mov, could not make a picture of it, and every panel went blank.
 *
 * There is no link to a product page. The tracks are free, so a page that only
 * asks "are you sure" is a step that loses people; the download does the work
 * from here.
 */
const isVideo = (url?: string | null) =>
  !!url && /\.(mp4|mov|webm|ogg)$/i.test((url.split("?")[0] as string) || "")

export default async function SoundShelf({
  countryCode,
  productIds,
}: {
  countryCode: string
  productIds: string[]
}) {
  /**
   * A shelf that cannot reach the backend says "Coming soon", it does not
   * take the page down with it.
   *
   * Both calls below throw when the commerce backend is unreachable, and this
   * component renders inside the artist page - so an outage used to 500 a page
   * whose reason for existing is a free download that needs no backend at all.
   * The empty state already existed for the case where an artist has no
   * products; an unreachable backend is the same thing from a visitor's point
   * of view, so it lands in the same place rather than in a new one.
   */
  let products: Awaited<ReturnType<typeof listProductsWithSort>>["response"]["products"] = []
  try {
    const region = await getRegion(countryCode)
    if (!region || productIds.length === 0) {
      return <p className="text-ui-fg-subtle txt-medium">Coming soon.</p>
    }

    const result = await listProductsWithSort({
      page: 1,
      queryParams: { limit: 12, id: productIds },
      sortBy: "created_at",
      countryCode,
    })
    products = result.response.products
  } catch (error) {
    console.error(
      "shelf: products unavailable, rendering the empty state.",
      error instanceof Error ? error.message : error
    )
    return <p className="text-ui-fg-subtle txt-medium">Coming soon.</p>
  }

  if (products.length === 0) {
    return <p className="text-ui-fg-subtle txt-medium">Coming soon.</p>
  }

  return (
    <ScrollRail>
      {products.map((product) => {
        const download = getSoundDownload(product)

        // Stills win when a release has them; the video is the fallback, which
        // for these is all there is. Same preference the product grid uses.
        const stills = product.images?.filter((img) => !isVideo(img.url)) ?? []
        const videos = product.images?.filter((img) => isVideo(img.url)) ?? []
        const preferred = stills.length > 0 ? stills : videos

        return (
          <div key={product.id} data-testid="sound-wrapper">
            <Thumbnail
              thumbnail={product.thumbnail}
              images={preferred}
              size="square"
              isFeatured
              mediaClassName={getArtworkRotationClassName(product)}
            />

            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="luxury-title min-w-0 flex-1 truncate text-[0.86rem] tracking-[0.045em] text-white">
                {product.title}
              </span>

              {download && (
                <a
                  href={download.url}
                  download
                  aria-label={`Download ${product.title}`}
                  // Beside the title rather than over the artwork: the panel is
                  // playing, and a button on top of it competes with the thing
                  // it is meant to be selling.
                  className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-black transition hover:bg-white/90"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 3v12" />
                    <path d="m7 10 5 5 5-5" />
                    <path d="M5 21h14" />
                  </svg>
                  Download
                </a>
              )}
            </div>
          </div>
        )
      })}
    </ScrollRail>
  )
}
