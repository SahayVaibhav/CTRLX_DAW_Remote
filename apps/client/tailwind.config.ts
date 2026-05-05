import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ctrlx: {
          bg: "#070b11",
          panel: "#101722",
          panelAlt: "#0c131d",
          line: "rgba(153,247,255,0.12)",
          accent: "#99f7ff",
          accentSoft: "rgba(153,247,255,0.16)",
          text: "#f4fbff",
          muted: "#8ca0ac",
          edge: "#d2f8ff"
        }
      },
      boxShadow: {
        panel: "0 24px 80px rgba(0, 0, 0, 0.36)",
        glow: "0 0 40px rgba(153, 247, 255, 0.14)"
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      letterSpacing: {
        ctrlx: "0.18em"
      }
    }
  },
  plugins: []
};

export default config;
