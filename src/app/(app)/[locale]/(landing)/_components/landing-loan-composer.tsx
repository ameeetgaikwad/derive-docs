'use client'

import LoanComposer from '@/components/shared/loan-composer'
import { cn } from '@/lib/utils'

export function LandingLoanComposer({
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
      <LoanComposer onReviewModeChange={onReviewModeChange} />
    </div>
  )
}
