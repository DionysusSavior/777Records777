"use client"

import { useRef } from "react"
import Image from "next/image"
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react"

import LocalizedClientLink from "@modules/common/components/localized-client-link"
import type { Artist } from "@lib/artists"

/**
 * The home page: the roster, floating over the page.
 *
 * Side by side where there is width for it, and a rolodex you push sideways
 * with a thumb where there is not. Either way it is one decision rather than
 * something you scroll past, which is what a two-name roster should be. Two
 * panels across 375px would be thumbnails, and nobody chooses between
 * thumbnails, so the phone gets one at a time with the next one peeking in.
 *
 * They are not numbered. A list of two does not need counting, and 01 and 02
 * imply a ranking nobody asked for.
 *
 * The floating is three effects that only work together. A drop shadow does
 * nothing on a near-black page, so height is suggested by the light each panel
 * casts on the page beneath it, in a colour taken from its own photograph. On
 * top of that they drift, slowly and out of phase with each other, which is
 * what stops the pair reading as two rectangles that happen to have glow
 * behind them. And they lift under the cursor, so the height turns out to have
 * been real.
 *
 * All of it is off under prefers-reduced-motion, where a panel that will not
 * hold still is not an effect, it is an obstacle.
 */
function Panel({ artist, index }: { artist: Artist; index: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  })

  // The image is rendered taller than its frame so it can slide inside the
  // crop without ever exposing an edge.
  const drift = useTransform(scrollYProgress, [0, 1], ["-7%", "7%"])

  // Out of phase, and not by a round number: two panels bobbing in step read
  // as one object, and a tidy 2s offset finds its way back into step.
  const bob = { duration: 7.5 + index * 1.3, delay: index * 0.9 }

  return (
    <motion.div
      ref={ref}
      // Nearly the full window on a phone so one panel reads as one card, and
      // the next one peeks in to say the rail keeps going.
      className="relative w-[84vw] shrink-0 snap-center small:w-auto small:shrink"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 56 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1], delay: index * 0.12 }}
    >
      {/* The light on the page under the panel. Sits low and wide, the way a
          shadow would, and is the only reason the panel reads as raised. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-6 rounded-[44px] opacity-70 blur-3xl transition-opacity duration-700 group-hover/panel:opacity-100"
        style={{
          background: `radial-gradient(58% 52% at 50% 72%, ${artist.glow}, transparent 72%)`,
        }}
      />

      <motion.div
        animate={reduceMotion ? undefined : { y: [0, -9, 0] }}
        transition={
          reduceMotion ? undefined : { ...bob, repeat: Infinity, ease: "easeInOut" }
        }
      >
        <LocalizedClientLink
          href={`/artists/${artist.handle}`}
          className="group/panel block"
          data-testid={`artist-panel-${artist.handle}`}
        >
          <article
            className="
              relative isolate aspect-[4/3] w-full overflow-hidden rounded-[28px]
              bg-black ring-1 ring-white/10
              shadow-[0_36px_70px_-24px_rgba(0,0,0,0.95)]
              transition-transform duration-500 ease-out
              group-hover/panel:-translate-y-2
              xsmall:aspect-[3/2] small:aspect-[4/3]
            "
          >
            <motion.div
              style={reduceMotion ? undefined : { y: drift }}
              className="absolute inset-x-0 -top-[7%] h-[114%]"
            >
              <Image
                src={artist.photo}
                alt={artist.name}
                fill
                priority={index === 0}
                // Two across above 1024px, one across below it.
                sizes="(min-width: 1024px) 50vw, 100vw"
                style={{ objectPosition: artist.focus }}
                className="object-cover transition-transform duration-[1200ms] ease-out group-hover/panel:scale-[1.05]"
              />
            </motion.div>

            {/* Weighted at both ends and almost clear through the middle. Both
                photos are already near-black, so a flat scrim would bury the
                subject; this only darkens where type actually sits. */}
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.72)_0%,rgba(0,0,0,0.05)_42%,rgba(0,0,0,0.6)_100%)]" />

            <header className="absolute inset-x-0 top-0 p-5 small:p-8">
              <h2 className="text-[11vw] font-black uppercase leading-[0.85] tracking-[-0.035em] text-white xsmall:text-[8vw] small:text-[3.4vw]">
                {artist.name}
              </h2>
              <p className="mt-2 text-[10px] uppercase tracking-[0.26em] text-white/55 small:text-xs">
                {artist.tagline}
              </p>
            </header>

            <footer className="absolute inset-x-0 bottom-0 flex justify-end p-5 small:p-8">
              <span className="flex items-center gap-3 rounded-full border border-white/25 px-5 py-2 text-[11px] uppercase tracking-[0.26em] text-white/85 backdrop-blur-sm transition-colors duration-300 group-hover/panel:border-white group-hover/panel:bg-white group-hover/panel:text-black">
                Enter
                <span
                  aria-hidden
                  className="transition-transform duration-300 group-hover/panel:translate-x-1"
                >
                  &rarr;
                </span>
              </span>
            </footer>
          </article>
        </LocalizedClientLink>
      </motion.div>
    </motion.div>
  )
}

export default function ArtistPanels({ artists }: { artists: Artist[] }) {
  return (
    /**
     * A rail on a phone, a pair on a desktop.
     *
     * Stacked, the roster was something you scrolled past on the way to the
     * footer, and the second artist only existed if you kept going. Side by
     * side it is a choice, which is what a two-name roster should be — so on a
     * phone it becomes a rolodex you push through with a thumb instead.
     *
     * The vertical padding stays generous in both: the glow under each panel
     * is what makes it look raised, and a panel clipped at the window edge
     * cannot look like it is above anything.
     */
    <section className="mx-auto flex max-w-[1600px] snap-x snap-mandatory gap-6 overflow-x-auto px-6 py-14 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden small:grid small:grid-cols-2 small:gap-12 small:overflow-visible small:px-12 small:py-20">
      {artists.map((artist, i) => (
        <Panel key={artist.handle} artist={artist} index={i} />
      ))}
    </section>
  )
}
