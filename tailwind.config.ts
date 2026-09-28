import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // BODHA warm palette per spec
        bg: '#FAF7F2',
        text: '#2B2723',
        accent: '#C1633B',
        card: '#F1EAE0',
        // Semantic aliases
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        border: 'var(--border)',
        ring: 'var(--ring)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        display: ['var(--font-display)', 'Georgia', 'serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      maxWidth: {
        'prose': '700px',
      },
      boxShadow: {
        warm: '0 1px 2px rgba(43, 39, 35, 0.05), 0 8px 24px -12px rgba(43, 39, 35, 0.18)',
        'warm-lg': '0 2px 4px rgba(43, 39, 35, 0.06), 0 24px 48px -16px rgba(43, 39, 35, 0.25)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
        blink: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0' } },
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.35s ease-out both',
        'fade-in': 'fade-in 0.25s ease-out both',
        'pulse-soft': 'pulse-soft 1.6s ease-in-out infinite',
        blink: 'blink 1s step-end infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
safelist: {
  patterns: [
    /bg-(primary|secondary|accent|card|muted|surface)/,
    /text-(primary|secondary|accent|card|muted|surface)/,
    /ring-(primary|secondary|accent|card|muted|surface)/,
  ],
},
}
export default config