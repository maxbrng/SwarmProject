"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// Load the canvas client-only: WebGPU must never run during SSR/module import.
const BoidsCanvas = dynamic(() => import("./BoidsCanvas"), { ssr: false });

// Lightweight WebGPU preflight. Runs BEFORE the heavy engine chunk loads, so a device that can't
// run WebGPU gets a clear, readable message instead of a black screen. Two distinct failure modes:
//  - "insecure": the page is served over http:// to a non-localhost host (e.g. a LAN IP like
//    http://192.168.x.x:3000 opened from an iPad). WebGPU is a [SecureContext] API → navigator.gpu
//    is simply absent. localhost is exempt (why it works on the dev machine but not over the LAN).
//    Fix = serve over https (Vercel deploy, `next dev --experimental-https`, or an https tunnel).
//  - "missing": secure context but no WebGPU at all (e.g. iPad/iOS Safari — and Chrome on iOS, same
//    WebKit engine — with WebGPU off/behind a flag, or an outdated browser).
type Support = "checking" | "ok" | "insecure" | "missing";

export default function SwarmStage() {
  const [support, setSupport] = useState<Support>("checking");

  useEffect(() => {
    if (typeof navigator !== "undefined" && "gpu" in navigator) setSupport("ok");
    else if (typeof window !== "undefined" && !window.isSecureContext) setSupport("insecure");
    else setSupport("missing");
  }, []);

  if (support === "checking") return null;

  if (support === "insecure") {
    return (
      <div className="swarm-error">
        <div>
          <p style={{ fontSize: "1.15rem", marginBottom: "0.75rem" }}>
            WebGPU is disabled because this page is not served over a secure connection.
          </p>
          <p style={{ opacity: 0.85 }}>
            You opened it over <b>http://</b> to a LAN address. Browsers only expose WebGPU on{" "}
            <b>https://</b> (or on <b>localhost</b>) — so it works on the dev machine but not from
            another device over the network. Open it over https instead: use the deployed
            (Vercel) URL, run the dev server with <b>next dev --experimental-https</b>, or expose it
            through an https tunnel (e.g. ngrok / cloudflared).
          </p>
        </div>
      </div>
    );
  }

  if (support === "missing") {
    return (
      <div className="swarm-error">
        <div>
          <p style={{ fontSize: "1.15rem", marginBottom: "0.75rem" }}>
            This browser has no WebGPU support.
          </p>
          <p style={{ opacity: 0.85 }}>
            On iPad / iPhone (Safari <b>and</b> Chrome both use WebKit): update to the latest
            iPadOS/iOS, then enable it under{" "}
            <b>Settings → Apps → Safari → Advanced → Feature Flags → WebGPU</b>. On desktop, use an
            up-to-date Chrome or Edge.
          </p>
        </div>
      </div>
    );
  }

  return <BoidsCanvas />;
}
