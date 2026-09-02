/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        darkBg: '#090d16',
        darkCard: '#0f172a',
        darkBorder: '#1e293b',
        terminalBg: '#06090e',
      }
    },
  },
  plugins: [],
}
