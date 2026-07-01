"use client";

import dynamic from "next/dynamic";

// Canvas client-only laden: WebGPU darf nie beim SSR/Modul-Import laufen.
const BoidsCanvas = dynamic(() => import("./BoidsCanvas"), { ssr: false });

export default function SwarmStage() {
  return <BoidsCanvas />;
}
