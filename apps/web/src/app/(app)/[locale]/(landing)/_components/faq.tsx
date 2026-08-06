import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import Link from 'next/link'

import { AnimatedFaqList } from './animated-faq-list'

const faqs = [
  {
    question: 'What is Hedge?',
    answer:
      'Hedge is a covered-call interface for BTCB. You choose the BTC amount, strike, and expiry, then review the indicative premium before opening an RFQ auction.',
  },
  {
    question: 'Is this options trading?',
    answer:
      'Yes. A sell target is a covered call. Hedge keeps the workflow focused on BTC price, premium, expiry, collateral, and the two possible settlement outcomes.',
  },
  {
    question: 'How does selling BTC higher work?',
    answer:
      'You commit only the BTCB slice you would be comfortable selling at a higher strike. If BTC settles above it, that slice can be sold at the strike. Otherwise you keep the BTCB and the premium.',
  },
  {
    question: 'Where does the premium come from?',
    answer:
      'The app opens a short RFQ auction with connected market makers. The displayed board price is indicative; the executable premium comes from the winning signed quote.',
  },
  {
    question: 'Can I lose my whole BTC stack?',
    answer:
      'The covered call only applies to the BTCB amount you deposit into the target account. Anything outside that slice remains outside the position, though the covered slice gives up upside above the strike.',
  },
  {
    question: 'Is this just a limit order?',
    answer:
      'It can feel similar because you choose a sell price, but a covered call has an expiry and an upfront premium. The composer shows both settlement outcomes before you sign.',
  },
] as const

export function Faq({ t }: { t: (value: string) => string }) {
  const translatedFaqs = faqs.map((faq) => ({
    question: t(faq.question),
    answer: t(faq.answer),
  }))

  return (
    <section id="faq" className="mt-[140px] grid items-start gap-12 lg:grid-cols-[minmax(280px,488px)_minmax(0,673px)] lg:gap-[150px]">
      <div className="lg:sticky lg:top-20">
        <Text as="h2" variant="h3" className="text-zinc-950">
          {t('Everything you need to know.')}
        </Text>
        <Button
          asChild
          variant="outline"
          size="sm"
          className="mt-[35px] tracking-[0.05em] uppercase"
        >
          <Link href="#composer">{t('Try the composer')}</Link>
        </Button>
      </div>
      <AnimatedFaqList items={translatedFaqs} />
    </section>
  )
}
