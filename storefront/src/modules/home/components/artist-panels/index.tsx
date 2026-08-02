"use client"

import { useRef } from "react"
import Image from "next/image"
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react"

import LocalizedClientLink from "@modules/common/components/localized-client-link"
import type { Artist } from "@lib/artists"

/**
 * The home page: one wide panel per artist, stacked.
 *
 * The panels are deliberately letterbox rather than portrait. A tall card is a
 * product tile — you read it as one of many, and your eye keeps going. A wide
 * one fills the screen and has to be dealt with, which is the right feeling
 * when there are only two people on the roster.
 *
 * The name sits at the top, over the photo rather than beside it, so the
 * lettering is the first thing read and the picture is what it is printed on.
 *
 * Motion here is scroll-linked, not looping: the photo drifts against the
 * panel as it passes, which gives the page depth without anything moving while
 * you are trying to look at it.
 */
function Panel({ artist, index }: { artist: Artist; index: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  })

  // The image is rendered taller than the frame, so it can slide inside the
  // crop without ever exposing an edge.
  const drift = useTransform(scrollYProgress, [0, 1], ["-8%", "8%"])

  return (
    <motion.div
      ref={ref}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 48 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <LocalizedClientLink
        href={`/artists/${artist.handle}`}
        className="group block"
        data-testid={`artist-panel-${artist.handle}`}
      >
        {/* The photos are stored at 16:9, so the desktop panel matches them
            exactly and the narrower phone ratios only trim the sides — where
            both compositions have room to lose. */}
        <article className="relative isolate aspect-[4/3] w-full overflow-hidden bg-black xsmall:aspect-[3/2] small:aspect-[16/9]">
          <motion.div
            style={reduceMotion ? undefined : { y: drift }}
            className="absolute inset-x-0 -top-[8%] h-[116%]"
          >
            <Image
              src={artist.photo}
              alt={artist.name}
              fill
              priority={index === 0}
              sizes="100vw"
              style={{ objectPosition: artist.focus }}
              className="object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.04]"
            />
          </motion.div>

          {/* Weighted at both ends and almost clear through the middle. Both
              photos are already near-black, so a flat scrim would bury the
              subject; this only darkens where type actually sits. */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.72)_0%,rgba(0,0,0,0.05)_42%,rgba(0,0,0,0.6)_100%)]" />

          <header className="absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-6 small:p-12">
            <div>
              <span className="block text-[10px] uppercase tracking-[0.42em] text-white/45 small:text-xs">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h2 className="mt-2 text-[13vw] font-black uppercase leading-[0.85] tracking-[-0.035em] text-white small:mt-3 small:text-[6.5vw]">
                {artist.name}
              </h2>
              <p className="mt-3 text-[11px] uppercase tracking-[0.28em] text-white/55 small:text-sm">
                {artist.tagline}
              </p>
            </div>
          </header>

          <footer className="absolute inset-x-0 bottom-0 flex items-end justify-end p-6 small:p-12">
            <span className="flex items-center gap-3 rounded-full border border-white/25 px-5 py-2 text-[11px] uppercase tracking-[0.26em] text-white/85 backdrop-blur-sm transition-colors duration-300 group-hover:border-white group-hover:bg-white group-hover:text-black small:text-xs">
              Enter
              <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">
                &rarr;
              </span>
            </span>
          </footer>
        </article>
      </LocalizedClientLink>
    </motion.div>
  )
}

export default function ArtistPanels({ artists }: { artists: Artist[] }) {
  return (
    <section className="flex flex-col gap-px bg-white/10">
      {artists.map((artist, i) => (
        <Panel key={artist.handle} artist={artist} index={i} />
      ))}
    </section>
  )
}
