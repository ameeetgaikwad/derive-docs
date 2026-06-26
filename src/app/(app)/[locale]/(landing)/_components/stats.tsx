import { Fragment } from 'react'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'

const steps = [
  {
    number: '01',
    numberClassName: 'text-orange-500',
    title: 'Choose your side.',
    description:
      "Use cash to wait for a lower BTC entry, or use BTC you would be happy selling above today's price.",
  },
  {
    number: '02',
    numberClassName: 'text-blue-500',
    title: 'Set the price and date.',
    description:
      'Move the target, pick the expiry, and see the reward and effective price before anything is signed.',
  },
  {
    number: '03',
    numberClassName: 'text-green-500',
    title: 'Review both outcomes.',
    description:
      'See what happens if BTC hits your target and what happens if it does not. Then decide.',
  },
] as const

export function Stats({ t }: { t: (value: string) => string }) {
  return (
    <section className="mt-[100px]">
      <div className="flex flex-col gap-6 sm:gap-8 lg:min-h-[120px] lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Text as="h2" variant="h2" className="max-w-[690px] text-zinc-950">
            {t('Pick a BTC price. Know the reward before you commit.')}
          </Text>
          <Text variant="body-large" className="mt-5 max-w-[560px] text-zinc-500">
            {t(
              'Hedge makes paid BTC targets feel like a simple calculator, not a trading terminal.',
            )}
          </Text>
        </div>
        <Button
          asChild
          size="sm"
          className="w-fit rounded-[5px] tracking-[0.05em] uppercase"
        >
          <Link href="#composer">{t('Build Target')}</Link>
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
