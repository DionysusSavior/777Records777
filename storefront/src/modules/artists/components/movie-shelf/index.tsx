"use client"

import type { Movie } from "@lib/artists"
import { useCallback, useRef, useState } from "react"

import MovieStage from "./stage"

// Decimal units, because that is what Finder and the iPhone Files app report.
const formatSize = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`

/**
 * The tallest a poster may stand, as a share of the window.
 *
 * Not 100: a film that filled the window exactly would give no sign that
 * another one follows it, and the page would read as ending at each poster.
 */
const TALLEST = 82

/**
 * A film's width over its height, for working out how wide it may grow.
 *
 * Portrait, like the older entries, when the ratio cannot be read - which is
 * the same default the poster box itself falls back to.
 */
const widthOverHeight = (aspect: string) => {
  const [width, height] = aspect.split("/").map((part) => Number(part.trim()))
  return Number.isFinite(width) && Number.isFinite(height) && height > 0
    ? width / height
    : 9 / 16
}

/**
 * The full videos, stacked down the page, with the file one click away.
 *
 * These were a horizontal rail, a slot of it 22vw wide on a desktop. A film
 * shown a fifth of the window across is a thumbnail of a film, and the two
 * New Deal cuts are 16:9 - the shape that suffers most from a narrow slot,
 * because its height falls away with its width. Dion asked for them down the
 * page instead, and down the page each one gets the whole column.
 *
 * Each poster keeps its own framing and is bounded by HEIGHT rather than by
 * width, which is what lets one rule serve both shapes. A 16:9 cut is held
 * by the column and fills it. A 9:16 reel would be twice the window tall at
 * that width, so its height cap binds first and it settles to roughly a
 * screen tall, centred, at its own proportions. Neither is letterboxed and
 * neither is cropped.
 *
 * A movie here is still a poster and nothing more: no `controls`, no `src`,
 * and `preload="none"`, so a page visit pulls none of the video. Tapping one
 * lifts it into the middle of the screen the way a sound panel does, sharing
 * that flight through `useStageFlight`.
 *
 * The size stays on the download button because it is large enough to matter
 * on a phone plan, and the visitor should know before the download starts.
 */
export default function MovieShelf({ movies }: { movies: Movie[] }) {
  const [open, setOpen] = useState<Movie | null>(null)
  const slots = useRef(new Map<string, HTMLElement | null>())

  /**
   * Read on demand rather than captured, because the page can be scrolled
   * while the stage is open and a captured rect would fly the panel home to
   * where its slot used to be.
   */
  const home = useCallback(() => (open ? slots.current.get(open.url) ?? null : null), [open])

  return (
    <>
      <div className="flex flex-col gap-16">
        {movies.map((movie) => {
          const aspect = movie.aspectRatio ?? "9 / 16"
          return (
          <div key={movie.url} data-testid="movie-wrapper">
            <button
              type="button"
              ref={(element) => {
                slots.current.set(movie.url, element)
              }}
              onClick={() => setOpen(movie)}
              aria-label={`Watch ${movie.title}`}
              className="group relative mx-auto block w-full overflow-hidden rounded-large bg-black"
              style={{
                aspectRatio: aspect,
                maxWidth: `calc(${TALLEST}vh * ${widthOverHeight(aspect)})`,
              }}
            >
              {movie.poster ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={movie.poster}
                  alt=""
                  className="h-full w-full object-contain transition duration-500 group-hover:scale-[1.03]"
                />
              ) : (
                <span className="absolute inset-0 bg-black" />
              )}

              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/55 backdrop-blur transition group-hover:bg-black/70">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5 text-white" aria-hidden>
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </span>
              </span>
            </button>

            <div
              className="mx-auto mt-5 flex w-full flex-col items-start gap-3"
              style={{ maxWidth: `calc(${TALLEST}vh * ${widthOverHeight(aspect)})` }}
            >
              <span className="luxury-title text-[0.86rem] leading-relaxed tracking-[0.045em] text-white">
                {movie.title}
              </span>

              <a
                href={movie.url}
                download
                aria-label={`Download ${movie.title} (${formatSize(movie.bytes)})`}
                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-black transition hover:bg-white/90"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 3v12" />
                  <path d="m7 10 5 5 5-5" />
                  <path d="M5 21h14" />
                </svg>
                Download
                <span className="font-normal opacity-60">{formatSize(movie.bytes)}</span>
              </a>
            </div>
          </div>
          )
        })}
      </div>

      {open && (
        <MovieStage
          key={open.url}
          movie={open}
          home={home}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  )
}
