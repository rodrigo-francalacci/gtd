import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @gtd/db ships raw TypeScript from the workspace, so Next has to compile it.
  transpilePackages: ['@gtd/db'],
};

export default nextConfig;
