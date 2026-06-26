import { Fragment } from 'react'
import Image from 'next/image'

const ASSET_BASE = '/images/marketing/landing'

const trustItems = [
  {
    icon: `${ASSET_BASE}/trust-key.svg`,
    label: 'Wallet-signed targets.',
  },
  {
    icon: `${ASSET_BASE}/trust-privacy.svg`,
    label: 'Clear outcomes first.',
  },
  {
    icon: `${ASSET_BASE}/trust-speed.svg`,
    label: 'Live BTC rewards.',
  },
] as const

export function TrustStrip({ t }: { t: (value: string) => string }) {
  return (
    <section className="mt-[100px] flex flex-col items-stretch justify-between gap-10 border-y-[0.5px] border-zinc-200 py-16 md:flex-row md:items-start md:gap-0 lg:py-[100px]">
      {trustItems.map((item, index) => (
        <Fragment key={item.label}>
          {index > 0 && (
            <span
              aria-hidden
              className="hidden w-[0.5px] self-stretch bg-zinc-200 md:block"
            />
          )}
          <div className="flex min-w-0 flex-1 items-center justify-center gap-2.5 overflow-hidden">
            <Image
              src={item.icon}
              alt=""
              width={25}
              height={25}
              className="size-[25px] shrink-0"
            />
            <span className="font-mono text-[14px] leading-[1.35] tracking-[-0.03em] whitespace-nowrap text-zinc-500">
              {t(item.label)}
            </span>
          </div>
        </Fragment>
      ))}
    </section>
  )
}
