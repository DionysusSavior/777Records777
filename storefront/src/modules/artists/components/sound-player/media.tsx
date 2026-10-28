"use client"

import Image from "next/image"

import type { PlayableTrack } from "./context"

const isVideo = (url: string) => /\.(mp4|mov|webm|ogg)$/i.test(url.split("?")[0] ?? "")

/** The same picture the panel shows: its muted reel, its artwork, or the note. */
export default function TrackMedia({ track }: { track: PlayableTrack }) {
  const base = "absolute inset-0 h-full w-full object-cover object-center"

  if (!track.mediaUrl) {
    return (
      <div className="absolute inset-0 bg-black" aria-label="No artwork" />
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
