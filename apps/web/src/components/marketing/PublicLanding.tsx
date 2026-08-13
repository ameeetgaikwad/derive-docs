import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Faq } from "@/app/(app)/[locale]/(landing)/_components/faq";
import { MarketingFooter } from "@/app/(app)/[locale]/(landing)/_components/marketing-footer";
import { Stats } from "@/app/(app)/[locale]/(landing)/_components/stats";
import { TrustStrip } from "@/app/(app)/[locale]/(landing)/_components/trust-strip";
import { NavbarLogo } from "@/components/root/navbar-logo";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { PublicMarketPreview } from "./PublicMarketPreview";

const ASSET_BASE = "/images/marketing/landing";
const t = (value: string) => value;

export function PublicLanding() {
  return (
    <div className="min-h-screen overflow-x-clip bg-zinc-900 text-zinc-950">
      <div className="bg-white">
        <PublicHeader />
        <main className="mx-auto flex w-full max-w-[1512px] flex-col px-5 pb-20 pt-8 sm:px-8 lg:px-[clamp(2rem,13.93vw_-_110.66px,6.25rem)] lg:pb-[120px] lg:pt-[55px]">
          <section className="grid grid-cols-1 items-center gap-12 xl:min-h-[560px] xl:grid-cols-[minmax(0,606px)_minmax(480px,1fr)] xl:gap-[50px]">
            <div className="flex h-full flex-col items-start justify-between gap-12 xl:pb-[33px] xl:pt-[50px]">
              <div className="flex flex-col items-start gap-10">
                <div>
                  <Text
                    as="h1"
                    variant="h1"
                    className="max-w-[606px] text-zinc-950"
                    style={{ fontSize: "clamp(42px, calc(40.6154px + 0.3846vw), 48px)" }}
                  >
                    Sell{" "}
                    <Image
                      src={`${ASSET_BASE}/btc-icon.svg`}
                      alt=""
                      width={50}
                      height={50}
                      className="mx-2 hidden size-[50px] -translate-y-[3px] align-middle sm:inline-block"
                    />
                    <em className="text-orange-500 italic">BTC</em> higher. Get paid while you wait.
                  </Text>
                  <Text variant="subheading-1" className="mt-[25px] max-w-[520px] text-black/50">
                    A focused covered-call platform for BTCB. Choose a weekly sell target, understand both outcomes, and sign only after the live premium works for you.
                  </Text>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button asChild className="rounded-[5px] px-5 py-[15px] tracking-[0.05em] uppercase">
                    <Link href="/app">Open the market <ArrowRight className="size-4" aria-hidden="true" /></Link>
                  </Button>
                  <Button asChild variant="secondary" className="rounded-[5px] border-zinc-200 bg-transparent px-5 py-[15px] tracking-[0.05em] uppercase">
                    <Link href="#learn-more">Learn more</Link>
                  </Button>
                </div>
              </div>

              <div className="flex h-[47px] w-full items-center gap-5 overflow-hidden">
                <div className="flex h-full shrink-0 flex-col justify-center border-l border-green-500 pl-5 font-mono text-green-600">
                  <span className="text-xl leading-none tracking-[-0.03em]">Weekly</span>
                  <span className="mt-1 text-sm leading-none">BTC call expiries</span>
                </div>
                <div className="relative h-full min-w-[100px] flex-1 overflow-hidden" aria-hidden="true">
                  <div className="absolute inset-y-0 left-0 w-full bg-[radial-gradient(circle,#d4d4d8_1.4px,transparent_1.5px)] bg-[size:10px_10px]" />
                  <div className="absolute inset-y-0 left-0 w-1/2 bg-[radial-gradient(circle,#22c55e_1.4px,transparent_1.5px)] bg-[size:10px_10px] [mask-image:linear-gradient(90deg,black,transparent)]" />
                </div>
              </div>
            </div>
            <PublicMarketPreview />
          </section>

          <TrustStrip t={t} />
          <Stats t={t} />
          <OutcomeSection />
          <Faq t={t} />
        </main>
      </div>
      <MarketingFooter t={t} />
    </div>
  );
}

function PublicHeader() {
  return (
    <header className="sticky top-0 z-40 border-b-[0.5px] border-zinc-100 bg-white/95 backdrop-blur-[6px]">
      <div className="mx-auto flex min-h-[76px] w-full max-w-[1512px] items-center justify-between gap-5 px-5 sm:px-8 lg:px-[clamp(2rem,13.93vw_-_110.66px,6.25rem)]">
        <NavbarLogo />
        <div className="flex items-center gap-4 sm:gap-7">
          <nav className="hidden items-center gap-7 md:flex" aria-label="Public navigation">
            <Link href="#learn-more" className="font-mono text-sm text-zinc-500 hover:text-zinc-950">How it works</Link>
            <span aria-hidden className="h-4 w-px bg-zinc-200" />
            <Link href="#outcomes" className="font-mono text-sm text-zinc-500 hover:text-zinc-950">Outcomes</Link>
            <span aria-hidden className="h-4 w-px bg-zinc-200" />
            <Link href="#faq" className="font-mono text-sm text-zinc-500 hover:text-zinc-950">FAQs</Link>
          </nav>
          <Button asChild variant="outline" size="sm" className="min-h-11 rounded-[5px] px-4 tracking-[0.05em] uppercase">
            <Link href="/app">Open app</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

function OutcomeSection() {
  return (
    <section id="outcomes" className="mt-[140px] scroll-mt-28 border-y-[0.5px] border-zinc-200 py-16 lg:py-[90px]">
      <div className="grid gap-12 lg:grid-cols-[minmax(280px,0.75fr)_minmax(0,1.25fr)] lg:gap-[100px]">
        <div>
          <p className="font-mono text-xs text-orange-600">AT EXPIRY</p>
          <Text as="h2" variant="h2" className="mt-4 max-w-md text-zinc-950">The trade-off stays visible.</Text>
          <Text variant="body-large" className="mt-5 max-w-lg text-zinc-500">
            The premium is paid for giving up gains above your chosen strike on only the BTCB amount you cover.
          </Text>
        </div>
        <div>
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4" aria-label="Covered call outcome rail">
            <span className="size-3 rounded-full bg-green-500" />
            <span className="h-[3px] bg-[linear-gradient(90deg,#22c55e_0%,#facc15_54%,#f97316_100%)]" />
            <span className="size-3 rotate-45 bg-orange-500" />
          </div>
          <div className="mt-3 flex justify-between font-mono text-[11px] text-zinc-500"><span>BTC below strike</span><span>BTC above strike</span></div>
          <div className="mt-8 grid gap-8 sm:grid-cols-2 sm:gap-0">
            <article className="sm:border-r-[0.5px] sm:border-zinc-200 sm:pr-10">
              <p className="font-mono text-[11px] text-green-600">OUT OF THE MONEY</p>
              <Text as="h3" variant="h4" className="mt-3 text-zinc-950">Keep BTCB + premium.</Text>
              <Text variant="body-small" className="mt-3 text-zinc-500">The call expires below strike. Your covered BTCB remains, with the protocol fee deducted from the gross premium.</Text>
            </article>
            <article className="sm:pl-10">
              <p className="font-mono text-[11px] text-orange-600">IN THE MONEY</p>
              <Text as="h3" variant="h4" className="mt-3 text-zinc-950">Upside above strike is offset.</Text>
              <Text variant="body-small" className="mt-3 text-zinc-500">The subaccount owes (settlement − strike) × covered BTCB in USDT; a cash shortfall becomes borrowing against BTCB.</Text>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}
