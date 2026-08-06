import Image from "next/image";
import Link from "next/link";
import { siteConfig } from "@/config/site-config";

export function NavbarLogo({ href = "/" }: { href?: string }) {
  return (
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
  );
}
