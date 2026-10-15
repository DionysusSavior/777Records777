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
 * Frequency bars bursting outward from a ring around the panel, bass at the
 * bottom and highs at the top, mirrored left to right.
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

    const fit = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 2)
      element.width = window.innerWidth * scale
      element.height = window.innerHeight * scale
      context.setTransform(scale, 0, 0, scale, 0, 0)
    }

    const draw = () => {
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
        const ring = box.width * 0.74
        const reach = box.width * 0.3

        let bass = 0
        if (bins) {
          for (let i = 1; i < 7; i++) bass += bins[i]
          bass /= 6 * 255
        }

        const glow = context.createRadialGradient(cx, cy, box.width * 0.3, cx, cy, ring + reach)
        glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.12 + bass * 0.4})`)
        glow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`)
        context.fillStyle = glow
        context.beginPath()
        context.arc(cx, cy, (ring + reach) * (1 + bass * 0.12), 0, Math.PI * 2)
        context.fill()

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
          levels[i] = level > levels[i] ? level : levels[i] * 0.9 + level * 0.1

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
          }
        }

        if (pulse.current) pulse.current.style.transform = `scale(${1 + bass * 0.045})`
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
    }
  }, [accent, analyser, panel, pulse, still])

  return <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden />
}
