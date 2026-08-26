import Image from "next/image"

import { OM7_PLAYER_URL } from "@lib/sounds"

/**
 * The App Store set, same six and same order as the listing.
 *
 * The alt text is the caption printed on each shot rather than a separate
 * description of it. Somebody using a screen reader should get what somebody
 * looking at it gets, and what they get is the caption - inventing different
 * words here would give the two audiences two different pitches.
 */
const SHOTS = [
  { src: "/om7player/01-appstore-6.9.png", alt: "The files are already yours" },
  { src: "/om7player/02-appstore-6.9.png", alt: "Your tools, and other artists" },
  { src: "/om7player/03-appstore-6.9.png", alt: "Your pace, your dates" },
  { src: "/om7player/04-appstore-6.9.png", alt: "Loop the part that bothers you" },
  { src: "/om7player/05-appstore-6.9.png", alt: "Make your own card" },
  { src: "/om7player/06-appstore-6.9.png", alt: "Find artists, not algorithms" },
]

/**
 * The app, last on the page.
 *
 * It goes at the end because it is the only thing here that asks someone to
 * leave. Everything above — the downloads, the shirt, the booking — happens on
 * this page, and putting a link off-site above them would spend attention that
 * had somewhere better to go.
 *
 * The screenshots scroll rather than wrap into a grid. Six phone screens laid
 * flat is a wall; a rail reads as a set you flick through, which is how the
 * App Store shows them and therefore how they were composed.
 */
export default function Om7PlayerSection() {
  return (
    <div>
      <div className="-mx-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-4 [scrollbar-width:none] small:mx-0 small:px-0 [&::-webkit-scrollbar]:hidden">
        {SHOTS.map((shot) => (
          <div
            key={shot.src}
            className="relative aspect-[1320/2868] w-[62vw] shrink-0 snap-start overflow-hidden rounded-2xl border border-white/10 bg-black small:w-[236px]"
          >
            {/* unoptimized: these are stored at exactly the width they are
                shown at, so there is nothing for the optimizer to do. Asking
                it to produce a 3840px version of a screenshot is what made
                every one of these panels fail to load. */}
            <Image
              src={shot.src}
              alt={shot.alt}
              fill
              sizes="(min-width: 1024px) 236px, 62vw"
              unoptimized
              className="object-cover"
            />
          </div>
        ))}
      </div>

      <a
        href={OM7_PLAYER_URL}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-6 inline-flex rounded-full border border-white/25 px-7 py-3 text-[12px] font-bold uppercase tracking-[0.16em] text-white transition hover:border-white hover:bg-white hover:text-black"
      >
        Download OM7Player
      </a>
    </div>
  )
}
