import type { Metadata, Viewport } from 'next'
import { Inter, Source_Serif_4, Tiro_Devanagari_Hindi } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

/** Reading body — humanist serif, per spec (Source Serif 4). */
const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
  style: ['normal', 'italic'],
  weight: ['400', '500', '600'],
})

/** The बोध wordmark. Devanagari, self-hosted by next/font so it always renders. */
const devanagari = Tiro_Devanagari_Hindi({
  subsets: ['devanagari'],
  variable: '--font-devanagari',
  display: 'swap',
  weight: ['400'],
})

export const metadata: Metadata = {
  title: {
    default: 'BODHA AI · बोध — your patient AI tutor',
    template: '%s · BODHA AI',
  },
  description:
    'बोध — an educational AI tutor. Chat with a warm tutor, upload books and read them in a book-style reader, ask by voice, and learn to code in a live sandbox. Built by Srijan Singh and Parv Mishra.',
  applicationName: 'BODHA AI',
  authors: [{ name: 'Srijan Singh' }, { name: 'Parv Mishra' }],
  creator: 'Srijan Singh and Parv Mishra',
  keywords: ['AI tutor', 'education', 'study', 'BODHA', 'बोध'],
  openGraph: {
    title: 'BODHA AI · बोध',
    description: 'Your patient, warm-hearted AI tutor — built by Srijan Singh and Parv Mishra.',
    type: 'website',
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAF7F2' },
    { media: '(prefers-color-scheme: dark)', color: '#181512' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
}

/** Applies the saved theme before first paint (no flash). Paper is the default. */
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
    <html
      lang="en"
      className={`${inter.variable} ${sourceSerif.variable} ${devanagari.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  )
}
