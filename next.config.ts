import type { NextConfig } from "next";
const nextConfig: NextConfig = { serverExternalPackages: ["tesseract.js", "@napi-rs/canvas"] };
export default nextConfig;
