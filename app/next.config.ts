import type { NextConfig } from "next";

// Static export for GitHub Pages, served under the repo subpath
// https://osenarwri.github.io/afolu-explorer/. basePath handles routing +
// bundled assets; NEXT_PUBLIC_BASE_PATH is exposed so client-side fetch() calls
// (which Next does NOT auto-prefix) can resolve data under the subpath too.
const basePath = "/afolu-explorer";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
