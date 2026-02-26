"use client";

interface HedgeLogoProps {
  size?: number;
  className?: string;
}

export function HedgeLogo({ size = 24, className }: HedgeLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Shield shape */}
      <path
        d="M16 2L4 8v8c0 7.18 5.12 13.9 12 15.4C22.88 29.9 28 23.18 28 16V8L16 2z"
        fill="url(#shield-gradient)"
        stroke="url(#shield-stroke)"
        strokeWidth="1"
      />
      {/* Upward arrow / chart line — symbolizes yield */}
      <path
        d="M10 20l4-5 3 3 5-7"
        stroke="#0b1018"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Arrow head */}
      <path
        d="M19 11h3v3"
        stroke="#0b1018"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient id="shield-gradient" x1="16" y1="2" x2="16" y2="31" gradientUnits="userSpaceOnUse">
          <stop stopColor="#22c55e" />
          <stop offset="1" stopColor="#15803d" />
        </linearGradient>
        <linearGradient id="shield-stroke" x1="16" y1="2" x2="16" y2="31" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4ade80" />
          <stop offset="1" stopColor="#16a34a" />
        </linearGradient>
      </defs>
    </svg>
  );
}
