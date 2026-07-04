"use client";

import dynamic from "next/dynamic";

// Load the canvas client-only: WebGPU must never run during SSR/module import.
const BoidsCanvas = dynamic(() => import("./BoidsCanvas"), { ssr: false });

export default function SwarmStage() {
  return <BoidsCanvas />;
}
