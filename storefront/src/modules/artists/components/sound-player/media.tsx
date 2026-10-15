"use client"

import Image from "next/image"

import type { PlayableTrack } from "./context"

const isVideo = (url: string) => /\.(mp4|mov|webm|ogg)$/i.test(url.split("?")[0] ?? "")

/** The same picture the panel shows: its muted reel, its artwork, or the note. */
export default function TrackMedia({ track }: { track: PlayableTrack }) {
  const base = "absolute inset-0 h-full w-full object-cover object-center"

  if (!track.mediaUrl) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-white/[0.08] via-transparent to-white/[0.03] text-white/70">
        <svg width="42%" height="42%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9 18V5l10-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="16" cy="16" r="3" />
        </svg>
      </div>
    )
  }

  if (isVideo(track.mediaUrl)) {
    return (
      <video
        src={track.mediaUrl}
        className={`${base} ${track.mediaClassName ?? ""}`}
        muted
        loop
        playsInline
        autoPlay
        preload="metadata"
        aria-hidden
      />
    )
  }

  return (
    <Image
      src={track.mediaUrl}
      alt=""
      fill
      unoptimized
      sizes="420px"
      className={`${base} ${track.mediaClassName ?? ""}`}
    />
  )
}
