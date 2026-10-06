/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // Server-only packages that must not be bundled (Next 15 top-level key).
  // pdfjs-dist must stay external too: bundling it breaks pdf.js's worker
  // resolution at runtime ("Setting up fake worker failed").
  serverExternalPackages: ['@e2b/code-interpreter', 'firebase-admin', 'pdfjs-dist'],
  // The Indian Knowledge Systems corpus is read from disk at runtime, so it has
  // to be traced into the function bundle — Next cannot see it through
  // fs.readFileSync with a computed path.
  outputFileTracingIncludes: {
    '/api/chats/[id]/messages': ['./src/data/iks/corpus.json.gz'],
    '/api/iks/search': ['./src/data/iks/corpus.json.gz'],
    '/iks': ['./src/data/iks/corpus.json.gz'],
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    }
    return config
  },
}

export default nextConfig
