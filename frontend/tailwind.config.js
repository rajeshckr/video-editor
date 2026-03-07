/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'editor-bg': 'var(--editor-bg)',
        'editor-panel': 'var(--editor-panel)',
        'editor-border': 'var(--editor-border)',
        'editor-border-boundary': 'var(--editor-border-boundary)',
        'editor-border-timeline': 'var(--editor-border-timeline)',
        'editor-accent': 'var(--editor-accent)',
        'editor-text': 'var(--editor-text)',
        'editor-muted': 'var(--editor-muted)',
        'editor-hint': 'var(--editor-hint)',
        'clip-video': 'var(--clip-video)',
        'clip-audio': 'var(--clip-audio)',
        'clip-overlay': 'var(--clip-image)',
        'clip-text': 'var(--clip-text-bg)',
      },
      fontFamily: {
        'editor': ['Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
