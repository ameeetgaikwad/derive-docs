import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import Link from 'next/link'

import { AnimatedFaqList } from './animated-faq-list'

const faqs = [
  {
    question: 'What is Hedge?',
    answer:
      'Hedge is a covered-call interface for BTCB. You browse an expiry and strike, enter the BTCB amount, then review the indicative outcome before opening an RFQ auction.',
  },
  {
    question: 'Is this options trading?',
    answer:
      'Yes. A sell target is a covered call. Hedge keeps the workflow focused on BTC price, premium, expiry, collateral, and the two possible settlement outcomes.',
  },
  {
    question: 'How does selling BTC higher work?',
    answer:
      'You cover a chosen BTCB amount. Below the strike, you keep that BTCB and the premium after fees. Above it, the subaccount owes (settlement minus strike) times the covered amount in USDT; a cash shortfall becomes borrowing against BTCB.',
  },
  {
    question: 'Where does the premium come from?',
    answer:
      'The app opens a short RFQ auction with connected market makers. Board prices are indicative; the winning signed quote sets the executable gross premium. Hedge shows the live protocol OI-fee estimate and expected net cash change before signing.',
  },
  {
    question: 'Can I lose my whole BTC stack?',
    answer:
      'BTC downside remains, and an above-strike cash obligation can borrow against BTCB held in the covered-call subaccount. BTCB left in your wallet is not deposited automatically. Review the amount, net economics, and both settlement outcomes before signing.',
  },
  {
    question: 'Can I exit before expiry?',
    answer:
      'Not in the current version. A covered call runs to its listed expiry, so choose the date and strike assuming the position stays open until settlement.',
  },
  {
    question: 'Is this just a limit order?',
    answer:
      'It can feel similar because you choose a sell price, but a covered call has an expiry and an upfront premium. The market view shows both settlement outcomes before you sign.',
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
          <Link href="/app">{t('Open the market')}</Link>
        </Button>
      </div>
      <AnimatedFaqList items={translatedFaqs} />
    </section>
  )
}
