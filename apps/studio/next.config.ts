import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@life/contracts', '@life/db', '@life/content', '@life/media', '@life/instagram'],
  serverExternalPackages: ['pg', '@electric-sql/pglite', 'embedded-postgres'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};

export default config;
