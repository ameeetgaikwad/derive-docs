'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

interface LazyStepVideoProps {
  src: string
  label: string
  topOffsetPct: number
  playbackRate?: number
  className?: string
}

export function LazyStepVideo({
  src,
  label,
  topOffsetPct,
  playbackRate = 1.5,
  className,
}: LazyStepVideoProps) {
  const ref = useRef<HTMLVideoElement>(null)
  const hasFinishedRef = useRef(false)

  useEffect(() => {
    const video = ref.current
    if (!video) return

    video.load()
    video.playbackRate = playbackRate
    hasFinishedRef.current = false

    const handleLoadedMetadata = () => {
      video.playbackRate = playbackRate
    }

    const playVideo = () => {
      if (hasFinishedRef.current || video.ended) {
        return
      }

      video.playbackRate = playbackRate
      const promise = video.play()
      if (promise) promise.catch(() => {})
    }

    const handleEnded = () => {
      hasFinishedRef.current = true
    }

    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('ended', handleEnded)

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return

        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          playVideo()
          return
        }

        video.pause()
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    )

    observer.observe(video)
    return () => {
      observer.disconnect()
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('ended', handleEnded)
    }
  }, [playbackRate, src])

  return (
    <video
      ref={ref}
      src={src}
      aria-label={label}
      muted
      playsInline
      preload="auto"
      className={cn(
        'mx-auto block h-auto w-full max-w-[522px] align-bottom lg:mr-0 lg:ml-auto lg:[transform:translate(4%,_var(--video-y))]',
        className,
      )}
      style={{
        ['--video-y' as string]: `-${topOffsetPct}%`,
        clipPath: 'inset(0 0 3px 0)',
      }}
    />
  )
}
