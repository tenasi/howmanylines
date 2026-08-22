import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  turbopack: {},
  webpack: (config) => {
    config.ignoreWarnings = [
      { module: /node_modules\/isomorphic-git/ },
    ];
    return config;
  },
};

export default nextConfig;
