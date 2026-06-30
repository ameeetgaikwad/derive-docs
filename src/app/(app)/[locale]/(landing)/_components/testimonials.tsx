import { TestimonialsCarousel } from './testimonials-carousel'

const ASSET_BASE = '/images/marketing/landing'

const testimonials = [
  {
    quote:
      '“I want to buy BTC every month, but I hate chasing dips. Hedge lets me set the strike I wanted anyway and shows the premium if the market never gets there.”',
    name: 'Monthly buyer',
    handle: 'Buy BTC cheaper',
    avatar: `${ASSET_BASE}/paul-taylor.jpeg`,
  },
  {
    quote:
      '“I would sell a small slice if BTC ripped higher, but not my whole stack. This makes that tradeoff obvious before I commit anything.”',
    name: 'Long-term holder',
    handle: 'Sell BTC higher',
    avatar: `${ASSET_BASE}/lauren-lee.jpeg`,
  },
  {
    quote:
      '“The review screen matters. I can see the strike, expiry, premium, and exactly what happens if BTC settles above or below the price.”',
    name: 'First-time user',
    handle: 'Decentralized rails',
    avatar: `${ASSET_BASE}/jack.jpeg`,
  },
  {
    quote:
      '“The useful framing is simple: a limit order that can pay me. The rest can stay under the hood.”',
    name: 'Bitcoin saver',
    handle: 'Paid target orders',
    avatar: `${ASSET_BASE}/samee.jpeg`,
  },
  {
    quote:
      '“I can put a small amount of BTC behind a high target and leave the rest untouched. That feels much easier than managing a trading account.”',
    name: 'Stack manager',
    handle: 'Small BTC slices',
    avatar: `${ASSET_BASE}/haley.jpeg`,
  },
  {
    quote:
      '“For my cash, the buy side is the interesting part. I already know the dip I would buy. Hedge just turns that patience into a visible premium.”',
    name: 'Cash allocator',
    handle: 'Dip target',
    avatar: `${ASSET_BASE}/draper.jpg`,
  },
  {
    quote:
      '“I do not want a derivatives dashboard. I want to say buy here, sell there, show me the dollars, and tell me what can happen.”',
    name: 'Mobile-first user',
    handle: 'Simple target UX',
    avatar: `${ASSET_BASE}/jorge.jpg`,
  },
] as const

export function Testimonials({ t }: { t: (value: string) => string }) {
  const items = testimonials.map((testimonial) => ({
    ...testimonial,
    quote: t(testimonial.quote),
    name: t(testimonial.name),
  }))

  return (
    <section className="mt-[140px]">
      <TestimonialsCarousel
        title={t('Made for people who think in BTC prices, not trading jargon.')}
        items={items}
      />
    </section>
  )
}
