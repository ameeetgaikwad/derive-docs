'use client'

import { useEffect, useRef } from 'react'

type DotGridWaveDirection =
  | 'left-to-right'
  | 'right-to-left'
  | 'top-to-bottom'
  | 'bottom-to-top'

type DotGridWaveProps = {
  dotSize: number
  spacing: number
  waveColor: string
  baseColor: string
  backgroundColor: string
  direction: DotGridWaveDirection
  waveSpeed: number
  waveWidth: number
  className?: string
}

function parseHexColor(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}

export function DotGridWave({
  dotSize,
  spacing,
  waveColor,
  baseColor,
  backgroundColor,
  direction,
  waveSpeed,
  waveWidth,
  className,
}: DotGridWaveProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number>(0)
  const progressRef = useRef<number>(0)

  const totalSpacing = dotSize + spacing

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    const [baseRed, baseGreen, baseBlue] = parseHexColor(baseColor)
    const [waveRed, waveGreen, waveBlue] = parseHexColor(waveColor)

    const resizeCanvas = () => {
      const container = canvas.parentElement
      if (!container) return

      const dpr = window.devicePixelRatio || 1
      canvas.width = container.clientWidth * dpr
      canvas.height = container.clientHeight * dpr
      canvas.style.width = `${container.clientWidth}px`
      canvas.style.height = `${container.clientHeight}px`
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    const drawFrame = () => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      const cols = Math.ceil(width / totalSpacing) + 1
      const rows = Math.ceil(height / totalSpacing) + 1
      const isHorizontal =
        direction === 'left-to-right' || direction === 'right-to-left'
      const maxIndex = isHorizontal ? cols : rows
      const totalProgress = maxIndex + waveWidth

      context.fillStyle = backgroundColor
      context.fillRect(0, 0, width, height)

      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const x = col * totalSpacing + totalSpacing / 2
          const y = row * totalSpacing + totalSpacing / 2

          let index: number
          switch (direction) {
            case 'right-to-left':
              index = cols - 1 - col
              break
            case 'top-to-bottom':
              index = row
              break
            case 'bottom-to-top':
              index = rows - 1 - row
              break
            case 'left-to-right':
            default:
              index = col
              break
          }

          const distance = index - progressRef.current
          const intensity =
            distance >= -waveWidth && distance <= 0
              ? Math.sin(((distance + waveWidth) / waveWidth) * Math.PI)
              : 0

          const red = Math.round(baseRed + (waveRed - baseRed) * intensity)
          const green = Math.round(
            baseGreen + (waveGreen - baseGreen) * intensity,
          )
          const blue = Math.round(baseBlue + (waveBlue - baseBlue) * intensity)

          context.beginPath()
          context.arc(x, y, dotSize / 2, 0, Math.PI * 2)
          context.fillStyle = `rgb(${red}, ${green}, ${blue})`
          context.fill()
        }
      }

      progressRef.current += waveSpeed * 0.1
      if (progressRef.current > totalProgress) {
        progressRef.current = -waveWidth
      }
    }

    const tick = () => {
      drawFrame()
      animationRef.current = window.requestAnimationFrame(tick)
    }

    drawFrame()

    // Every frame redraws the full dot grid, so only animate while visible.
    const observer = new IntersectionObserver(([entry]) => {
      window.cancelAnimationFrame(animationRef.current)
      if (entry?.isIntersecting) {
        animationRef.current = window.requestAnimationFrame(tick)
      }
    })
    observer.observe(canvas)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', resizeCanvas)
      window.cancelAnimationFrame(animationRef.current)
    }
  }, [
    baseColor,
    backgroundColor,
    direction,
    dotSize,
    spacing,
    totalSpacing,
    waveColor,
    waveSpeed,
    waveWidth,
  ])

  return <canvas ref={canvasRef} aria-hidden className={className} />
}
