import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, BookOpen, Boxes, Mic, MessageSquare } from 'lucide-react'
import { getSessionUser } from '@/lib/auth'
import { BodhaLogo, BodhaMark, BodhaWordmark } from '@/components/Brand'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'BODHA AI · बोध — your patient AI tutor',
  description:
    'बोध is an educational AI tutor: talk through any subject, upload your books and read them in a book-style reader, ask by voice, and learn to code in a live sandbox.',
}

const PILLARS = [
  {
    icon: MessageSquare,
    title: 'A tutor that goes step by step',
    body: 'Ask anything you are studying. BODHA explains, checks your understanding, and never makes you feel behind.',
  },
  {
    icon: BookOpen,
    title: 'Your own books, beautifully read',
    body: 'Upload a PDF and read it in a calm, page-turn reader — then ask about any paragraph on the page.',
  },
  {
    icon: Mic,
    title: 'Talk instead of typing',
    body: 'Dictate your question, and have answers read aloud, with a face that listens while you speak.',
  },
  {
    icon: Boxes,
    title: 'Learn by running code',
    body: 'Write HTML, CSS and JavaScript, run it in a real sandbox, and see the result in a live preview.',
  },
]

export default async function LandingPage() {
  const user = await getSessionUser()
  if (user) redirect('/chat')

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-background">
      {/* Warm light in the corners — the only decoration on the page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 -top-40 h-[420px] w-[420px] rounded-full bg-primary/[0.07] blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-52 -right-32 h-[460px] w-[460px] rounded-full bg-primary/[0.05] blur-3xl"
      />

      <header className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
        <BodhaLogo size="sm" />
        <Link
          href="/login"
          className="rounded-full border border-border/80 bg-surface px-4 py-2 text-ui font-medium text-foreground shadow-soft transition-colors hover:border-primary/40"
        >
          Sign in
        </Link>
      </header>

      <section className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-5 pb-16 pt-10 text-center sm:px-8">
        <span className="mb-7 inline-flex items-center gap-2 rounded-full border border-border/70 bg-surface/80 px-3.5 py-1.5 text-ui-sm text-muted-foreground shadow-soft">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          Built for students, by Srijan Singh &amp; Parv Mishra
        </span>

        <div className="mb-6">
          <BodhaWordmark size="xl" />
        </div>

        <h1 className="max-w-[22ch] text-balance font-display text-[1.9rem] font-semibold leading-[1.15] tracking-[-0.02em] text-foreground sm:text-[2.6rem]">
          Understanding, one patient conversation at a time.
        </h1>

        <p className="mt-5 max-w-[54ch] text-pretty font-serif text-reading text-muted-foreground sm:text-[17.5px]">
          <span className="font-deva text-foreground">बोध</span> means <em>awakening</em> — that moment when
          something clicks. BODHA is a tutor that waits for it: it explains at your pace, reads your own books with
          you, and answers out loud when you would rather talk.
        </p>

        <div className="mt-9 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
          <Link
            href="/register"
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-7 text-[15px] font-medium text-primary-foreground shadow-lift transition-transform hover:scale-[1.015] sm:w-auto"
          >
            Start learning free
            <ArrowRight className="h-4 w-4" strokeWidth={1.9} />
          </Link>
          <Link
            href="/login"
            className="inline-flex h-12 w-full items-center justify-center rounded-full border border-border/80 bg-surface px-7 text-[15px] font-medium text-foreground transition-colors hover:border-primary/40 sm:w-auto"
          >
            I already have an account
          </Link>
        </div>

        <div className="mt-16 grid w-full gap-3 text-left sm:grid-cols-2">
          {PILLARS.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-2xl border border-border/70 bg-surface/70 p-4 shadow-soft backdrop-blur-sm transition-colors hover:border-primary/30"
            >
              <span className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} />
              </span>
              <h2 className="text-ui font-semibold text-foreground">{title}</h2>
              <p className="mt-1.5 font-serif text-reading-sm text-muted-foreground text-pretty">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="relative z-10 border-t border-border/60 px-5 py-6 sm:px-8">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-3 text-ui-sm text-muted-foreground sm:flex-row">
          <span className="inline-flex items-center gap-2">
            <BodhaMark size={20} />
            BODHA AI — बोध
          </span>
          <span>Created by Srijan Singh and Parv Mishra · educational use</span>
        </div>
      </footer>
    </main>
  )
}
