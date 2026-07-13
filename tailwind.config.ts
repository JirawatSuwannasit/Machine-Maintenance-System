import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#0B1F3A",
        accent: "#005BAC",
        surface: "#F1F3F5",
      },
    },
  },
  plugins: [],
};

export default config;
