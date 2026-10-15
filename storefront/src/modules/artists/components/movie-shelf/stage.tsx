"use client"

import type { Movie } from "@lib/artists"
import { motion } from "motion/react"
import { useCallback, useEffect, useRef } from "react"

import { useStageFlight } from "@modules/artists/components/stage-flight"

/**
 * A movie lifted out of the rail into the middle of the screen.
 *
 * The same flight the sounds make, sharing `useStageFlight` rather than a
 * second copy of it, and that is the only thing the two stages share. A sound
 * arrives with a ring visualiser and a scrubber because one audio element
 * serves the whole page; a movie arrives as itself, with the browser's own
 * controls, because a movie carries its own sound and nothing else on the page
 * should be driving it.
 *
 * The element is MOVED here rather than cloned: a second <video> would start
 * the download again from zero and leave two copies of a several-hundred-
 * megabyte file in flight. `playsInline` so iOS expands into this panel rather
 * than throwing the video into its own fullscreen player, which would take the
 * visitor out of the page the stage exists to keep them in.
 */
export default function MovieStage({
  movie,
  home,
  onClose,
}: {
  movie: Movie
  home: () => HTMLElement | null
  onClose: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const { panel, close, style, shade } = useStageFlight({ home, onClosed: onClose })

  /**
   * Play on arrival, because the click that opened this WAS the request to
   * watch it. Failure is ignored on purpose: a browser that refuses autoplay
   * leaves the controls sitting there, which is a working panel rather than an
   * error worth interrupting somebody with.
   */
  useEffect(() => {
    video.current?.play().catch(() => {})
  }, [])

  const stop = useCallback(() => {
    video.current?.pause()
    void close()
  }, [close])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Watching ${movie.title}`}
      className="fixed inset-0 z-[100]"
    >
      <motion.div
        style={{ opacity: shade }}
        className="absolute inset-0 bg-black/80 backdrop-blur-xl"
        onClick={stop}
      />

      <div className="pointer-events-none absolute inset-0 flex flex-col">
        <div className="flex flex-1 items-center justify-center p-6">
          <motion.div
            ref={panel}
            style={style}
            className="pointer-events-auto relative max-h-full w-[min(92vw,calc(80vh*9/16),520px)] overflow-hidden rounded-large bg-black shadow-[0_30px_120px_rgba(0,0,0,0.6)]"
          >
            <video
              ref={video}
              src={movie.url}
              poster={movie.poster}
              controls
              playsInline
              preload="metadata"
              style={{ aspectRatio: movie.aspectRatio ?? "9 / 16" }}
              className="h-full w-full object-contain"
            />
          </motion.div>
        </div>

        <motion.div style={{ opacity: shade }} className="pointer-events-auto px-6 pb-10 pt-2">
          <p className="luxury-title text-center text-[0.86rem] tracking-[0.045em] text-white">
            {movie.title}
          </p>
        </motion.div>
      </div>

      <motion.button
        type="button"
        style={{ opacity: shade }}
        onClick={stop}
        aria-label="Close movie"
        className="absolute right-5 top-5 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 text-white/80 transition hover:border-white hover:text-white"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </motion.button>
    </div>
  )
}
