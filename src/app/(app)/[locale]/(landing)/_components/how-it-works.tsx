import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

const steps = [
  {
    number: '01',
    numberClassName: 'text-orange-500',
    title: 'Choose buy lower or sell higher.',
    description:
      "Start with the only decision that matters: cash you want to turn into cheaper BTC, or BTC you would be happy selling above today's price.",
  },
  {
    number: '02',
    numberClassName: 'text-blue-500',
    title: 'Set strike and expiry.',
    description:
      'Pick a strike and expiry. The composer shows the premium, the effective price, and the amount of USDC or BTC collateral committed before you continue.',
  },
  {
    number: '03',
    numberClassName: 'text-green-500',
    title: 'Review settlement outcomes.',
    description:
      'The summary explains what happens if the option settles in the money or out of the money, then you can save or create the target.',
  },
] as const

export function HowItWorks({ t }: { t: (value: string) => string }) {
  return (
    <section id="learn-more" className="mt-[170px] pt-[40px]">
      <div className="mx-auto max-w-[980px]">
        <div className="grid gap-16 lg:gap-20">
          {steps.map((step) => (
            <div
              key={step.number}
              className="grid gap-6 sm:grid-cols-[150px_minmax(0,1fr)] lg:gap-12"
            >
              <p
                className={cn(
                  'font-mono text-[64px] leading-none font-medium',
                  step.numberClassName,
                )}
              >
                {step.number}
              </p>
              <div>
                <Text as="h3" variant="h3" className="text-zinc-900">
                  {t(step.title)}
                </Text>
                <Text
                  variant="body-large"
                  className="mt-4 max-w-[640px] text-zinc-500"
                >
                  {t(step.description)}
                </Text>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
