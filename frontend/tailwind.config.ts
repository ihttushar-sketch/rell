import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0D0F12",
        panel: "#161B22",
        raised: "#1B212B",
        stroke: "#21262D",
        silver: "#C9D1D9",
        paper: "#E6EDF3",
        muted: "#8B949E",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 0 0 rgba(230,237,243,0.04) inset, 0 18px 44px -28px rgba(0,0,0,0.9)",
        silver: "0 0 0 1px rgba(201,209,217,0.22), 0 12px 30px -18px rgba(230,237,243,0.35)",
      },
      keyframes: {
        shimmer: { "0%": { opacity: "0.35" }, "50%": { opacity: "0.85" }, "100%": { opacity: "0.35" } },
        sweep: { "0%": { transform: "translateX(-100%)" }, "100%": { transform: "translateX(100%)" } },
        rise: { "0%": { opacity: "0", transform: "translateY(6px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        shimmer: "shimmer 1.8s ease-in-out infinite",
        sweep: "sweep 1.6s linear infinite",
        rise: "rise 0.35s ease-out both",
      },
    },
  },
  plugins: [],
};
export default config;
