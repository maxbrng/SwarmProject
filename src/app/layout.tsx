import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Swarm",
  description: "Autonomous boids ecosystem (WebGPU)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: browser extensions (theme/color-scheme managers, e.g. ones
    // that add data-theme / color-scheme / a "chakra-ui-*" class) mutate <html>/<body> before
    // React hydrates. That's harmless but triggers a hydration mismatch warning — suppressing
    // it on these two elements is the official Next.js fix. Only affects their own attributes.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
