"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import MiniPlayer from "./mini-player"
import Stage from "./stage"

export type PlayableTrack = {
  id: string
  title: string
  /** What Play streams - the AAC copy when one exists, never required to be the download. */
  audioUrl: string
  /** The panel's reel or artwork, replayed on the stage and in the mini player. */
  mediaUrl?: string
  mediaClassName?: string
  downloadUrl?: string
}

type SoundPlayer = {
  track: PlayableTrack | null
  playing: boolean
  staged: boolean
  accent: string
  audio: React.RefObject<HTMLAudioElement>
  analyser: React.MutableRefObject<AnalyserNode | null>
  /** Where the next stage opening flies in from, when it is not the panel itself. */
  origin: React.MutableRefObject<HTMLElement | null>
  play: (track: PlayableTrack) => void
  toggle: () => void
  seek: (seconds: number) => void
  stop: () => void
  showStage: (from?: HTMLElement | null) => void
  hideStage: () => void
  register: (id: string, element: HTMLElement | null) => void
  panelOf: (id: string) => HTMLElement | null
}

const SoundPlayerContext = createContext<SoundPlayer | null>(null)

export const useSoundPlayer = () => {
  const player = useContext(SoundPlayerContext)
  if (!player) throw new Error("useSoundPlayer must be used inside SoundPlayerProvider")
  return player
}

/**
 * One audio element for the whole page, so starting a sound stops the last.
 *
 * The Web Audio graph is built inside the first Play tap and not before:
 * iOS only lets an AudioContext make sound when it is created or resumed from
 * a user gesture. The element is crossOrigin="anonymous" because an analyser
 * fed by a non-CORS response reads silence - the bucket's CORS rule for this
 * origin is what lets the visualizer see the music at all.
 */
export function SoundPlayerProvider({
  accent,
  artistName,
  children,
}: {
  accent: string
  artistName: string
  children: React.ReactNode
}) {
  const audio = useRef<HTMLAudioElement>(null)
  const analyser = useRef<AnalyserNode | null>(null)
  const graph = useRef<AudioContext | null>(null)
  const origin = useRef<HTMLElement | null>(null)
  const panels = useRef(new Map<string, HTMLElement>())
  const [track, setTrack] = useState<PlayableTrack | null>(null)
  const [playing, setPlaying] = useState(false)
  const [staged, setStaged] = useState(false)

  const connect = useCallback(() => {
    const element = audio.current
    if (graph.current || !element) return
    const Context =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Context) return

    // Web Audio on iOS otherwise follows the ringer switch, so a phone on
    // silent would play the reel and no music.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
    if (session) session.type = "playback"

    try {
      const context = new Context()
      const node = context.createAnalyser()
      node.fftSize = 512
      node.smoothingTimeConstant = 0.78
      context.createMediaElementSource(element).connect(node)
      node.connect(context.destination)
      graph.current = context
      analyser.current = node
    } catch {
      // The music still plays through the element; only the ring goes flat.
    }
  }, [])

  const play = useCallback(
    (next: PlayableTrack) => {
      const element = audio.current
      if (!element) return
      connect()
      void graph.current?.resume()
      if (element.dataset.trackId !== next.id) {
        element.src = next.audioUrl
        element.dataset.trackId = next.id
      }
      origin.current = null
      setTrack(next)
      setStaged(true)
      element.play().catch(() => setPlaying(false))
    },
    [connect]
  )

  const toggle = useCallback(() => {
    const element = audio.current
    if (!element?.src) return
    if (element.paused) {
      void graph.current?.resume()
      element.play().catch(() => setPlaying(false))
    } else {
      element.pause()
    }
  }, [])

  const seek = useCallback((seconds: number) => {
    if (audio.current) audio.current.currentTime = seconds
  }, [])

  const stop = useCallback(() => {
    const element = audio.current
    if (element) {
      element.pause()
      element.removeAttribute("src")
      delete element.dataset.trackId
      element.load()
    }
    setStaged(false)
    setTrack(null)
  }, [])

  const showStage = useCallback((from?: HTMLElement | null) => {
    origin.current = from ?? null
    setStaged(true)
  }, [])

  const hideStage = useCallback(() => setStaged(false), [])

  const register = useCallback((id: string, element: HTMLElement | null) => {
    if (element) panels.current.set(id, element)
    else panels.current.delete(id)
  }, [])

  const panelOf = useCallback((id: string) => panels.current.get(id) ?? null, [])

  // One soundtrack at a time: a movie started on this page pauses the song,
  // and a song started pauses the movie. Media `play` does not bubble, so this
  // listens in the capture phase. Muted reels are scenery, not sound.
  useEffect(() => {
    const onPlay = (event: Event) => {
      const started = event.target
      const own = audio.current
      if (!(started instanceof HTMLMediaElement) || started.muted || !own) return
      if (started === own) {
        document.querySelectorAll("video").forEach((video) => {
          if (!video.muted && !video.paused) video.pause()
        })
      } else if (!own.paused) {
        own.pause()
      }
    }
    document.addEventListener("play", onPlay, true)
    return () => document.removeEventListener("play", onPlay, true)
  }, [])

  // Lock-screen and headphone controls name the song rather than the tab.
  useEffect(() => {
    if (!track || !("mediaSession" in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: artistName })
    navigator.mediaSession.setActionHandler("play", () => toggle())
    navigator.mediaSession.setActionHandler("pause", () => toggle())
  }, [track, artistName, toggle])

  const value = useMemo<SoundPlayer>(
    () => ({
      track,
      playing,
      staged,
      accent,
      audio,
      analyser,
      origin,
      play,
      toggle,
      seek,
      stop,
      showStage,
      hideStage,
      register,
      panelOf,
    }),
    [track, playing, staged, accent, play, toggle, seek, stop, showStage, hideStage, register, panelOf]
  )

  return (
    <SoundPlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audio}
        crossOrigin="anonymous"
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        className="hidden"
      />
      <Stage />
      <MiniPlayer />
    </SoundPlayerContext.Provider>
  )
}

