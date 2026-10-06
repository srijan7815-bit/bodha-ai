import { BookMarked, ExternalLink, Quote } from 'lucide-react'
import { IksSearch } from '@/components/IksSearch'
import { PageHeader } from '@/components/Page'
import { corpusStats, listWorks } from '@/lib/iks'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Indian Knowledge Systems — BODHA' }

/**
 * The shelf itself: what BODHA reads before it answers.
 *
 * Everything here is a public-domain English translation of a primary Indian
 * work, listed with its translator, edition and a link to the full text, so the
 * collection can be inspected rather than taken on trust.
 */
export default async function IksPage() {
  const [works, stats] = await Promise.all([listWorks(), corpusStats()])

  // Grouped by the domain in the metadata, in the order the works were added.
  const domains: Array<{ name: string; works: typeof works }> = []
  for (const work of works) {
    const group = domains.find(entry => entry.name === work.domain)
    if (group) group.works.push(work)
    else domains.push({ name: work.domain, works: [work] })
  }

  return (
    <div className="scrollbar-quiet h-full overflow-y-auto">
    <div className="mx-auto w-full max-w-read px-4 pb-24 pt-6 sm:px-6 sm:pt-8 md:px-8">
      <PageHeader
        eyebrow="Indian Knowledge Systems"
        icon={BookMarked}
        title="The shelf BODHA reads"
        description={
          <>
            Before answering, BODHA searches {stats.works} primary Indian works — {stats.passages.toLocaleString('en-IN')}{' '}
            passages, about {Math.round(stats.words / 1000).toLocaleString('en-IN')} thousand words — and quotes what it
            finds, with the work, the translator and the passage given for every citation. These are public-domain
            English translations, not summaries: what you read here is the translator&apos;s own text.
          </>
        }
      />

      <section className="rounded-2xl border border-border/70 bg-surface/60 p-4 sm:p-5">
        <h2 className="mb-3 text-ui font-semibold tracking-tight text-foreground">Search it yourself</h2>
        <IksSearch />
      </section>

      <section className="mt-10">
        <h2 className="mb-4 flex items-center gap-2 text-ui font-semibold tracking-tight text-foreground">
          <Quote className="h-4 w-4 text-primary" strokeWidth={1.9} />
          The collection
        </h2>
        <div className="space-y-8">
          {domains.map(domain => (
            <div key={domain.name}>
              <p className="mb-2.5 text-ui-sm font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
                {domain.name}
              </p>
              <ul className="space-y-2">
                {domain.works.map(work => (
                  <li key={work.id} className="rounded-xl border border-border/70 bg-surface/50 p-3.5 sm:p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="text-ui font-medium text-foreground">
                        {work.title}
                        {work.sanskrit && (
                          <span className="ml-2 font-serif text-ui font-normal text-muted-foreground">{work.sanskrit}</span>
                        )}
                      </p>
                      <span className="text-ui-sm text-muted-foreground">{work.extent}</span>
                    </div>
                    <p className="mt-1 text-ui-sm leading-relaxed text-muted-foreground">
                      {work.note}
                    </p>
                    <p className="mt-1.5 text-ui-sm text-muted-foreground/90">
                      {work.author} · translated by {work.translator} · {work.year} ·{' '}
                      {work.passages.toLocaleString('en-IN')} passages
                    </p>
                    <a
                      href={work.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-2 inline-flex items-center gap-1.5 text-ui-sm font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {work.edition}
                      <ExternalLink className="h-3 w-3" strokeWidth={1.9} />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <p className="mt-10 font-serif text-reading-sm italic leading-relaxed text-muted-foreground/80">
        BODHA quotes these texts; it does not speak for them. Where a passage is contested, the reading it gives is one
        reading among several, and the citation is there so you can judge for yourself.
      </p>
    </div>
    </div>
  )
}
