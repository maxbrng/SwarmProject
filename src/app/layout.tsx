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
      <body suppressHydrationWarning>
        {/* Boot-time error catcher: runs before the React bundle, paints ANY JS error or failed
            chunk load onto the screen. Without this a WebKit-only failure (e.g. iPad) that crashes
            before React mounts just shows a black screen with no clue. Temporary diagnostic. */}
        <script
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
