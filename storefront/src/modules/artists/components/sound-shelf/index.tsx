import { listProductsWithSort } from "@lib/data/products"
import { getRegion } from "@lib/data/regions"
import {
  getSoundDownload,
  getArtworkRotationClassName,
  getManifestStreamUrl,
} from "@lib/sounds"
import {
  getCreditedReleasesFor,
  getSiteManagerShelf,
  type SiteManagerManifestItem,
  type SiteManagerManifestRelease,
} from "@lib/site-manager-manifest"
import { openHrefFor } from "@lib/open-in-om7"
import OpenInOm7 from "@modules/artists/components/open-in-om7"
import ScrollRail from "@modules/common/components/scroll-rail"
import Thumbnail from "@modules/products/components/thumbnail"
import {
  PlayableArtwork,
  PlayButton,
  type PlayableTrack,
} from "@modules/artists/components/sound-player/context"

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
  manifestUrl,
  artistHandle,
}: {
  countryCode: string
  productIds: string[]
  manifestUrl?: string
  /** Whose list these releases belong to. The open link names them by it. */
  artistHandle: string
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
  const productsPromise = (async () => {
    if (productIds.length === 0) return []
    try {
      const region = await getRegion(countryCode)
      if (!region) return []

      const result = await listProductsWithSort({
        page: 1,
        queryParams: { limit: 12, id: productIds },
        sortBy: "created_at",
        countryCode,
      })
      return result.response.products
    } catch (error) {
      console.error(
        "shelf: products unavailable, rendering the artist-owned releases only.",
        error instanceof Error ? error.message : error
      )
      return []
    }
  })()

  // These fail independently. A commerce outage cannot hide the artist's
  // direct publishes, and a missing first-publish manifest cannot hide the
  // existing catalogue.
  const [shelf, credited, products] = await Promise.all([
    getSiteManagerShelf(manifestUrl),
    getCreditedReleasesFor(artistHandle),
    productsPromise,
  ])

  if (shelf.length === 0 && credited.length === 0 && products.length === 0) {
    return <p className="text-ui-fg-subtle txt-medium">Coming soon.</p>
  }

  const ownReleaseIds = new Set(
    shelf.flatMap((entry) => (entry.kind === "release" ? [entry.release.id] : []))
  )

  return (
    <ScrollRail>
      {shelf.map((entry) =>
        entry.kind === "release" ? (
          <ManifestRelease
            key={`site-manager-release-${entry.release.id}`}
            release={entry.release}
            items={entry.items}
            openHref={openHrefFor(manifestUrl, entry.release.id, artistHandle)}
          />
        ) : (
          <ManifestSound key={`site-manager-${entry.item.id}`} item={entry.item} />
        )
      )}
      {credited
        .filter((entry) => !ownReleaseIds.has(entry.release.id))
        .map((entry) => (
          <ManifestRelease
            key={`credited-release-${entry.release.id}`}
            release={entry.release}
            items={entry.items}
            openHref={openHrefFor(
              entry.ownerManifestUrl,
              entry.release.id,
              entry.ownerHandle
            )}
          />
        ))}

      {products.map((product) => {
        const download = getSoundDownload(product)

        // Stills win when a release has them; the video is the fallback, which
        // for these is all there is. Same preference the product grid uses.
        const stills = product.images?.filter((img) => !isVideo(img.url)) ?? []
        const videos = product.images?.filter((img) => isVideo(img.url)) ?? []
        const preferred = stills.length > 0 ? stills : videos
        const track: PlayableTrack | null = download
          ? {
              id: product.id,
              title: product.title,
              audioUrl: download.streamUrl ?? download.url,
              mediaUrl: product.thumbnail ?? preferred[0]?.url,
              mediaClassName: getArtworkRotationClassName(product),
            }
          : null

        return (
          <div key={product.id} data-testid="sound-wrapper">
            <PlayableArtwork id={product.id}>
              <Thumbnail
                thumbnail={product.thumbnail}
                images={preferred}
                size="square"
                isFeatured
                mediaClassName={getArtworkRotationClassName(product)}
              />
            </PlayableArtwork>

            <div className="mt-4 flex items-center justify-between gap-3">
              {track && <PlayButton track={track} />}
              <span className="luxury-title min-w-0 flex-1 truncate text-[0.86rem] tracking-[0.045em] text-white">
                {product.title}
              </span>


            </div>

            {/* A catalogue song's bundle used to be linked from its product
                page only, and this shelf has no link to that page, so the
                bundle existed and nobody could reach it. */}
            <SecondLine><OpenInOm7 href="https://apps.apple.com/us/app/om7player/id6755060481" title={product.title} /></SecondLine>
          </div>
        )
      })}
    </ScrollRail>
  )
}

