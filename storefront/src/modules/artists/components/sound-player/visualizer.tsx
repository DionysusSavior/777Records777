"use client"

import { useEffect, useRef } from "react"

import { useSoundPlayer } from "./context"

const BARS_PER_SIDE = 64
const LOW_BIN = 2
const HIGH_BIN = 150

const rgbOf = (color: string): [number, number, number] => {
  const match = color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [255, 255, 255]
}

/**
 * A luminous, audio-driven corona: mirrored frequency bars, orbiting ribbons
 * and a dust halo. Motion follows actual energy, not a fake idle beat.
 *
 * The ring is re-centred on the panel's live box every frame, so during the
 * flight in from the rail it travels and grows with the panel rather than
 * waiting in the middle for it. Bins are spread logarithmically because
 * linear spacing gives half the ring to treble nobody hears move. Bars rise
 * instantly and fall slowly, which is what makes it read as a beat rather
 * than as noise.
 */
export default function RingVisualizer({
  panel,
  pulse,
  still,
}: {
  panel: React.RefObject<HTMLElement>
  pulse: React.RefObject<HTMLElement>
  still: boolean
}) {
  const { analyser, accent } = useSoundPlayer()
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext("2d")
    if (!element || !context) return

    const [r, g, b] = rgbOf(accent)
    const levels = new Float32Array(BARS_PER_SIDE)
    let bins: Uint8Array<ArrayBuffer> | null = null
    let frame = 0
    let previous = 0
    let phase = 0
    let envelope = 0
    const pulseElement = pulse.current
    const tint = (alpha: number) => `rgba(${r}, ${g}, ${b}, ${alpha})`

    const fit = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 2)
      element.width = window.innerWidth * scale
      element.height = window.innerHeight * scale
      context.setTransform(scale, 0, 0, scale, 0, 0)
    }

    const draw = (now = 0) => {
      const dt = Math.min(Math.max((now - previous) / 1000, 0), 0.05)
      previous = now
      const node = analyser.current
      if (node && !still) {
        if (bins?.length !== node.frequencyBinCount) bins = new Uint8Array(node.frequencyBinCount)
        node.getByteFrequencyData(bins)
      }

      context.clearRect(0, 0, window.innerWidth, window.innerHeight)
      const box = panel.current?.getBoundingClientRect()
      if (box && box.width > 0) {
        const cx = box.left + box.width / 2
        const cy = box.top + box.height / 2
        // Keep the brightest geometry inside a phone viewport. The soft halo
        // may spill, but the spectrum should not be chopped off at both sides.
        const ring = Math.min(box.width * 0.74, window.innerWidth * 0.38)
        const reach = Math.min(box.width * 0.3, window.innerWidth * 0.1)

        let bass = 0
        if (bins) {
          for (let i = 1; i < 7; i++) bass += bins[i]
          bass /= 6 * 255
        }
        envelope += (bass - envelope) * (1 - Math.exp(-dt * (bass > envelope ? 18 : 5)))
        if (!still) phase += dt * envelope * 0.55

        const glow = context.createRadialGradient(cx, cy, ring * 0.4, cx, cy, ring + reach * 2)
        glow.addColorStop(0, tint(0.03))
        glow.addColorStop(0.55, tint(0.08 + envelope * 0.2))
        glow.addColorStop(1, tint(0))
        context.fillStyle = glow
        context.beginPath()
        context.arc(cx, cy, ring + reach * 2, 0, Math.PI * 2)
        context.fill()

        context.save()
        context.globalCompositeOperation = "lighter"
        // Thin counter-rotating ribbons give the spectrum depth without
        // expensive full-screen blurs or an ever-growing particle system.
        for (let ribbon = 0; ribbon < 3; ribbon++) {
          context.beginPath()
          for (let point = 0; point <= 192; point++) {
            const angle = (point / 192) * Math.PI * 2
            const wave = Math.sin(angle * (3 + ribbon) + phase * (ribbon % 2 ? -2 : 2) + ribbon * 2)
            const radius = ring - 8 - ribbon * 5 + wave * (2 + envelope * 12)
            const px = cx + Math.cos(angle) * radius
            const py = cy + Math.sin(angle) * radius
            if (point === 0) context.moveTo(px, py)
            else context.lineTo(px, py)
          }
          context.closePath()
          context.strokeStyle = ribbon === 0 ? `rgba(235,245,255,${0.2 + envelope * 0.35})` : tint(0.16 + envelope * 0.25)
          context.lineWidth = ribbon === 0 ? 1.5 : 0.8
          context.stroke()
        }

        for (let mote = 0; mote < 48; mote++) {
          const angle = mote * 2.399963 + phase * (mote % 2 ? 1 : -0.6)
          const radius = ring + reach * (0.25 + ((mote * 17) % 47) / 47)
          context.fillStyle = tint(0.12 + envelope * (0.2 + (mote % 4) * 0.1))
          context.beginPath()
          context.arc(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, 0.6 + (mote % 3) * 0.4, 0, Math.PI * 2)
          context.fill()
        }

        context.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.22)`
        context.lineWidth = 1
        context.beginPath()
        context.arc(cx, cy, ring - 6, 0, Math.PI * 2)
        context.stroke()

        const step = Math.PI / BARS_PER_SIDE
        context.lineCap = "round"
        context.lineWidth = Math.max(1.5, ((Math.PI * ring) / BARS_PER_SIDE) * 0.42)

        for (let i = 0; i < BARS_PER_SIDE; i++) {
          let level = 0
          if (bins) {
            const span = HIGH_BIN / LOW_BIN
            const lo = Math.floor(LOW_BIN * Math.pow(span, i / BARS_PER_SIDE))
            const hi = Math.max(lo + 1, Math.floor(LOW_BIN * Math.pow(span, (i + 1) / BARS_PER_SIDE)))
            let sum = 0
            for (let k = lo; k < hi; k++) sum += bins[k] ?? 0
            level = Math.pow(sum / ((hi - lo) * 255), 1.5)
          }
          levels[i] = level > levels[i] ? level : levels[i] + (level - levels[i]) * (1 - Math.exp(-dt * 6))

          const length = 4 + levels[i] * reach
          // Brighter toward white as a bar rises, so peaks read as light.
          const lift = levels[i] * 0.6
          context.strokeStyle = `rgba(${Math.round(r + (255 - r) * lift)}, ${Math.round(
            g + (255 - g) * lift
          )}, ${Math.round(b + (255 - b) * lift)}, ${0.35 + levels[i] * 0.65})`

          for (const side of [1, -1]) {
            const angle = Math.PI / 2 + side * (i + 0.5) * step
            const cos = Math.cos(angle)
            const sin = Math.sin(angle)
            context.beginPath()
            context.moveTo(cx + cos * ring, cy + sin * ring)
            context.lineTo(cx + cos * (ring + length), cy + sin * (ring + length))
            context.stroke()
            // A broad translucent sheath and a hot tip read as neon, while
            // avoiding per-bar shadowBlur on mobile GPUs.
            const width = context.lineWidth
            context.globalAlpha = 0.13
            context.lineWidth = width * 3
            context.stroke()
            context.globalAlpha = 1
            context.lineWidth = width
            if (levels[i] > 0.25) {
              context.fillStyle = `rgba(245,250,255,${levels[i] * 0.85})`
              context.beginPath()
              context.arc(cx + cos * (ring + length), cy + sin * (ring + length), width * 0.5, 0, Math.PI * 2)
              context.fill()
            }
          }
        }

        context.restore()
        if (pulse.current) pulse.current.style.transform = `scale(${1 + envelope * 0.055})`
      }

      if (!still) frame = requestAnimationFrame(draw)
    }

    const refit = () => {
      fit()
      if (still) draw()
    }

    fit()
    draw()
    window.addEventListener("resize", refit)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", refit)
      if (pulseElement) pulseElement.style.transform = ""
    }
  }, [accent, analyser, panel, pulse, still])

  return <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden />
}
