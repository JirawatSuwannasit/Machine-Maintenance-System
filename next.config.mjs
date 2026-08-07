/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: "/forgot-password",
        destination: "/login",
        permanent: false,
      },
      {
        source: "/update-password",
        destination: "/login",
        permanent: false,
      },
      {
        source: "/auth/:path*",
        destination: "/login",
        permanent: false,
      },
      {
        source: "/signup",
        destination: "/login",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