export function useAudioTime() {
  const { audio, track } = useSoundPlayer()
  const [time, setTime] = useState({ current: 0, duration: 0 })

  useEffect(() => {
    const element = audio.current
    if (!element) return
    const sync = () =>
      setTime({
        current: element.currentTime,
        duration: Number.isFinite(element.duration) ? element.duration : 0,
      })
    const events = ["timeupdate", "durationchange", "loadedmetadata", "seeked", "emptied"]
    sync()
    events.forEach((event) => element.addEventListener(event, sync))
    return () => events.forEach((event) => element.removeEventListener(event, sync))
  }, [audio, track])

  return time
}

/**
 * The panel's artwork in the rail. It goes invisible while the stage holds
 * it, so the one flying to the centre reads as this panel leaving its slot.
 */
export function PlayableArtwork({ id, children }: { id: string; children: React.ReactNode }) {
  const { track, staged, register } = useSoundPlayer()
  const lifted = staged && track?.id === id
  return (
    <div ref={(element) => register(id, element)} className={lifted ? "opacity-0" : undefined}>
      {children}
    </div>
  )
}

export function PlayIcon({ playing, size = 13 }: { playing: boolean; size?: number }) {
  return playing ? (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 4.5v15a1 1 0 0 0 1.53.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5Z" />
    </svg>
  )
}

export function PlayButton({ track }: { track: PlayableTrack }) {
  const player = useSoundPlayer()
  const current = player.track?.id === track.id
  const active = current && player.playing

  const onClick = () => {
    if (!current) return player.play(track)
    if (active) return player.toggle()
    player.toggle()
    player.showStage()
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={active ? `Pause ${track.title}` : `Play ${track.title}`}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition ${
        active
          ? "border-white bg-white text-black"
          : "border-white/30 text-white hover:border-white hover:bg-white hover:text-black"
      }`}
    >
      <PlayIcon playing={active} />
    </button>
  )
}
