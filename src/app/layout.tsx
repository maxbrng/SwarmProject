import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import {
  SITE_URL,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_DESCRIPTION,
  AUTHOR_NAME,
  SITE_KEYWORDS,
} from "@/lib/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// metadataBase makes every relative URL below (og image, canonical) resolve against the live domain,
// which is what crawlers and link previews need — they cannot resolve site-relative paths themselves.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — Interactive WebGPU Ecosystem`,
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: SITE_KEYWORDS,
  authors: [{ name: AUTHOR_NAME }],
  creator: AUTHOR_NAME,
  publisher: AUTHOR_NAME,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  category: "art",
};

// Phone behaviour. viewport-fit=cover lets the canvas run under the notch and home indicator (the
// panels pull themselves back with env() insets in globals.css). Zoom is disabled on purpose: the
// whole surface is a gesture target — pinching means sculpting terrain here, and without this the
// browser would zoom the page instead. themeColor paints the browser chrome black so the artwork
// reaches the screen edges like an app.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: browser extensions mutate <html>/<body> before React hydrates, which
    // would trigger a harmless hydration-mismatch warning. Suppressing it here is the Next.js fix.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        {/* Structured data: tells search engines this page IS the artwork, not a page about one. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "VisualArtwork",
              name: SITE_NAME,
              headline: `${SITE_NAME} — ${SITE_TAGLINE}`,
              description: SITE_DESCRIPTION,
              url: SITE_URL,
              image: `${SITE_URL}/opengraph-image`,
              artform: "Interactive digital artwork",
              artMedium: "Real-time WebGPU simulation",
              creator: { "@type": "Person", name: AUTHOR_NAME },
              inLanguage: "en",
              keywords: SITE_KEYWORDS.join(", "),
            }),
          }}
        />
        <script
          data-role="boot-error-catcher"
          dangerouslySetInnerHTML={{
            __html: `(function(){
  function show(msg){
    try{
      if(!document.body){ window.addEventListener('DOMContentLoaded', function(){show(msg);}); return; }
      var el = document.getElementById('__boot_error');
      if(!el){
        el = document.createElement('div');
        el.id = '__boot_error';
        el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0a0a0a;color:#ff8a8a;font:13px/1.5 ui-monospace,monospace;padding:20px;white-space:pre-wrap;overflow:auto';
        document.body.appendChild(el);
      }
      el.textContent += msg + '\\n\\n';
    }catch(_){}
  }
  window.addEventListener('error', function(e){
    if(e.target && e.target !== window && (e.target.src || e.target.href)){
      show('Failed to load resource:\\n' + (e.target.src || e.target.href));
    } else {
      show('JS error: ' + (e.message || (e.error && e.error.message) || e.error) + (e.filename ? ('\\n@ ' + e.filename + ':' + e.lineno + ':' + e.colno) : ''));
    }
  }, true);
  window.addEventListener('unhandledrejection', function(e){
    var r = e.reason;
    show('Unhandled promise rejection:\\n' + (r && (r.message || r.stack) || r));
  });
})();`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
