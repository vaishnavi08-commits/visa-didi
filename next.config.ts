import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ship the stored official-page chunks with the serverless functions.
  outputFileTracingIncludes: { "/api/**": ["./data/**"] },
};

export default nextConfig;
