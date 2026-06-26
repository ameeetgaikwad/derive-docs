import Image from "next/image";
import { siteConfig } from "@/config/site-config";
import { Link } from "@/i18n/navigation";

export function NavbarLogo({ href = "/" }: { href?: string }) {
  return (
    <div className="flex items-center gap-3">
      <Link href={href} className="relative h-6 w-fit shrink-0 md:h-7">
        <Image
          alt="Hedge"
          className="h-full w-auto"
          src={siteConfig.logos.hedge}
          width={1500}
          height={318}
          priority
        />
      </Link>
      <span className="rounded-sm border-[0.5px] border-orange-200 bg-orange-50 px-2 py-1 font-mono text-[10px] font-medium uppercase text-orange-700">
        BSC testnet
      </span>
    </div>
  );
}
