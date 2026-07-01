import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // WebGPU verträgt den StrictMode-Doppelstart der Sim im Dev nicht gut
  // (zwei Devices teilen sich einen Canvas-Context). Daher aus.
  reactStrictMode: false,
};

export default nextConfig;
