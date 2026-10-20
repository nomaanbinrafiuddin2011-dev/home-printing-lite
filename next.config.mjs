/** @type {import('next').NextConfig} */
export default {
  poweredByHeader: false,
  webpack(config) { config.resolve.alias.canvas = false; return config; }, // pdfjs optional dependency
  async headers() { return [{ source: '/(.*)', headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }] }]; },
};
