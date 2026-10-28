"use client"

import type { Movie } from "@lib/artists"
import { useCallback, useRef, useState } from "react"

import ScrollRail from "@modules/common/components/scroll-rail"
import MovieStage from "./stage"

// Decimal units, because that is what Finder and the iPhone Files app report.
const formatSize = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`

/**
 * The full videos, with the file one click away.
 *
 * Tapping one lifts it into the middle of the screen the way a sound panel
 * does, sharing that flight through `useStageFlight`. In the rail itself a
 * movie is a poster and nothing more: no `controls`, no `src`, and
 * `preload="none"`, so a page visit pulls none of the video. A rail of five
 * movies that each began loading on sight would cost hundreds of megabytes
 * before anybody asked for one.
 *
 * The size stays on the download button because it is large enough to matter
 * on a phone plan, and the visitor should know before the download starts.
 */
export default function MovieShelf({ movies }: { movies: Movie[] }) {
  const [open, setOpen] = useState<Movie | null>(null)
  const slots = useRef(new Map<string, HTMLElement | null>())

  /**
   * Read on demand rather than captured, because the rail can be scrolled
   * while the stage is open and a captured rect would fly the panel home to
   * where its slot used to be.
   */
  const home = useCallback(() => (open ? slots.current.get(open.url) ?? null : null), [open])

  return (
    <>
      <ScrollRail>
        {movies.map((movie) => (
          <div key={movie.url} data-testid="movie-wrapper">
            <button
              type="button"
              ref={(element) => {
                slots.current.set(movie.url, element)
              }}
              onClick={() => setOpen(movie)}
              aria-label={`Watch ${movie.title}`}
              className="group relative block w-full overflow-hidden rounded-large bg-black"
              style={{ aspectRatio: movie.aspectRatio ?? "9 / 16" }}
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

            <div className="mt-4 flex flex-col items-start gap-3">
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
        ))}
      </ScrollRail>

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
