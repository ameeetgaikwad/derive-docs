import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { Link } from '@/i18n/navigation'

import { AnimatedFaqList } from './animated-faq-list'

const faqs = [
  {
    question: 'What is Hedge?',
    answer:
      'Hedge is options made simple for BTC targets. You choose a price where you would already buy or sell BTC, and the app shows the reward for making that commitment.',
  },
  {
    question: 'Is this options trading?',
    answer:
      'Yes, under the hood. Buy cheaper maps to a cash-secured put, and sell higher maps to a covered call. Hedge keeps the interface focused on BTC price, reward, and outcomes instead of options jargon.',
  },
  {
    question: 'How does buying BTC cheaper work?',
    answer:
      'You reserve cash for a lower BTC price. If BTC trades down to your target, you buy at that price. If it does not, no BTC is bought and you keep the reward previewed by the composer.',
  },
  {
    question: 'How does selling BTC higher work?',
    answer:
      'You commit only the BTC slice you would be comfortable selling at a higher price. If BTC reaches the target, that slice is capped or sold. If it does not, you keep the BTC and the reward.',
  },
  {
    question: 'Can I lose my whole BTC stack?',
    answer:
      'No. The sell side only applies to the BTC amount you put into the target. Anything outside that slice remains fully exposed to BTC.',
  },
  {
    question: 'Is this just a limit order?',
    answer:
      'It feels like a limit order, but the difference is the reward. Hedge shows the effective price after the reward, so users can reason in normal buy and sell terms.',
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