/**
 * The line under the title row: the ways into OM7Player.
 *
 * A line of its own because they do not fit beside the title. A panel on a
 * phone is 255px wide. The first release to carry a bundle put Download and
 * Release bundle on one row, 379px of it, and the second pill ran out of the
 * panel and across the next one with the title squeezed to nothing. Nobody
 * had seen it, because until 12 November 2026 no release had a bundle.
 *
 * It wraps, so a third pill costs a line and not an overflow. `empty:hidden`
 * because the open link draws nothing until it is switched on, and an empty
 * line would still take its margin.
 */
function SecondLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 empty:hidden">
      {children}
    </div>
  )
}

/**
 * The `.om7`: the song, its reel and the way back here, in one file.
 *
 * Labelled for what it is. A tap goes through the browser's own download, so
 * this is a file to open in OM7Player and not a way into it; the way in is
 * the open link beside it.
 */

function itemById(
  items: SiteManagerManifestItem[],
  id: string | null
): SiteManagerManifestItem | undefined {
  return id ? items.find((item) => item.id === id) : undefined
}

/**
 * One release, exported so the single-release page draws the same thing.
 *
 * Which file is the download, whether a bundle is offered beside it, and
 * whether a priced release shows Buy instead of a free copy of the same file
 * are all decided here. A second implementation of those rules on the release
 * page would drift, and the first time it did the two pages would disagree
 * about the same song - one offering a free download beside the other's Buy
 * button.
 */
export function ManifestRelease({
  release,
  items,
  openHref,
}: {
  release: SiteManagerManifestRelease
  items: SiteManagerManifestItem[]
  /**
   * The link that opens this release in OM7Player, when there is one. The
   * caller decides, because only the caller knows which manifest this came
   * from. See openHrefFor.
   */
  openHref?: string | null
}) {
  const audio = itemById(items, release.audio)
  const reel = itemById(items, release.reel)
  const artwork = itemById(items, release.artwork)
  const bundle = itemById(items, release.bundle)
  // A free download beside a Buy button undercuts the sale it sits next to -
  // the same file, free, one tap away. Priced releases get Buy only.
  const free = release.price == null
  const buyLabel =
    release.price != null && release.buyUrl
      ? `Buy — $${(release.price / 100).toFixed(2)}`
      : null
  const images = artwork
    ? [{ url: artwork.url }]
    : reel
      ? [{ url: reel.url }]
      : []
  const track: PlayableTrack | null = audio
    ? {
        id: release.id,
        title: release.title,
        audioUrl: getManifestStreamUrl(audio.id) ?? audio.url,
        mediaUrl: images[0]?.url,
      }
    : null

  return (
    <div data-testid="site-manager-release-wrapper">
      <PlayableArtwork id={release.id}>
        <Thumbnail
          images={images}
          size="square"
          isFeatured
          placeholder={images.length === 0 ? "audio" : "image"}
        />
      </PlayableArtwork>

      <div className="mt-4 flex items-center justify-between gap-3">
        {track && <PlayButton track={track} />}
        <span className="luxury-title min-w-0 flex-1 truncate text-[0.86rem] tracking-[0.045em] text-white">
          {release.title}
        </span>



        {/* External, never `download` - this leaves the site for the
            artist's own Stripe Payment Link. OM7/777 never sees the money. */}
        {buyLabel && (
          <a
            href={release.buyUrl!}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${buyLabel} — ${release.title}`}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-black transition hover:bg-white/90"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M20.59 13.41 12 22l-9-9V3h10l9 10a2 2 0 0 1 0 2.83Z" />
              <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
            </svg>
            {buyLabel}
          </a>
        )}
      </div>

      {/* Withheld on a priced release for the reason the download is. The
          app fetches whatever the manifest names and does not ask what it
          costs, so this link beside a Buy button would be the free copy. */}
      <SecondLine>
        {free && openHref && <OpenInOm7 href={openHref} title={release.title} />}

      </SecondLine>
    </div>
  )
}

function ManifestSound({ item }: { item: SiteManagerManifestItem }) {
  const track: PlayableTrack | null =
    item.kind === "audio"
      ? {
          id: item.id,
          title: item.title,
          audioUrl: getManifestStreamUrl(item.id) ?? item.url,
        }
      : null

  return (
    <div data-testid="site-manager-sound-wrapper">
      <PlayableArtwork id={item.id}>
        <Thumbnail
          images={item.kind === "video" ? [{ url: item.url }] : []}
          size="square"
          isFeatured
          placeholder={item.kind === "audio" ? "audio" : "image"}
        />
      </PlayableArtwork>

      <div className="mt-4 flex items-center justify-between gap-3">
        {track && <PlayButton track={track} />}
        <span className="luxury-title min-w-0 flex-1 truncate text-[0.86rem] tracking-[0.045em] text-white">
          {item.title}
        </span>

        <OpenInOm7 href="https://apps.apple.com/us/app/om7player/id6755060481" title={item.title} />
      </div>
    </div>
  )
}
