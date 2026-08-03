/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ESLint is intentionally not a build dependency; TypeScript still type-checks.
  eslint: { ignoreDuringBuilds: true },
  // The extension page became the site's front door. `/extension` must keep resolving: it is
  // the manifest's `homepage_url`, it is printed in the Chrome Web Store listing, and it is
  // linked from the blog and from every earlier release note. `/extension/privacy` is a
  // separate route and is unaffected — `source` is an exact path match, not a prefix.
  async redirects() {
    return [{ source: "/extension", destination: "/", permanent: true }];
  },
};

export default nextConfig;
