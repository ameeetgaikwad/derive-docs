import Image from 'next/image'
import Link from 'next/link'
import { DotGridWave } from '@/components/dot-grid-wave'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { siteConfig } from '@/config/site-config'
import { cn } from '@/lib/utils'

const ASSET_BASE = '/images/marketing/landing'

const footerLinks = {
  Product: [
    { label: 'Home', href: '/' },
    { label: 'Open Market', href: '/app' },
    { label: 'How It Works', href: '#learn-more' },
    { label: 'FAQs', href: '#faq' },
  ],
  Protocol: [
    { label: 'Wallet-signed orders', href: '#learn-more' },
    { label: 'On-chain settlement', href: '#outcomes' },
    { label: 'RFQ pricing', href: '#faq' },
  ],
} as const

export function MarketingFooter({ t }: { t: (value: string) => string }) {
  return (
    <footer className="bg-zinc-900 text-white">
      <div className="mx-auto flex w-full max-w-[1512px] flex-col px-5 py-20 sm:px-8 lg:px-[100px] lg:py-[100px]">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <BitcoinLoanHeadline
            as="h2"
            t={t}
            className="font-heading max-w-[606px] text-4xl leading-[1.25] font-bold tracking-[-0.03em] sm:text-5xl"
          />
          <Button
            asChild
            variant="secondary"
            className="w-fit rounded-[5px] px-5 py-[15px] tracking-[0.05em] uppercase lg:mb-[9px]"
          >
            <Link href="/app">{t('Open Market')}</Link>
          </Button>
        </div>
        <div className="mt-[50px] h-[64px] w-full overflow-hidden">
          <DotGridWave
            dotSize={2}
            spacing={10}
            waveColor="#f97316"
            baseColor="#333333"
            backgroundColor="#18181b"
            direction="left-to-right"
            waveSpeed={5}
            waveWidth={20}
            className="h-full w-full"
          />
        </div>
        <div className="mt-[100px] flex flex-col gap-12 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-[661px]">
            <LogoMark tone="light" />
            <Text
              variant="body-small"
              className="mt-[25px] tracking-[-0.025em] text-zinc-500"
            >
              {t(
                'Hedge is a Sats Terminal covered-call interface. Browse a strike and expiry, choose your BTCB amount, then review and sign an executable RFQ market-maker quote.',
              )}
            </Text>
          </div>
          <div className="flex gap-[59px]">
            {Object.entries(footerLinks).map(([title, links]) => (
              <div key={title} className="flex flex-col gap-[25px]">
                <Text as="h3" variant="h5" className="text-zinc-200">
                  {t(title)}
                </Text>
                <div className="flex flex-col gap-[5px]">
                  {links.map((link) => (
                    <Link
                      key={`${title}-${link.label}`}
                      href={link.href}
                      className="w-fit text-xs leading-[1.35] font-medium tracking-[-0.025em] text-zinc-500 hover:underline"
                    >
                      {t(link.label)}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}

function BitcoinLoanHeadline({
  as: Tag,
  t,
  className,
}: {
  as: 'h1' | 'h2'
  t: (value: string) => string
  className?: string
}) {
  return (
    <Tag className={className}>
      {t('Sell')}{' '}
      <Image
        src={`${ASSET_BASE}/btc-icon.svg`}
        alt=""
        width={50}
        height={50}
        className="mx-2 hidden size-[50px] -translate-y-[3px] align-middle sm:inline-block"
      />
      <em className="text-orange-500 italic">{t('BTC')}</em>{' '}
      {t('higher. Get paid while you wait.')}
    </Tag>
  )
}

function LogoMark({ tone }: { tone: 'dark' | 'light' }) {
  return (
    <Link
      href="/"
      className="flex w-fit items-center"
      aria-label="Hedge home"
    >
      <Image
        src={siteConfig.logos.hedge}
        alt="Hedge"
        width={224}
        height={28}
        priority
        className={cn('h-7 w-auto', tone === 'light' && 'invert')}
      />
    </Link>
  )
}
