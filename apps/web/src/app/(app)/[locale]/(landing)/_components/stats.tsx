import { Fragment } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

const steps = [
  {
    number: '01',
    numberClassName: 'text-orange-500',
    title: 'Browse expiry and strike.',
    description:
      'Compare weekly covered-call targets by distance above spot, indicative premium, and projected APR.',
  },
  {
    number: '02',
    numberClassName: 'text-blue-500',
    title: 'Set your BTCB amount.',
    description:
      'Enter only the BTCB slice you want to cover, then simulate BTC prices at expiry and review the cash-settlement outcome.',
  },
  {
    number: '03',
    numberClassName: 'text-green-500',
    title: 'Get and accept a live quote.',
    description:
      'Open the RFQ auction, inspect the winning gross premium, protocol fee estimate, expected net cash change, and countdown, then sign from your wallet.',
  },
] as const

export function Stats({ t }: { t: (value: string) => string }) {
  return (
    <section id="learn-more" className="mt-[100px] scroll-mt-24">
      <div className="flex flex-col gap-6 sm:gap-8 lg:min-h-[120px] lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Text as="h2" variant="h2" className="max-w-[690px] text-zinc-950">
            {t('Choose a BTC sell target. See the premium.')}
          </Text>
          <Text variant="body-large" className="mt-5 max-w-[560px] text-zinc-500">
            {t(
              'Hedge keeps the covered-call flow simple while preserving the real terms: BTCB collateral, strike, expiry, premium, and wallet-signed RFQ execution.',
            )}
          </Text>
        </div>
        <Button
          asChild
          size="sm"
          className="w-fit rounded-[5px] tracking-[0.05em] uppercase"
        >
          <Link href="/app">{t('Open Market')}</Link>
        </Button>
      </div>

      <div className="mt-16 flex flex-col gap-12 lg:mt-[90px] lg:flex-row lg:items-stretch lg:gap-12 xl:gap-[75px]">
        {steps.map((step, index) => (
          <Fragment key={step.title}>
            {index > 0 ? (
              <div
                aria-hidden
                className="hidden w-[0.5px] shrink-0 self-stretch bg-zinc-200 lg:block"
              />
            ) : null}
            <article className="lg:flex lg:min-w-0 lg:flex-1 lg:flex-col">
              <p
                className={cn(
                  'font-mono text-[64px] leading-none font-medium',
                  step.numberClassName,
                )}
              >
                {step.number}
              </p>
              <Text as="h3" variant="h5" className="mt-10 text-zinc-950">
                {t(step.title)}
              </Text>
              <Text variant="body-default" className="mt-[15px] text-zinc-500">
                {t(step.description)}
              </Text>
            </article>
          </Fragment>
        ))}
      </div>
    </section>
  )
}
