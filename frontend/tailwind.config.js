/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'editor-bg': '#0d1117',
        'editor-panel': '#161b22',
        'editor-border': '#30363d',
        'editor-accent': '#3b82f6',
        'editor-text': '#e6edf3',
        'editor-muted': '#8b949e',
        'clip-video': '#6d46a8',
        'clip-audio': '#0e7490',
        'clip-overlay': '#c2410c',
        'clip-text': '#b45309',
      },
      fontFamily: {
        'editor': ['Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
