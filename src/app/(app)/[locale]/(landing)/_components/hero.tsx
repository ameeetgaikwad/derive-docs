"use client"

import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'

import { BestRateWave } from './best-rate-wave'
import { LandingLoanComposer } from './landing-loan-composer'

const ASSET_BASE = '/images/marketing/landing'

export function Hero({
  t,
  reviewMode,
  onReviewModeChange,
}: {
  t: (value: string) => string
  reviewMode: boolean
  onReviewModeChange: (reviewMode: boolean) => void
}) {
  return (
    <section
      className={cn(
        'grid grid-cols-1 gap-12',
        reviewMode
          ? 'min-h-[calc(100vh-6rem)] items-start lg:grid-cols-1 lg:gap-8'
          : 'items-center lg:min-h-[554px] lg:grid-cols-[minmax(0,606px)_minmax(0,1fr)] lg:gap-[50px]',
      )}
    >
      {!reviewMode && (
        <div className="relative z-0 flex h-full flex-col items-start justify-between gap-10 lg:pt-[50px] lg:pb-[33px]">
          <div className="flex flex-col items-start gap-[40px]">
            <div className="flex flex-col gap-[25px]">
              <BitcoinLoanHeadline
                as="h1"
                t={t}
                className="max-w-[606px] text-zinc-950"
              />
              <Text
                variant="subheading-1"
                className="max-w-[503px] text-black/50"
              >
                {t(
                  'Set the BTC price you already want, see the reward upfront, and review both outcomes before you sign. Built for people who want to buy lower or sell higher without trading screens.',
                )}
              </Text>
            </div>
            <Button
              asChild
              variant="secondary"
              className="rounded-[5px] border-zinc-200 bg-transparent px-5 py-[15px] tracking-[0.05em] text-zinc-800 uppercase"
            >
              <Link href="#learn-more">{t('Learn More')}</Link>
            </Button>
          </div>
          <BestRateWave />
        </div>
      )}
      <LandingLoanComposer
        reviewMode={reviewMode}
        onReviewModeChange={onReviewModeChange}
      />
    </section>
  )
}

function BitcoinLoanHeadline({
  as,
  t,
  className,
}: {
  as: 'h1' | 'h2'
  t: (value: string) => string
  className?: string
}) {
  return (
    <Text
      as={as}
      variant="h1"
      className={className}
      style={{
        fontSize: 'clamp(42px, calc(40.6154px + 0.3846vw), 48px)',
      }}
    >
      {t('Buy')}{' '}
      <Image
        src={`${ASSET_BASE}/btc-icon.svg`}
        alt=""
        width={50}
        height={50}
        className="mx-2 hidden size-[50px] -translate-y-[3px] align-middle sm:inline-block"
      />
      <em className="text-orange-500 italic">{t('BTC')}</em>{' '}
      {t('cheaper. Sell it higher. Get paid to wait.')}
    </Text>
  )
}
