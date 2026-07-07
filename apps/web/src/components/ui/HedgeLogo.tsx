"use client";

interface HedgeLogoProps {
  size?: number;
  className?: string;
}

/**
 * Hedge wordmark: the diamond mark (kept from the original brand asset) plus
 * "Hedge" as text. The mark's four paths occupy viewBox 0 0 58 47; the rest of
 * the old asset drew the previous wordmark as vectors and has been dropped.
 */
export function HedgeLogo({ size = 24, className }: HedgeLogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <svg
        width={(size * 58) / 47}
        height={size}
        viewBox="0 0 58 47"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path d="M28.9404 18.2134L38.2856 23.6083L42.4315 21.1997L28.9139 13.3953L15.5581 21.157L19.7303 23.5655L28.9404 18.2134Z" fill="currentColor" />
        <path d="M50.3393 25.7656L46.1934 28.1751L49.6975 30.1973L29.0762 42.1821L22.3287 38.2865L18.1829 40.6958L29.1027 47.0001L58.0155 30.1973L50.3393 25.7656Z" fill="currentColor" />
        <path d="M8.31903 30.1973L11.8393 28.152L7.66707 25.7423L2.21312e-06 30.1982L10.9198 36.5025L15.0656 34.0929L8.31903 30.1973Z" fill="currentColor" />
        <path d="M47.0959 10.6725L42.95 13.0811L49.6975 16.9766L38.2856 23.6083L29.0754 28.9614L19.7303 23.5655L15.5581 21.157L8.31803 16.9766L28.9402 4.9929L35.6877 8.88848L39.8327 6.47891L28.9127 0.174805L0 16.9777L29.1019 33.7794L58.0146 16.9766L47.0959 10.6725Z" fill="currentColor" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight">Hedge</span>
    </span>
  );
}
