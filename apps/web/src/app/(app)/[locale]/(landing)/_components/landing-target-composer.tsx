'use client'

import TargetComposer from '@/components/shared/target-composer'
import { cn } from '@/lib/utils'

export function LandingTargetComposer({
  reviewMode,
  onReviewModeChange,
}: {
  reviewMode?: boolean
  onReviewModeChange?: (reviewMode: boolean) => void
}) {
  return (
    <div
      id="composer"
      className={cn(
        'relative z-10 min-w-0 scroll-mt-32',
        reviewMode && 'w-full',
      )}
    >
      <TargetComposer onReviewModeChange={onReviewModeChange} />
    </div>
  )
}
