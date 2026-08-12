'use client'

import { useEffect } from 'react'
import TargetComposer from '@/components/shared/target-composer'
import { useNetwork } from '@/hooks/protocol/useNetwork'
import { cn } from '@/lib/utils'

export function LandingTargetComposer({
  reviewMode,
  onReviewModeChange,
}: {
  reviewMode?: boolean
  onReviewModeChange?: (reviewMode: boolean) => void
}) {
  const { chainId } = useNetwork()

  useEffect(() => {
    onReviewModeChange?.(false)
  }, [chainId, onReviewModeChange])

  return (
    <div
      id="composer"
      className={cn(
        'relative z-10 min-w-0 scroll-mt-32',
        reviewMode && 'w-full',
      )}
    >
      <TargetComposer key={chainId} onReviewModeChange={onReviewModeChange} />
    </div>
  )
}
