"use client"

import { useEffect, useRef } from "react"

interface ConfettiBurstProps {
  // Fired once the burst has finished animating (or immediately when the user
  // prefers reduced motion) so the caller can unmount it.
  onComplete?: () => void
}

// A small, dependency-free confetti burst drawn on a full-screen canvas. Used
// to celebrate a freshly finished video analysis before we navigate to the
// report. It's purely decorative, so it's pointer-events-none and aria-hidden.
const COLORS = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#f43f5e"]
const PARTICLE_COUNT = 150
const GRAVITY = 0.16
const DRAG = 0.99
const LIFETIME_MS = 2400
// Hold full opacity for the first stretch, then fade over the remainder so the
// burst tapers off instead of vanishing abruptly.
const FADE_AFTER_MS = 1200

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  rotation: number
  spin: number
  color: string
}

export function ConfettiBurst({ onComplete }: ConfettiBurstProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // Keep the latest callback without re-running the animation effect.
  const onCompleteRef = useRef(onComplete)
  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      onCompleteRef.current?.()
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    let width = window.innerWidth
    let height = window.innerHeight

    const resize = () => {
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener("resize", resize)

    // Launch from just above centre, firing in every direction with an upward
    // bias so the pieces arc up and rain back down.
    const originX = width / 2
    const originY = height * 0.42
    const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, () => {
      const angle = Math.random() * Math.PI * 2
      const speed = 5 + Math.random() * 9
      return {
        x: originX,
        y: originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 4,
        size: 6 + Math.random() * 6,
        rotation: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.3,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      }
    })

    const start = performance.now()
    let raf = 0
    let finished = false

    const tick = (now: number) => {
      const elapsed = now - start
      ctx.clearRect(0, 0, width, height)

      const fade =
        elapsed < FADE_AFTER_MS
          ? 1
          : Math.max(0, 1 - (elapsed - FADE_AFTER_MS) / (LIFETIME_MS - FADE_AFTER_MS))

      for (const p of particles) {
        p.vx *= DRAG
        p.vy = p.vy * DRAG + GRAVITY
        p.x += p.vx
        p.y += p.vy
        p.rotation += p.spin

        ctx.save()
        ctx.globalAlpha = fade
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rotation)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
        ctx.restore()
      }

      if (elapsed < LIFETIME_MS) {
        raf = requestAnimationFrame(tick)
      } else {
        ctx.clearRect(0, 0, width, height)
        finished = true
        onCompleteRef.current?.()
      }
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
      // If we're torn down mid-flight (e.g. the page navigates away), still let
      // the caller know so it doesn't wait forever on us.
      if (!finished) onCompleteRef.current?.()
    }
  }, [])

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" aria-hidden="true">
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  )
}
