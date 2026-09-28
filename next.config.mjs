/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // Server-only packages that must not be bundled (Next 15 top-level key).
  // pdfjs-dist must stay external too: bundling it breaks pdf.js's worker
  // resolution at runtime ("Setting up fake worker failed").
  serverExternalPackages: ['@e2b/code-interpreter', 'firebase-admin', 'pdfjs-dist'],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    }
    return config
  },
}

export default nextConfig
