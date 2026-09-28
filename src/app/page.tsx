import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MessageCircle, BookOpen, Boxes, Mic } from 'lucide-react'

export const dynamic = 'force-dynamic'

const FEATURES = [
  {
    icon: <MessageCircle className="h-6 w-6" />,
    title: 'Chat with BODHA',
    description: 'Ask anything you are learning — maths, physics, history, languages, coding. Step by step, at your pace.',
  },
  {
    icon: <BookOpen className="h-6 w-6" />,
    title: 'Read your books',
    description: 'Upload PDFs and read them in a calm, book-style reader. Ask BODHA about any passage.',
  },
  {
    icon: <Mic className="h-6 w-6" />,
    title: 'Talk by voice',
    description: 'Speak your questions, listen to answers read aloud. Learning without typing.',
  },
  {
    icon: <Boxes className="h-6 w-6" />,
    title: 'Run code live',
    description: 'Learn web programming with live examples you can edit and run in the sandbox.',
  },
]

export default async function Home() {
  const user = await getSessionUser()
  if (user) redirect('/chat')

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-3xl">
        {/* Hero */}
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-warm-lg">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 2c-3.5 3.6-5.5 7-5.5 10.2a5.5 5.5 0 0 0 11 0C17.5 9 15.5 5.6 12 2z" />
            </svg>
          </div>
          <h1 className="font-display text-5xl font-semibold tracking-tight text-foreground md:text-6xl">
            BODHA <span className="text-primary">AI</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl font-serif text-lg italic leading-relaxed text-muted-foreground">
            Your patient, warm-hearted AI tutor. *Bodha* (बोध) means "awakening" in Sanskrit —
            that moment when understanding clicks.
          </p>
        </div>

        {/* Features */}
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {FEATURES.map(f => (
            <Card key={f.title} className="transition-all hover:-translate-y-0.5 hover:border-primary/40">
              <CardHeader className="pb-3">
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  {f.icon}
                </div>
                <CardTitle className="text-base">{f.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm leading-relaxed">{f.description}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-12 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link href="/login">Sign in to start learning</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
            <Link href="/register">Create an account</Link>
          </Button>
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground/70">
          BODHA AI · created by <span className="font-medium text-muted-foreground">Srijan Singh and Parv Mishra</span>
        </p>
      </div>
    </main>
  )
}