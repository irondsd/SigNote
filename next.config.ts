import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  env: {
    // For Vercel deployments, ensure NEXTAUTH_URL is set to the correct URL
    NEXTAUTH_URL: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.NEXTAUTH_URL, // fallback to your .env for local dev
  },
};

export default nextConfig;
