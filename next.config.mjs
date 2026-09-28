/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // Server-only packages that must not be bundled (Next 15 top-level key).
  serverExternalPackages: ['@e2b/code-interpreter', 'firebase-admin'],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    }
    return config
  },
}

export default nextConfig
