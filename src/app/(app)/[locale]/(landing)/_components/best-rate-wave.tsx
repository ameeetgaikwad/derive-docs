'use client'

import { DotGridWave } from '@/components/dot-grid-wave'
import { Skeleton } from '@/components/ui/skeleton'
import { useAvailableStrikes } from '@/hooks/protocol/useAvailableStrikes'

export function BestRateWave() {
  const buyTargets = useAvailableStrikes(null, 'buy_low')
  const sellTargets = useAvailableStrikes(null, 'sell_high')
  const bestApr = [...buyTargets.strikes, ...sellTargets.strikes].reduce(
    (best, strike) => Math.max(best, strike.apr),
    0,
  )
  const isFetching = buyTargets.isLoading || sellTargets.isLoading
  const label = bestApr > 0 ? `${bestApr.toFixed(0)}%` : null
  const showSkeleton = label == null && isFetching

  return (
    <div className="flex h-[47px] w-[min(56vw,896px)] max-w-none items-center gap-5 overflow-visible max-lg:w-full">
      <div className="flex h-full min-w-[9.25rem] shrink-0 flex-col justify-center gap-1 border-l border-green-500 pl-5 font-mono text-green-500">
        <span className="flex h-5 min-w-[5.25rem] items-center text-xl leading-none tracking-[-0.03em] tabular-nums">
          {showSkeleton ? (
            <Skeleton aria-busy className="h-5 w-[5.25rem]" />
          ) : (
            (label ?? '-%')
          )}
        </span>
        <span className="flex h-5 items-center text-base leading-none tracking-[-0.03em] whitespace-nowrap">
          Top premium APR
        </span>
      </div>
      <div className="h-full min-w-[180px] flex-1 overflow-hidden">
        <DotGridWave
          dotSize={2}
          spacing={10}
          waveColor="#22c55e"
          baseColor="#e4e4e4"
          backgroundColor="#ffffff"
          direction="left-to-right"
          waveSpeed={5}
          waveWidth={20}
          className="h-full w-full"
        />
      </div>
    </div>
  )
}
