/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ESLint is intentionally not a build dependency; TypeScript still type-checks.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
