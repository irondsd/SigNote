import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  sassOptions: {
    silenceDeprecations: ["import"],
    additionalData: `@use '@/styles/index.scss' as *;`,
    includePaths: [path.join(__dirname, "styles")],
  },

  serverExternalPackages: ["pino", "thread-stream"],
};

export default nextConfig;
