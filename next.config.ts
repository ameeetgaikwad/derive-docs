import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Derive API proxy is handled by src/app/api/derive/[...path]/route.ts
  // This ensures X-Lyra* auth headers are forwarded correctly.
};

export default nextConfig;
