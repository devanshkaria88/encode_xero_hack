/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // Linting is run separately; do not block the demo build on lint.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
