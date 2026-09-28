import type { Metadata, Viewport } from 'next'
import { Fraunces, Inter, Source_Serif_4 } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
  style: ['normal', 'italic'],
  weight: ['400', '500', '600', '700'],
})

const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
  style: ['normal', 'italic'],
  weight: ['400', '600'],
})

export const metadata: Metadata = {
  title: {
    default: 'BODHA AI — your warm AI tutor',
    template: '%s · BODHA AI',
  },
  description:
    'BODHA is a patient, warm educational AI tutor. Chat, upload books and read them in a calm book-style reader, talk by voice, and learn to code in a live sandbox. Created by Srijan Singh and Parv Mishra.',
  applicationName: 'BODHA AI',
  authors: [{ name: 'Srijan Singh' }, { name: 'Parv Mishra' }],
  creator: 'Srijan Singh and Parv Mishra',
}

export const viewport: Viewport = {
  themeColor: '#FAF7F2',
  width: 'device-width',
  initialScale: 1,
}

/**
 * Applies the saved theme before first paint so there is no flash.
 * Defaults to "paper" (warm light); students can switch to warm night.
 */
const themeBoot = `
(function () {
  try {
    var saved = localStorage.getItem('bodha:theme');
    if (saved === 'dark' || (saved === null && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable} ${sourceSerif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body className="min-h-screen">{children}</body>
    </html>
  )
}