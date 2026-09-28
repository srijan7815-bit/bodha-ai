import type { Config } from 'tailwindcss'

/**
 * BODHA AI design system.
 *
 * Warm "paper" palette from the product spec, semantic tokens with full
 * alpha-modifier support, and a deliberately small type/icon scale so the UI
 * stays quiet and reads like a page rather than a dashboard.
 */

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'rgb(var(--border) / <alpha-value>)',
        input: 'rgb(var(--input) / <alpha-value>)',
        ring: 'rgb(var(--ring) / <alpha-value>)',
        background: 'rgb(var(--background) / <alpha-value>)',
        foreground: 'rgb(var(--foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'rgb(var(--primary) / <alpha-value>)',
          foreground: 'rgb(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'rgb(var(--secondary) / <alpha-value>)',
          foreground: 'rgb(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'rgb(var(--muted) / <alpha-value>)',
          foreground: 'rgb(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          foreground: 'rgb(var(--accent-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'rgb(var(--destructive) / <alpha-value>)',
          foreground: 'rgb(var(--destructive-foreground) / <alpha-value>)',
        },
        card: {
          DEFAULT: 'rgb(var(--card) / <alpha-value>)',
          foreground: 'rgb(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'rgb(var(--popover) / <alpha-value>)',
          foreground: 'rgb(var(--popover-foreground) / <alpha-value>)',
        },
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'background-soft': 'rgb(var(--background-soft) / <alpha-value>)',
        ink: 'rgb(var(--code-ink) / <alpha-value>)',
        code: 'rgb(var(--code-bg) / <alpha-value>)',
      },

      fontFamily: {
        // UI chrome — Inter
        sans: ['var(--font-inter)', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        // Reading body — Source Serif 4
        serif: ['var(--font-serif)', 'Iowan Old Style', 'Georgia', 'serif'],
        // Devanagari wordmark — Tiro Devanagari Hindi
        deva: ['var(--font-devanagari)', 'Nirmala UI', 'Noto Sans Devanagari', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },

      fontSize: {
        // Reading-first scale. 16.5px body with 1.7 leading (spec: 16–17px / 1.6–1.7)
        reading: ['16.5px', { lineHeight: '1.72', letterSpacing: '-0.003em' }],
        'reading-sm': ['15px', { lineHeight: '1.68' }],
        ui: ['14px', { lineHeight: '1.5' }],
        'ui-sm': ['13px', { lineHeight: '1.45' }],
        'ui-xs': ['11.5px', { lineHeight: '1.4', letterSpacing: '0.04em' }],
      },

      maxWidth: { read: '700px', shell: '1280px' },
      spacing: { 13: '3.25rem', sidebar: '264px', composer: '6.5rem' },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem', '3xl': '1.5rem' },

      boxShadow: {
        // Barely-there elevation; the palette does the work.
        soft: '0 1px 1.5px rgba(43, 39, 35, 0.04), 0 1px 3px rgba(43, 39, 35, 0.03)',
        card: '0 1px 2px rgba(43, 39, 35, 0.05), 0 12px 32px -16px rgba(43, 39, 35, 0.16)',
        lift: '0 2px 4px rgba(43, 39, 35, 0.06), 0 24px 48px -18px rgba(43, 39, 35, 0.22)',
        inset: 'inset 0 1px 0 rgba(255, 255, 255, 0.5)',
      },

      keyframes: {
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'scale-in': { '0%': { opacity: '0', transform: 'scale(0.97)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
        'pulse-soft': { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.35' } },
        blink: { '0%, 92%, 100%': { transform: 'scaleY(1)' }, '96%': { transform: 'scaleY(0.08)' } },
        float: { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-3px)' } },
        'blink-caret': { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0' } },
        wave: { '0%, 100%': { transform: 'scaleY(0.35)' }, '50%': { transform: 'scaleY(1)' } },
      },
      animation: {
        'fade-up': 'fade-up 0.32s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 0.24s ease-out both',
        'scale-in': 'scale-in 0.2s cubic-bezier(0.22, 1, 0.36, 1) both',
        'pulse-soft': 'pulse-soft 1.7s ease-in-out infinite',
        blink: 'blink 5.5s ease-in-out infinite',
        float: 'float 4s ease-in-out infinite',
        'blink-caret': 'blink-caret 1.05s step-end infinite',
        wave: 'wave 0.9s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
