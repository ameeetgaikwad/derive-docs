import Image from 'next/image'
import { DotGridRipple } from '@/components/dot-grid-ripple'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { Link } from '@/i18n/navigation'
import { cn } from '@/lib/utils'

const ASSET_BASE = '/images/marketing/landing'

export function Liquidity({ t }: { t: (value: string) => string }) {
  return (
    <section
      id="learn-more"
      className="mt-[230px] grid items-center gap-[60px] lg:h-[605px] lg:grid-cols-2 lg:gap-[100px]"
    >
      <div className="relative mx-auto aspect-square w-full max-w-[606px] overflow-hidden">
        <DotGridRipple
          className="absolute inset-0 h-full w-full"
          dotSize={2}
          spacing={10}
          baseColor="#e4e4e4"
          waveColor="#2563eb"
          centerColor="#ff5500"
          waveSpeed={2}
          waveWidth={15}
          centerRadius={20}
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p
            className="font-mono text-[clamp(72px,15vw,160px)] leading-none font-medium tracking-[-0.04em] text-blue-600"
            style={{
              WebkitTextStroke: '60px white',
              paintOrder: 'stroke fill',
            }}
          >
            $60K
          </p>
          <p
            className="font-mono text-[clamp(14px,1.6vw,20px)] leading-none tracking-[-0.03em] text-blue-600"
            style={{
              WebkitTextStroke: '30px white',
              paintOrder: 'stroke fill',
            }}
          >
            {t('BTC spot anchor')}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-[60px] lg:h-full lg:justify-between lg:gap-0 lg:py-[30px]">
        <div className="max-w-[493px]">
          <Text as="h2" variant="h2" className="text-zinc-950">
            {t('Built on the same quote-first flow as Borrow.')}
          </Text>
          <Text variant="body-large" className="mt-[25px] text-zinc-500">
            {t(
              'The important idea is not hiding options. It is making the contract readable: choose a BTC strike, see the premium, and understand the payoff before your wallet signs.',
            )}
          </Text>
          <Button
            asChild
            size="sm"
            className="mt-[35px] tracking-[0.05em] uppercase"
          >
            <Link href="#composer">{t('Build Target')}</Link>
          </Button>
        </div>

        <div className="flex flex-col gap-[35px]">
          <div className="flex items-center gap-5">
            <Text
              variant="subheading-2"
              className="tracking-[0.15em] text-zinc-400 uppercase"
            >
              {t('Powered by')}
            </Text>
            <span aria-hidden className="h-[0.5px] flex-1 bg-zinc-200" />
          </div>
          <div className="flex w-full flex-wrap items-center gap-x-5 gap-y-6 sm:flex-nowrap sm:justify-between sm:gap-0">
            <YziLabsLogo />
            <Divider className="hidden h-[46px] shrink-0 sm:block" />
            <Image
              src={`${ASSET_BASE}/draper-vc-logo.svg`}
              alt="Draper Associates"
              width={170}
              height={46}
              className="h-auto w-[140px] shrink-0 object-contain lg:w-[160px]"
            />
            <Divider className="hidden h-[46px] shrink-0 sm:block" />
            <Image
              src={`${ASSET_BASE}/coinbase-ventures.png`}
              alt="Coinbase Ventures"
              width={120}
              height={46}
              sizes="120px"
              className="h-auto w-[110px] shrink-0 object-contain lg:w-[120px]"
            />
          </div>
        </div>
      </div>
    </section>
  )
}

function YziLabsLogo() {
  return (
    <span className="relative h-[63px] w-[198px] shrink-0 overflow-hidden">
      <Image
        src={`${ASSET_BASE}/yzi-labs.png`}
        alt="YZi Labs"
        width={607}
        height={319}
        quality={90}
        sizes="607px"
        className="absolute top-[-107px] left-[-327px] h-[319px] w-[607px] max-w-none object-cover"
      />
    </span>
  )
}

function Divider({ className }: { className?: string }) {
  return <span className={cn('w-[0.5px] bg-zinc-200', className)} />
}
