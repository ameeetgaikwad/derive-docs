'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { useAvailableStrikes } from '@/hooks/protocol/useAvailableStrikes'
import NumberFlow from '@number-flow/react'
import type { Format } from '@number-flow/react'

type AnimatedStatValueProps = {
  value: number
  format?: Format
  source?: 'best-reward'
}

const baseValueClassName =
  'font-mono text-[44px] font-medium leading-[1] tracking-[-0.03em] text-green-500 sm:text-[48px] md:text-[56px] lg:text-[60px] xl:text-[70px]'

export function AnimatedStatValue({
  value,
  format,
  source,
}: AnimatedStatValueProps) {
  const buyTargets = useAvailableStrikes(null, 'buy_low')
  const sellTargets = useAvailableStrikes(null, 'sell_high')
  const isFetching = buyTargets.isLoading || sellTargets.isLoading
  const bestReward = [...buyTargets.strikes, ...sellTargets.strikes].reduce(
    (best, strike) => Math.max(best, strike.apr),
    0,
  )
  const displayValue =
    source === 'best-reward' && bestReward > 0
      ? bestReward
      : value
  const valueClassName =
    source === 'best-reward'
      ? `${baseValueClassName} inline-block w-[4ch]`
      : baseValueClassName

  if (source === 'best-reward' && isFetching && bestReward <= 0) {
    return (
      <Skeleton aria-busy className={valueClassName}>
        <span aria-hidden className="invisible">0.00</span>
      </Skeleton>
    )
  }

  return (
    <NumberFlow
      value={displayValue}
      format={format}
      className={valueClassName}
    />
  )
}
