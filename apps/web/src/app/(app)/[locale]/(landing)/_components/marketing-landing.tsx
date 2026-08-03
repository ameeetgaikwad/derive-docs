"use client"

import { useState } from 'react'
import { Faq } from './faq'
import { Hero } from './hero'
import { MarketingFooter } from './marketing-footer'
import { Stats } from './stats'
import { TrustStrip } from './trust-strip'
import { CoveredCallPositions } from '@/components/earn/CoveredCallPositions'
import { cn } from '@/lib/utils'

export function MarketingLanding() {
  const t = (value: string) => value
  const [reviewMode, setReviewMode] = useState(false)

  return (
    <div
      data-landing
      className="min-h-screen overflow-x-clip bg-zinc-900 text-zinc-950"
    >
      <div className="bg-white">
        <div
          className={cn(
            'mx-auto flex w-full max-w-[1512px] flex-col px-5 sm:px-8 lg:px-[clamp(2rem,13.93vw_-_110.66px,6.25rem)]',
            reviewMode
              ? 'pt-4 pb-8 lg:pt-6 lg:pb-10'
              : 'pt-8 pb-20 lg:pt-[75px] lg:pb-[120px]',
          )}
        >
          <Hero
            t={t}
            reviewMode={reviewMode}
            onReviewModeChange={setReviewMode}
          />
          {!reviewMode && (
            <>
              <TrustStrip t={t} />
              <Stats t={t} />
              <Faq t={t} />
            </>
          )}
        </div>
        <CoveredCallPositions />
      </div>
      <MarketingFooter t={t} />
    </div>
  )
}
