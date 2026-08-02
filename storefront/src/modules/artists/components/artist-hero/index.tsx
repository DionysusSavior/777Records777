import Image from "next/image"

import LocalizedClientLink from "@modules/common/components/localized-client-link"
import type { Artist } from "@lib/artists"

/**
 * The banner at the top of an artist's page.
 *
 * Shorter than the home panel on purpose: on the home page the photo is the
 * decision you are being asked to make, here it is confirmation that you made
 * it, and the shelves below are the point. Same crop, same lettering position,
 * so the click feels like the panel opened rather than like a page swap.
 */
export default function ArtistHero({ artist }: { artist: Artist }) {
  return (
    <section className="relative isolate aspect-[3/2] w-full overflow-hidden bg-black xsmall:aspect-[16/9] small:aspect-[2/1]">
      <Image
        src={artist.photo}
        alt={artist.name}
        fill
        priority
        sizes="100vw"
        style={{ objectPosition: artist.focus }}
        className="object-cover"
      />
      {/* Fades into the page colour rather than to black, so the banner ends
          where the first shelf begins instead of stopping on a seam. */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.75)_0%,rgba(0,0,0,0.08)_45%,var(--bg-page)_100%)]" />

      <div className="absolute inset-x-0 top-0 p-6 small:p-12">
        <LocalizedClientLink
          href="/"
          className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-white/50 transition-colors hover:text-white small:text-xs"
        >
          <span aria-hidden>&larr;</span> Roster
        </LocalizedClientLink>
        <h1 className="mt-3 text-[12vw] font-black uppercase leading-[0.85] tracking-[-0.035em] text-white small:mt-4 small:text-[6vw]">
          {artist.name}
        </h1>
      </div>
    </section>
  )
}
