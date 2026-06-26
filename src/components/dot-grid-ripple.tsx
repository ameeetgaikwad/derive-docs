'use client'

import { useEffect, useRef } from 'react'

interface DotGridRippleProps {
  dotSize: number
  spacing: number
  waveColor: string
  baseColor: string
  centerColor: string
  waveSpeed: number
  waveWidth: number
  centerRadius: number
  className?: string
}

export function DotGridRipple({
  dotSize,
  spacing,
  waveColor,
  baseColor,
  centerColor,
  waveSpeed,
  waveWidth,
  centerRadius,
  className,
}: DotGridRippleProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number>(0)
  const progressRef = useRef<number>(0)

  const totalSpacing = dotSize + spacing

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resizeCanvas = () => {
      const container = canvas.parentElement
      if (container) {
        canvas.width = container.clientWidth
        canvas.height = container.clientHeight
      }
    }

    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    const animate = () => {
      if (!canvas || !ctx) return

      const cols = Math.ceil(canvas.width / totalSpacing) + 1
      const rows = Math.ceil(canvas.height / totalSpacing) + 1

      const centerX = canvas.width / 2
      const centerY = canvas.height / 2
      const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY)

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const baseR = parseInt(baseColor.slice(1, 3), 16)
      const baseG = parseInt(baseColor.slice(3, 5), 16)
      const baseB = parseInt(baseColor.slice(5, 7), 16)

      const waveR = parseInt(waveColor.slice(1, 3), 16)
      const waveG = parseInt(waveColor.slice(3, 5), 16)
      const waveB = parseInt(waveColor.slice(5, 7), 16)

      const centerR = parseInt(centerColor.slice(1, 3), 16)
      const centerG = parseInt(centerColor.slice(3, 5), 16)
      const centerB = parseInt(centerColor.slice(5, 7), 16)

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const x = col * totalSpacing + totalSpacing / 2
          const y = row * totalSpacing + totalSpacing / 2

          const dx = x - centerX
          const dy = y - centerY
          const distanceFromCenter = Math.sqrt(dx * dx + dy * dy)

          let r: number
          let g: number
          let b: number

          if (distanceFromCenter <= centerRadius) {
            r = centerR
            g = centerG
            b = centerB
          } else {
            const waveFront = progressRef.current
            const waveWidthPixels = waveWidth * totalSpacing
            const distanceFromWave =
              distanceFromCenter - centerRadius - waveFront

            let intensity = 0
            if (distanceFromWave >= -waveWidthPixels && distanceFromWave <= 0) {
              const normalizedDistance =
                (distanceFromWave + waveWidthPixels) / waveWidthPixels
              intensity = Math.sin(normalizedDistance * Math.PI * 0.5)
            }

            r = Math.round(baseR + (waveR - baseR) * intensity)
            g = Math.round(baseG + (waveG - baseG) * intensity)
            b = Math.round(baseB + (waveB - baseB) * intensity)
          }

          ctx.beginPath()
          ctx.arc(x, y, dotSize / 2, 0, Math.PI * 2)
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
          ctx.fill()
        }
      }

      progressRef.current += waveSpeed * 2
      if (progressRef.current > maxDistance) {
        progressRef.current = 0
      }

      animationRef.current = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      window.removeEventListener('resize', resizeCanvas)
      cancelAnimationFrame(animationRef.current)
    }
  }, [
    dotSize,
    spacing,
    totalSpacing,
    waveColor,
    baseColor,
    centerColor,
    waveSpeed,
    waveWidth,
    centerRadius,
  ])

  return <canvas ref={canvasRef} className={className} />
}
