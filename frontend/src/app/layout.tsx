import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NEXUS FRAME — Automated Video Framework Extraction & Replication",
  description:
    "Observe any edited video, serialize its cut rhythm, stems and grade into a portable Framework DNA, then replicate it against new footage at any target duration.",
};

export const viewport: Viewport = {
  themeColor: "#0D0F12",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning is intentionally scoped to <html>/<body>: the
    // studio's own markup is deterministic (verified by `npm run check:hydration`),
    // but browser extensions and translated pages mutate these two elements before
    // React hydrates, which React would otherwise report as an unrecoverable diff.
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-ink font-sans text-paper antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
