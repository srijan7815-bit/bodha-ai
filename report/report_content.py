#!/usr/bin/env python3
"""
BODHA — the words.

Section by section, in the order a reader needs them: the problem, what BODHA is,
how it works, what it does, the shelf it reads from, the voice, the computer, the
sub-theme, the responsibilities, the technology, the apps, the evidence, the
limits, and the team. Appendix A carries the project document as submitted.

The prose follows the submitted document where it exists, and reports what has
actually been built and measured since — including the places where the two
differ, which are stated rather than smoothed over.
"""

from reportlab.platypus import (Image, KeepTogether, NextPageTemplate, PageBreak, Paragraph,
                                Spacer, Table, TableStyle)
from reportlab.lib import colors

from reportlab.lib.utils import ImageReader


def build(S, K, marks=None, toc_numbers=False):
    """Returns the story (list of flowables). Called twice: once to learn page
    numbers, once to print them."""
    marks = {} if marks is None else marks
    st = []

    def mark(key):
        st.append(K.Mark(key, marks))

    def toc_line(num, title, key):
        page = marks.get(key, '')
        page = str(page) if (toc_numbers and page) else '—'
        st.append(Table([[Paragraph(num, S['tocnum']), Paragraph(title, S['toc']),
                          Paragraph(f'<para alignment="right">{page}</para>', S['toc']) if False else
                          Paragraph(page, K.right_style(S))]],
                        colWidths=[26, 380, 48],
                        style=TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'),
                                          ('LEFTPADDING', (0, 0), (-1, -1), 0),
                                          ('RIGHTPADDING', (0, 0), (-1, -1), 0),
                                          ('TOPPADDING', (0, 0), (-1, -1), 1),
                                          ('BOTTOMPADDING', (0, 0), (-1, -1), 1),
                                          ('LINEBELOW', (0, 0), (-1, -1), 0.25, K.RULE)])))

    def h(number, title, key=None, rule=True):
        if key:
            mark(key)
        st.extend(K.section_title(number, title, S, rule=rule))

    # ════════════════════════════════════════════════════════════════════════
    # Cover
    # ════════════════════════════════════════════════════════════════════════
    st.append(Spacer(1, 62))
    st.append(Image(K.asset('wordmark.png'), width=168, height=72, hAlign='LEFT'))
    st.append(Spacer(1, 14))
    st.append(Paragraph('BODHA', S['cover_title']))
    st.append(Paragraph('An Evidence-Grounded AI Research Copilot for Student Inquiry '
                        'in Indian Knowledge Systems', S['cover_sub']))
    st.append(Spacer(1, 26))
    st.append(K.Rule(width=K.content_width(), thickness=1.4, colour=K.INK,
                     space_before=0, space_after=16))

    rows = [
        ('Project title', 'BODHA: An Evidence-Grounded AI Research Copilot for Student Inquiry in Indian Knowledge Systems'),
        ('Sub-theme', 'Application of Indian Knowledge Systems for Sustainability'),
        ('Programme', 'NCSC 2026-27 · Registration ID NCSC-2026-27-272758'),
        ('Team', 'Srijan Singh (Group Leader), Parv Mishra'),
        ('Guide', 'Mrs. Veenu Ghai, Teacher — Computer Science'),
        ('School', 'PM SHRI Kendriya Vidyalaya Kanpur Cantt, Kanpur, Uttar Pradesh (KVS Regional Office Lucknow)'),
        ('GitHub', 'github.com/srijan7815-bit · the live app: bodha-ai-three.vercel.app'),
    ]
    meta = [[Paragraph(a.upper(), S['meta_label']), Paragraph(b, S['meta_value'])] for a, b in rows]
    st.append(Table(meta, colWidths=[104, K.content_width() - 104],
                    style=TableStyle([
                        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                        ('LEFTPADDING', (0, 0), (-1, -1), 0),
                        ('TOPPADDING', (0, 0), (-1, -1), 5),
                        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
                        ('LINEBELOW', (0, 0), (-1, -2), 0.3, K.RULE),
                    ])))
    st.append(Spacer(1, 30))
    st.append(K.panel([
        Paragraph('This document is written in black and white, deliberately. It is meant to be '
                  'photocopied, pinned on a board and marked with a pencil, and it is set in the '
                  'same typeface the app uses.', S['small']),
    ], K.content_width()))
    st.append(Spacer(1, 20))
    st.append(Paragraph('Prepared by Srijan Singh and Parv Mishra · October 2026', S['small']))

    st.append(NextPageTemplate('plain'))
    st.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════════
    # Contents
    # ════════════════════════════════════════════════════════════════════════
    h('', 'Contents', rule=False)
    st.append(K.Rule(thickness=0.9, colour=K.INK, space_before=0, space_after=14))
    for num, title, key in [
        ('', 'Abstract', 'abstract'),
        ('1', 'The problem', 's1'), ('2', 'What BODHA is', 's2'),
        ('3', 'How it works', 's3'), ('4', 'Key features', 's4'),
        ('5', 'The Indian Knowledge Systems library', 's5'),
        ('6', 'Talking to BODHA: dictation, read-aloud and Live Mode', 's6'),
        ('7', 'BODHA\u2019s computer', 's7'),
        ('8', 'Relevance to the sub-theme', 's8'),
        ('9', 'Responsible design', 's9'),
        ('10', 'Technology', 's10'),
        ('11', 'The apps: Android, Windows, and the browser', 's11'),
        ('12', 'What we tested, and what it showed', 's12'),
        ('13', 'Limits, and what comes next', 's13'),
        ('14', 'Team, acknowledgement and references', 's14'),
        ('', 'Appendix A — the project document as submitted', 'appA'),
    ]:
        toc_line(num, title, key)

    st.append(Spacer(1, 22))
    st.append(Paragraph('How to read this document', S['h2']))
    st.append(Paragraph(
        'Sections 1 to 4, 8, 9 and 10 restate and expand the project document that was submitted '
        'for NCSC 2026-27: the problem, the idea, the four-step method, the feature list, the '
        'sub-theme, the responsibilities and the technology. Everything else is what has been '
        'built since that document was written and can be checked today — the Indian Knowledge '
        'Systems library that BODHA reads from, the voice, BODHA\u2019s computer, the Android app, '
        'the Windows app, and the tests that back the claims in Section 12. Where the deployed '
        'system differs from the submitted document, the difference is stated in a note rather '
        'than hidden, because a project about evidence should hold itself to its own standard.',
        S['body']))

    st.append(Spacer(1, 16))
    st.append(Paragraph('Figures', S['h2']))
    for num, title, key in [
        ('1', 'The four steps of one BODHA answer', 'fig1'),
        ('2', 'What an evidence-grounded answer looks like', 'fig2'),
        ('3', 'The shelf, by work', 'fig3'),
        ('4', 'The reasoning chain, and what happens when a link fails', 'fig4'),
        ('5', 'Where the work happens', 'fig5'),
    ]:
        toc_line('', f'Figure {num} — {title}', key)
    st.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════════
    # Abstract
    # ════════════════════════════════════════════════════════════════════════
    h('', 'Abstract', 'abstract', rule=False)
    st.append(K.Rule(thickness=0.9, colour=K.INK, space_before=0, space_after=14))
    st.append(Paragraph(
        'Students who want to investigate Indian Knowledge Systems meet two obstacles at once. '
        'The material is scattered across textbooks, journals, websites and scanned manuscripts, '
        'often in formats a search engine cannot read. And the general-purpose chatbots that could '
        'help are fluent without being accountable: they answer without showing where a claim came '
        'from, which leaves a learner unable to tell documented knowledge from invention. In a '
        'subject where respect for the source is part of the subject, an answer without evidence is '
        'of little use.', S['lead']))
    st.append(Paragraph(
        'BODHA is a research copilot built for exactly that gap. It answers a student\u2019s question '
        'from evidence the student can inspect: a curated library of Indian Knowledge Systems texts, '
        'the documents the student uploads, the live web, and — when a task needs doing rather than '
        'knowing — an isolated computer of its own that can write files, build a spreadsheet or run '
        'code without touching the student\u2019s device. Every key statement in an answer points back '
        'to the passage, page or page-rank it came from, so any line can be opened and read.', S['body']))
    st.append(Paragraph(
        'It teaches inquiry rather than replacing it: it explains its reasoning, asks questions back, '
        'and suggests where to look next. And it is built for the equipment students actually have — '
        'a phone on a slow connection, a school computer, or a browser tab. The web app, the Android '
        'app and the Windows app are one product: the server does the heavy work, and each device '
        'does only what a device must.', S['body']))

    st.append(Spacer(1, 6))
    facts = [
        ('What it is', 'A web, Android and Windows research copilot that answers from inspectable evidence.'),
        ('Who it is for', 'School and early-college students investigating Indian Knowledge Systems, and their teachers.'),
        ('Sub-theme', 'Application of Indian Knowledge Systems for Sustainability (NCSC 2026-27).'),
        ('The shelf', '15 open-access works, 6,525 indexed passages, cited as [1], [2], [3] in every answer.'),
        ('The method', 'Ask and upload → retrieve evidence → reason and check → answer with sources.'),
        ('Where the work happens', 'Server: models, retrieval, OCR, sandbox, document building. Device: the window, the microphone, the file picker, Downloads.'),
        ('Built with', 'Next.js 15 and TypeScript; NVIDIA NIM models; Fish Audio voice; E2B sandbox; Tavily search; Firebase storage. Live at bodha-ai-three.vercel.app.'),
    ]
    st.append(Paragraph('BODHA at a glance', S['h2']))
    st.append(K.table([[Paragraph(f'<b>{a}</b>', S['cell']), b] for a, b in facts],
                      [122, K.content_width() - 122], S, header=False, zebra=True))
    st.append(Spacer(1, 4))
    st.append(Paragraph('The facts above are the ones Section 12 measures: the shelf size, the model '
                        'chain, the apps and their checksums are all verifiable on the live system.',
                        S['caption']))
    # ════════════════════════════════════════════════════════════════════════
    # 1 The problem
    # ════════════════════════════════════════════════════════════════════════
    h('1', 'The problem', 's1')
    st.append(Paragraph(
        'Students who want to investigate Indian Knowledge Systems (IKS) meet two obstacles. First, '
        'the material is scattered across textbooks, journals, websites and scanned manuscripts, '
        'often in formats a search engine cannot read. Second, general-purpose chatbots answer '
        'fluently but without showing where a claim comes from, so a learner cannot tell documented '
        'knowledge from invention. On a subject where accuracy and respect for the source tradition '
        'matter, an answer without evidence is of little use to a student.', S['lead']))
    st.append(Paragraph(
        'Both obstacles are familiar in the classroom. A student who wants to know how a johad holds '
        'the monsoon, or what the Arthashastra says about irrigation, or how Sushruta describes a '
        'plant, is doing real research with the tools of a school library: a textbook with no index '
        'entry for the question, a website of uncertain provenance, and a scanned volume in a '
        'language of scholarship that predates their own reading. The question is good. The path to '
        'an answer is not.', S['body']))
    st.append(Paragraph('Three things are missing, and each is a design requirement', S['h2']))
    st.append(K.bullets([
        '<b>A readable shelf.</b> The primary material exists in the open — on Project Gutenberg, on '
        'archive.org, in museum and university scans — but it is not indexed for a school question, '
        'and it is not searchable by someone who does not already know what to search for.',
        '<b>A path from question to passage.</b> A student needs the specific paragraph, not the '
        'table of contents of a tradition. Retrieval has to be strong enough to find three relevant '
        'passages among thousands, and honest enough to say when it found none.',
        '<b>A habit of citing.</b> The tool has to show its work by default — not as an option a '
        'student has to switch on, but as the shape of the answer itself.',
    ], S))
    st.append(Spacer(1, 2))
    st.append(K.panel([Paragraph(
        'A learner cannot tell documented knowledge from invention unless the tool shows where each '
        'claim comes from. That sentence is the whole reason BODHA exists, and the measure of '
        'whether it works.', S['quote'])], K.content_width()))

    # ════════════════════════════════════════════════════════════════════════
    # 2 What BODHA is
    # ════════════════════════════════════════════════════════════════════════
    h('2', 'What BODHA is', 's2')
    st.append(Paragraph(
        'BODHA is a web-based research copilot that answers a student\u2019s question from evidence '
        'the student can inspect. Rather than replying from memory alone, it retrieves material '
        'from the web and from the student\u2019s own uploaded documents, reasons over it, and points '
        'to the source behind each key statement so it can be opened and verified. BODHA is built '
        'to teach inquiry, not replace it: it explains, asks questions back, and suggests where to '
        'look next.', S['lead']))
    st.append(Paragraph('The name', S['h2']))
    st.append(Paragraph(
        'बोध — bodha — means awakening, comprehension, the moment a thing is understood. The app '
        'carries the word as its mark, set in a Devanagari serif, on paper-coloured ground: a mark '
        'that says what the product is for rather than what it is made of.', S['body']))
    st.append(Paragraph('What it is not', S['h2']))
    st.append(K.bullets([
        '<b>Not a general assistant.</b> BODHA is scoped to study and to Indian Knowledge Systems. '
        'An off-topic request gets a short reply and a nudge back to the work.',
        '<b>Not an oracle.</b> It is designed to say when the evidence is thin or when two sources '
        'disagree, instead of smoothing the gap over with confident prose.',
        '<b>Not a replacement for reading.</b> The citations are the point. BODHA is meant to end '
        'with the student opening the source, not with the student closing the tab.',
        '<b>Not a black box.</b> The model chain, the health of every provider and the state of the '
        'shelf are visible in the app, and the retrieval step can be queried on its own.',
    ], S))
    st.append(Paragraph(
        'In the student\u2019s words: you ask, BODHA looks in four places — its shelf of IKS texts, '
        'your documents, the live web and its own computer — and it shows you what it found before it '
        'tells you what to think. If it is unsure, it says so, and the next question is asked with '
        'better evidence in hand.', S['body']))

    # ════════════════════════════════════════════════════════════════════════
    # 3 How it works
    # ════════════════════════════════════════════════════════════════════════
    h('3', 'How it works', 's3')
    mark('fig1')
    st.append(K.figure(K.diagram_pipeline(K.content_width()),
                       'Figure 1 — The four steps of one BODHA answer, from the student\u2019s question '
                       'to a cited reply.', S))
    st.append(Paragraph(
        'The reasoning model can call tools as it works: web search for current material, OCR for '
        'scanned pages, and an isolated code sandbox for calculations, charts and small simulations. '
        'The student only sees a clean chat and a reading panel.', S['body']))

    st.append(Paragraph('Step 1 — Ask and upload', S['h2']))
    st.append(Paragraph(
        'A question can be typed, dictated or spoken live, and a document can be attached: a chapter, '
        'a PDF, an article, or a photograph of a printed page. Uploads are sent in small parts and '
        'streamed, so a large book on a slow connection does not fail halfway, and scanned pages are '
        'read with OCR so their text becomes searchable, quotable and answerable.', S['body']))

    st.append(Paragraph('Step 2 — Retrieve evidence', S['h2']))
    st.append(Paragraph(
        'Four sources are searched, in an order that favours the ones most likely to be respected in '
        'a school project: the Knowledge Shelf first — BM25 ranking over 6,525 passages, and the '
        'passage that answers the question is the passage that gets cited — then the student\u2019s '
        'own uploaded documents, then the live web for current research and figures a text from 1914 '
        'cannot supply, and finally BODHA\u2019s computer, when the question needs a thing made rather '
        'than a thing known.', S['body']))

    st.append(Paragraph('Step 3 — Reason and check', S['h2']))
    st.append(Paragraph(
        'A large reasoning model weighs the retrieved evidence, in a chain that degrades gracefully: '
        'if the first model is slow, rate-limited or down, the next answers, and a watchdog records '
        'what happened. When a question involves arithmetic or a simulation, the model writes code and '
        'runs it in an isolated cloud sandbox instead of doing sums in its head — a sandbox that never '
        'touches the student\u2019s device.', S['body']))

    st.append(Paragraph('Step 4 — Answer with sources', S['h2']))
    st.append(Paragraph(
        'The reply cites where each key statement came from, so its evidence can be checked. A '
        'citation is a link, not a decoration: it opens the work, the passage or the page. If the '
        'shelf returned nothing useful, BODHA says so, and falls back to the web — labelled as the web.',
        S['body']))
    mark('fig2')
    st.append(K.figure(K.diagram_citation(K.content_width()),
                       'Figure 2 — What an evidence-grounded answer looks like: the claim carries a '
                       'marker, and every marker resolves to a source the student can open.', S))

    # ════════════════════════════════════════════════════════════════════════
    # 4 Key features
    # ════════════════════════════════════════════════════════════════════════
    h('4', 'Key features', 's4')
    st.append(Paragraph(
        'The seven features below are the ones described in the submitted project document, with '
        'what each one actually does in the deployed app.', S['body']))
    st.append(K.table([
        ['Feature', 'What it does', 'Scope'],
        ['Evidence-grounded answers',
         'Responses draw on retrieved sources and point back to them, so students can check claims instead of trusting them.',
         'Core'],
        ['Documents with OCR',
         'Upload PDFs or photographs of pages; scanned text is extracted so it can be searched, quoted and questioned.',
         'Core'],
        ['Web research',
         'Live search brings in current material beyond what the model was trained on — and marks it as web evidence.',
         'Core'],
        ['Code sandbox and preview',
         'Code the AI writes runs in an isolated cloud sandbox, and web projects it builds can be previewed in the page. Useful for charting data or building small demos.',
         'Core'],
        ['Cloud chat history',
         'Sign in once and every conversation follows the student across devices. Unsent drafts are recovered after an accidental tab close.',
         'Core'],
        ['Book-style PDF reader',
         'Renders a PDF as a book with a page-turn animation and sound, to make long reading calmer.',
         'Extended'],
        ['Voice tutoring',
         'Read-aloud and voice input, growing into a live mode with an animated tutor that speaks and reacts.',
         'Extended'],
    ], [104, K.content_width() - 104 - 46, 46], S))

    st.append(Paragraph('What has been added since that document was written', S['h2']))
    st.append(K.table([
        ['Added', 'What it does', 'Where'],
        ['The Knowledge Shelf',
         'A curated library of 15 open-access IKS works — 6,525 passages — retrieved first and cited by passage. Section 5.',
         'Shelf'],
        ['BODHA\u2019s computer',
         'A private workspace for the agent: it writes, reads and downloads files, reads the web and GitHub, and produces PDF, Word and Excel documents. Section 7.',
         'Computer'],
        ['A watchdog on the model chain',
         'The chain checks itself, steps to the next model when one fails, and reports its health in the app instead of failing silently.',
         'Core'],
        ['Endpoints of your own',
         'A student or teacher can add an OpenAI-compatible endpoint and name each model in it; the chat then offers a model switch. Useful when a school has its own access.',
         'Settings'],
        ['Android and Windows apps',
         'The same product, on a phone and on a school PC, with the same split of work. Section 11.',
         'Apps'],
    ], [104, K.content_width() - 104 - 46, 46], S))
    st.append(Paragraph('The two extended features, in more detail', S['h2']))
    st.append(Paragraph(
        '<b>The book-style reader.</b> A long PDF is re-set as a book — two facing pages where the '
        'screen is wide, one with a page-turn animation where it is not, and a soft page-turn sound '
        'that can be switched off. The text stays selectable and searchable; the book is a way of '
        'reading, not a picture of one.', S['body']))
    st.append(Paragraph(
        '<b>Voice tutoring, from three directions.</b> Dictation turns speech into a question; '
        'read-aloud turns a finished answer into audio in a voice the student chooses, Hindi for '
        'Devanagari; Live Mode turns the whole thing into a spoken conversation with a reacting orb. '
        'All three are in Section 6, latency included.', S['body']))
    # ════════════════════════════════════════════════════════════════════════
    # 5 The shelf
    # ════════════════════════════════════════════════════════════════════════
    h('5', 'The Indian Knowledge Systems library', 's5')
    st.append(Paragraph(
        'The most important thing BODHA was given for this project is a shelf of its own. Instead of '
        'searching the open web and hoping, BODHA first searches a library of primary and scholarly '
        'works in the Indian Knowledge Systems, gathered from open, citable sources — and every answer '
        'that comes from the shelf carries the name of the work and the passage it came from.',
        S['lead']))
    st.append(K.table([
        ['Work', 'Text', 'Passages', 'Source'],
        ['Arthashastra', 'Kautilya, on statecraft, water works and duty', '632', 'archive.org scan'],
        ['Rigveda', 'Hymns, in English translation', '632', 'Digital Library of India scan'],
        ['Sushruta Samhita', 'Surgery and medicine, English translation', '632', 'archive.org scan'],
        ['Ramayana', 'Valmiki, English translation', '632', 'Project Gutenberg'],
        ['Mahabharata I', 'The first book, English translation', '632', 'Project Gutenberg'],
        ['Vedanta', 'The Vedanta Sutras, with commentary', '525', 'Project Gutenberg'],
        ['Laws of Manu', 'Manu Smriti, law and obligation', '505', 'archive.org scan'],
        ['Colebrooke, Algebra', 'Hindu algebra and arithmetic, with the Sanskrit terms', '499', 'archive.org scan'],
        ['Surya Siddhanta', 'Classical astronomy and time reckoning', '465', 'JSTOR/archive.org scan'],
        ['Sarva-Darshana Samgraha', 'A survey of Indian philosophical systems', '411', 'archive.org scan'],
        ['Hitopadesha', 'Fables and conduct, in translation', '403', 'Project Gutenberg'],
        ['Thirukkural', 'Couplets on ethics and conduct, in translation', '261', 'archive.org scan'],
        ['Yoga Sutras', 'Patanjali, with commentary', '144', 'Project Gutenberg'],
        ['Bhagavad Gita', 'Translation and notes', '76', 'Project Gutenberg'],
        ['The Upanishads', 'A selection, in translation', '76', 'Project Gutenberg'],
        ['<b>15 works</b>', '<b>Corpus digest</b> 80e2cda0237b', '<b>6,525</b>', '<b>all open access</b>'],
    ], [104, K.content_width() - 104 - 52 - 80, 52, 80], S))
    mark('fig3')
    st.append(K.figure(K.diagram_works(K.content_width()),
                       'Figure 3 — The shelf, by work. The bar is the number of indexed passages; '
                       'the four longest works were capped at 632 so that no single text dominates '
                       'a search.', S))
    st.append(Paragraph('How a question finds a passage', S['h2']))
    st.append(Paragraph(
        'Retrieval is BM25 — chosen because it is fast, explainable, and honest about what it found. '
        'Each passage is indexed with its work, book and chapter; a question is scored against every '
        'passage, and the top passages reach the model with their identifiers attached. That is why a '
        'citation can be made at all: the model answers with the passage in front of it.', S['body']))
    st.append(K.bullets([
        '<b>The Knowledge Shelf page</b> in the app lets a student browse the fifteen works, read a '
        'work\u2019s description, and search the corpus directly, without asking a question first; the '
        '<b>search API</b> (<font face="Mono" size="8.2">GET /api/iks/search?q=…</font>) returns ranked '
        'passages with their work and section, and is what the answer path calls.',
        '<b>The glossary</b> keeps Sanskrit and English terms consistent across works — dharma, artha, '
        'varna, yuga, johad — so a question asked in English finds a passage written in translation, '
        'and the repositories list records where a shelf source lives, including open Indian '
        'repositories such as TKDL.',
    ], S))
    st.append(Spacer(1, 2))
    st.append(K.panel([Paragraph(
        'The shelf is deliberately small and legible. Fifteen works that a student can be pointed to, '
        'each with a source they can open, is worth more to a school project than ten thousand '
        'documents nobody can name.', S['quote'])], K.content_width()))
    st.append(Spacer(1, 8))

    # ════════════════════════════════════════════════════════════════════════
    # 6 Voice
    # ════════════════════════════════════════════════════════════════════════
    h('6', 'Talking to BODHA: dictation, read-aloud and Live Mode', 's6')
    st.append(Paragraph(
        'Voice is three separate things in BODHA, and they are kept separate on purpose, because '
        'each one fails in a different way and each one is useful in a different room of the school.',
        S['lead']))
    st.append(K.table([
        ['', 'Dictation', 'Read-aloud', 'Live Mode'],
        ['What it is', 'Speak the question instead of typing it', 'Hear a finished answer',
         'A spoken conversation, with a reacting orb on screen'],
        ['When to use it', 'Long questions, Hindi questions, one-handed use', 'Long answers, reading '
         'difficulty, revising while walking', 'Practising an explanation out loud, or asking follow-ups quickly'],
        ['Recognition', 'Whisper large v3 (turbo)', '—', 'A low-latency recogniser'],
        ['Voice', '—', 'Fish Audio, a chosen voice, Hindi voice for Devanagari',
         'A quick low-latency voice, with the full chain behind it'],
        ['Latency', 'One to two seconds after you stop', 'First words in about four seconds',
         'About a second per turn on a good connection'],
        ['Where it runs', 'Server', 'Server, streamed', 'Server, streamed'],
    ], [58, (K.content_width() - 58) / 3, (K.content_width() - 58) / 3, (K.content_width() - 58) / 3], S))

    st.append(Paragraph('Dictation', S['h2']))
    st.append(Paragraph(
        'Dictation uses Whisper large v3, the turbo variant, from a provider chosen for reliability '
        'rather than novelty. The phone\u2019s microphone is asked for at the moment the button is '
        'pressed, never at launch; the recording is transcribed and discarded. Hindi and English both '
        'work — a student who thinks in Hindi can dictate the question in the language they think in.',
        S['body']))
    st.append(Paragraph('Read-aloud', S['h2']))
    st.append(Paragraph(
        'Read-aloud uses Fish Audio, in the voice a student picks from a preview list — including a '
        'Hindi voice chosen automatically when the answer is in Devanagari. Answers are spoken in '
        'pieces rather than one long file, so the first words arrive in about four seconds and the '
        'reading can be stopped at any point. The limit is stated in the app: speech costs time and '
        'money, so pieces are small, retried, and reported honestly when a provider refuses.',
        S['body']))
    st.append(Paragraph('Live Mode', S['h2']))
    st.append(Paragraph(
        'Live Mode is the one that feels like a conversation: the student speaks, BODHA answers out '
        'loud, and an orb on screen moves with the voice — listening, thinking, speaking. It is built '
        'on a low-latency voice path, with the full reasoning chain behind it, and it is honest about '
        'what it is optimised for: quick turns. When a question deserves slow thinking, Live Mode '
        'hands it to the same BODHA as the chat does, and the answer arrives in the conversation as '
        'text and speech together.', S['body']))
    st.append(K.panel([Paragraph(
        'Every voice feature degrades in a stated way. If a provider is down, the app says which one '
        'and offers the alternative — typing, or reading — instead of a spinner that never ends. '
        'The audio itself is never routed through the microphone path or the other way round; the '
        'microphone is open only while it is being used, and the app says so when it is.', S['small'])],
        K.content_width()))
    # ════════════════════════════════════════════════════════════════════════
    # 7 BODHA's computer
    # ════════════════════════════════════════════════════════════════════════
    h('7', 'BODHA\u2019s computer', 's7')
    st.append(Paragraph(
        'Some questions are not answered by reading; they are answered by making something. BODHA\u2019s '
        'computer is an agent with a private workspace for exactly those questions: a weekly timetable '
        'as a spreadsheet, a one-page handout on Aryabhata as a document, a chart from data the student '
        'supplies, a small web page that demonstrates an idea.', S['lead']))
    st.append(Paragraph('What it can do', S['h2']))
    st.append(K.bullets([
        '<b>Write, read and manage files</b> in a workspace created for that one task and thrown away '
        'afterwards. Nothing of one student\u2019s task is visible to another\u2019s.',
        '<b>Read the web and GitHub</b> — a page, a repository, a raw file — so it can summarise a '
        'source or gather current figures before writing.',
        '<b>Download a public file</b> (up to 5 MB) into the workspace and work on it locally.',
        '<b>Produce PDF, Word and Excel documents</b>, built on the server and sent to the student '
        'finished. On a phone the file lands in Downloads; on a PC, in the Downloads folder; in a '
        'browser, wherever the browser puts downloads.',
        '<b>Keep a record of its steps.</b> The page shows each step as it happens — what it is '
        'making, what it read, what it wrote — so the student can see how the result was reached.',
    ], S))
    st.append(Paragraph('What keeps it bounded', S['h2']))
    st.append(K.table([
        ['Bound', 'Value'],
        ['How long one task may run', 'Two minutes, then it reports what it has'],
        ['How many tasks an account may ask for', 'Eight in any ten minutes'],
        ['What it may download', 'Public files, up to 5 MB, into its own workspace only'],
        ['Where its files live', 'A per-task workspace on the server; deleted after the task'],
        ['What it can reach on the student\u2019s device', 'Nothing. It has no access at all'],
    ], [220, K.content_width() - 220], S, header=True))
    st.append(Spacer(1, 4))
    st.append(Paragraph(
        'A worked example, from the app\u2019s own suggestions: <i>“Read github.com/octocat/Hello-World '
        'and write a short summary as a PDF.”</i> BODHA\u2019s computer fetches the repository\u2019s '
        'README, writes the summary, builds a PDF, and hands it to the student — with the steps it '
        'took visible above the download. The same path makes a Word handout in Hindi, or an Excel '
        'timetable, from one sentence of instruction.', S['body']))
    st.append(Spacer(1, 2))
    st.append(K.panel([Paragraph(
        'The division of labour is the point. The computer exists so that the phone never has to run '
        'anything heavy: the models, the file generation and the sandbox are the server\u2019s job, '
        'and the device\u2019s only job with a finished document is to put it where the student can '
        'find it.', S['quote'])], K.content_width()))
    # ════════════════════════════════════════════════════════════════════════
    # 8 Sub-theme
    # ════════════════════════════════════════════════════════════════════════
    h('8', 'Relevance to the sub-theme', 's8')
    st.append(Paragraph(
        'Indian Knowledge Systems hold place-based practices around water, agriculture, materials and '
        'health that connect directly to today\u2019s sustainability questions. BODHA lowers the '
        'barrier for a student to investigate them rigorously: find the sources, read old or scanned '
        'texts, and compare traditional practice with modern data. The four enquiries below are the '
        'ones the shelf is strongest for, and each is a question a student can start from in the app '
        'today.', S['lead']))
    st.append(K.table([
        ['Inquiry', 'What the shelf supplies', 'What the live web adds'],
        ['How did traditional water-harvesting systems such as stepwells, johads and tanks work, and '
         'what do current studies say about them?',
         'Kautilya on tanks, channels and the duty of the state; Manu on obligations around water '
         'courses; the astronomy of the monsoon calendar in the Surya Siddhanta.',
         'Hydrology studies of recharge, water-table recovery and the cost of reviving a johad; '
         'restoration projects and their measured results.'],
        ['Which traditional mixed-cropping and rotation practices are documented, and how do they '
         'compare with modern sustainable-farming guidance?',
         'Manu on land use and seasons; Hitopadesha and the Arthashastra on the economics of farming; '
         'the crop vocabulary that translation preserves.',
         'Agronomy on intercropping yields, soil nitrogen and pest cycles; government guidance on '
         'natural farming and crop rotation.'],
        ['Which passive-cooling and material choices appear in traditional architecture, and how do '
         'they relate to energy use today?',
         'Descriptions of building, settlement and material in the law and statecraft texts; the '
         'climate vocabulary of the astronomical works.',
         'Measured performance of jaali screens, courtyards, lime and mud walls; cooling-load studies '
         'and embodied-energy comparisons.'],
        ['Which plants appear in classical texts, and what does published research report about them?',
         'Sushruta and the materia medica of the medical tradition; the plants of the epics and the '
         'fables, with the names translation keeps.',
         'Pharmacological and botanical studies on the same species; conservation status and '
         'cultivation research.'],
    ], [128, (K.content_width() - 128) / 2, (K.content_width() - 128) / 2], S))

    st.append(Paragraph('What a student does with it, in practice', S['h2']))
    st.append(Paragraph(
        'A student picks a practice they can see near them — a tank, a field pattern, a courtyard, a '
        'tree — and asks BODHA two questions in sequence. First: <i>what do the old texts actually '
        'say?</i> BODHA answers from the shelf, with the passage and the work, so the claim can be '
        'checked against a printed translation in the school library. Second: <i>what does current '
        'research say?</i> BODHA searches the live web and cites what it finds, dated, so the student '
        'can see whether the practice is studied, disputed or ignored. The comparison between the two '
        'answers is the student\u2019s finding — not BODHA\u2019s.', S['body']))
    st.append(Paragraph(
        'That shape of work is what makes the project a fit for a sub-theme about sustainability. '
        'Traditional practice is not presented as automatically correct, nor is it dismissed as '
        'obsolete: it is presented with its sources, next to the modern evidence, and the student is '
        'left holding two sets of citations and a question of their own.', S['body']))

    # ════════════════════════════════════════════════════════════════════════
    # 9 Responsible design
    # ════════════════════════════════════════════════════════════════════════
    h('9', 'Responsible design', 's9')
    st.append(Paragraph(
        'The submitted document listed five commitments. Each one is a property of the deployed app, '
        'not an intention.', S['body']))
    st.append(K.table([
        ['Commitment', 'How it is implemented'],
        ['Educational scope',
         'BODHA does not act as a general assistant; off-topic requests get a short reply and a nudge '
         'back to learning. The system prompt that shapes every conversation is fixed on the server '
         'and is applied to every model in the chain, including a model a student adds themselves.'],
        ['Transparent about evidence',
         'It is designed to say when sources are thin or conflicting rather than smooth over the gap. '
         'Shelf evidence and web evidence are labelled differently, and a citation opens the source.'],
        ['Sandboxed code',
         'Code generated for a student runs in an isolated cloud sandbox, never on the student\u2019s '
         'device. BODHA\u2019s computer writes only inside a per-task workspace.'],
        ['Private by design',
         'Each student\u2019s chats and uploads live under their own account, and access rules are '
         'enforced on the server for every request — a request without a session gets nothing. There '
         'is no advertising, no analytics and no third-party tracking script in the app.'],
        ['Comfortable to read',
         'A warm, low-glare theme with a paper-coloured ground, a measured reading column, a serif '
         'face designed for long-form reading, and voice features that support long sessions and '
         'different learners.'],
    ], [110, K.content_width() - 110], S))
    st.append(Paragraph('The ninth thing: permissions', S['h2']))
    st.append(Paragraph(
        'An app that asks for everything cannot claim to be careful. The Android app asks for the '
        'internet, the microphone when dictation is first used, and — on phones older than Android 10 '
        '— a storage permission capped at that version so a finished file can be saved. It has no '
        'camera, no location, no contacts and no advertising identifier. The Windows app asks for the '
        'microphone and nothing else, and refuses every other permission request the page could make.',
        S['body']))
    st.append(Paragraph('Design choices that are also ethical choices', S['h2']))
    st.append(K.bullets([
        '<b>Reading first.</b> The layout is a single measured column, closer to a page of a book '
        'than to a dashboard. The reader view opens beside the conversation rather than replacing it.',
        '<b>Calm by default.</b> Nothing blinks, nothing counts down, nothing nudges. Animations are '
        'short and purposeful, and the app can be read on a slow connection.',
        '<b>Black and white here, too.</b> This document uses no colour at all: a project about '
        'respect for sources should survive a photocopier.',
        '<b>Honest failure.</b> When a model, a voice or a provider fails, the app names it and '
        'offers the alternative, rather than blaming the student\u2019s question or spinning forever.',
    ], S))

    # ════════════════════════════════════════════════════════════════════════
    # 10 Technology
    # ════════════════════════════════════════════════════════════════════════
    h('10', 'Technology', 's10')
    st.append(Paragraph('What the submitted document describes', S['h2']))
    st.append(K.table([
        ['Layer', 'Technology'],
        ['Interface', 'Next.js, TypeScript, Tailwind CSS'],
        ['Reasoning model', 'Kimi K3 through the NVIDIA NIM API'],
        ['Document OCR', 'NVIDIA Nemotron-Parse'],
        ['Voice', 'Fish Audio (text-to-speech and speech-to-text)'],
        ['Code sandbox', 'E2B Code Interpreter'],
        ['Web search', 'Tavily'],
        ['Accounts and storage', 'Firebase Authentication, Firestore, Cloud Storage'],
        ['Delivery', 'Source on GitHub, hosted on Vercel'],
    ], [150, K.content_width() - 150], S))
    st.append(Paragraph('What is deployed today, measured', S['h2']))
    st.append(K.table([
        ['Layer', 'Technology', 'Note'],
        ['Interface', 'Next.js 15 (App Router), TypeScript, Tailwind', 'One codebase for web, phone and desktop'],
        ['Reasoning chain', 'Kimi K2.6 → GLM 5.3 Flash → Nemotron 3 Super → GPT-OSS 20B',
         'NVIDIA NIM API, with fallbacks and a health watchdog'],
        ['Retrieval', 'BM25 over the IKS shelf, plus the student\u2019s documents and the web',
         '15 works, 6,525 passages, digest 80e2cda0237b'],
        ['Reading a scan', 'NVIDIA Nemotron-Parse for OCR', 'Photographs and scanned pages'],
        ['Voice', 'Whisper large v3 turbo to listen; Fish Audio to speak, Hindi for Devanagari',
         'Live Mode uses a low-latency path with the same chain behind it'],
        ['Code sandbox', 'E2B Code Interpreter', 'Runs on the server, never on the device'],
        ['Web search', 'Tavily', 'Labelled as web evidence in the answer'],
        ['Accounts and storage', 'Email-and-password sessions; Firebase for data and files',
         'Per-account access rules checked on every request'],
        ['The apps, and delivery', 'Android 1.1, Windows 1.0 (see Section 11); GitHub and Vercel',
         'bodha-ai-three.vercel.app'],
    ], [92, 175, K.content_width() - 92 - 175], S))
    mark('fig4')
    st.append(K.figure(K.diagram_chain(K.content_width()),
                       'Figure 4 — The reasoning chain, and what happens when a link fails. Each '
                       'link is a different provider, so one provider\u2019s bad afternoon does not '
                       'become the student\u2019s problem.', S))
    st.append(K.panel([
        Paragraph('Notes where this document and the submitted project differ', S['h3']),
        K.bullets([
            '<b>The model.</b> The submitted document names Kimi K3. The chain deployed and measured '
            'is Kimi K2.6 as the first choice, with GLM 5.3 Flash, Nemotron 3 Super and GPT-OSS 20B '
            'behind it. The name in the document was the plan; this is what answers.',
            '<b>Accounts.</b> The document says Firebase Authentication. BODHA now signs students in '
            'with its own email-and-password sessions, and uses Firebase for data and files. Google '
            'sign-in was removed deliberately: fewer third parties in the path of a school account.',
            '<b>Voice.</b> The document gives Fish Audio both directions. Read-aloud is Fish Audio; '
            'dictation is Whisper large v3, the more accurate recogniser for Indian English and Hindi.',
            '<b>The apps.</b> The document describes a web product; the Android and Windows apps have '
            'since been built around it, with no second codebase to keep in step.',
        ], S, style_key='small'),
    ], K.content_width()))
    # ════════════════════════════════════════════════════════════════════════
    # 11 The apps
    # ════════════════════════════════════════════════════════════════════════
    h('11', 'The apps: Android, Windows, and the browser', 's11')
    st.append(Paragraph(
        'BODHA is one product with one source of truth: the web app. The Android and Windows apps are '
        'thin shells around it — a real window, a real microphone, a real file picker and a Downloads '
        'folder — so that a bug is fixed once and every student gets the fix. Neither app contains a '
        'model, an index or a database.', S['lead']))
    mark('fig5')
    st.append(K.figure(K.diagram_split(K.content_width()),
                       'Figure 5 — Where the work happens. Everything heavy is on the server; the '
                       'device is a window with a microphone.', S))
    st.append(Paragraph('What each app is', S['h2']))
    st.append(K.table([
        ['', 'BODHA for Android 1.1', 'BODHA for Windows 1.0'],
        ['File', 'BODHA-1.1.apk · 121,442 bytes · sha256 aee07bae…08d3dd',
         'BODHA-Setup-1.0.0.exe · 103 MB · sha256 82e97b79…7212f4'],
        ['Runs on', 'Android 6.0 (API 23) and newer; no device filtered out',
         'Windows 10 and 11, 64-bit; nothing to install first'],
        ['Verified', 'Release-signed; v1, v2 and v3 schemes verify',
         'Per-user install; shell booted and tested against a dead network'],
        ['It adds', 'The phone\u2019s file chooser, a microphone that survives page changes, back that '
         'behaves, pull-to-refresh, Android\u2019s DownloadManager, and a paper-coloured offline page',
         'A real Windows window with its own icon and menu, remembered size and position, links that '
         'open in the browser, Windows\u2019 download flow, and the same offline page'],
        ['Install', 'Download the APK from the repository, allow installs from the app you tapped it '
         'in, and press “Install anyway” if Play Protect asks',
         'Run the installer; SmartScreen offers “More info → Run anyway”, because it is not signed '
         'with a paid certificate'],
    ], [56, (K.content_width() - 56) / 2, (K.content_width() - 56) / 2], S))
    st.append(Paragraph(
        'Both apps are shells around the same web app: neither contains a model, an index or a '
        'database, and both carry a step-by-step install guide in the repository '
        '(android/INSTALL.md and desktop/INSTALL.md).', S['body']))
    st.append(Paragraph('Getting the apps', S['h2']))
    st.append(K.table([
        ['Where', 'What to do'],
        ['In a browser',
         'Open <font face="Mono" size="8.6">bodha-ai-three.vercel.app</font> and make an account. '
         'Nothing to install; this is the same product the apps wrap.'],
        ['On an Android phone',
         'Download <font face="Mono" size="8.6">android/BODHA-1.1.apk</font> from the repository, '
         'tap it, allow installs from the app you tapped it in, and press “Install anyway” if Play '
         'Protect asks. <font face="Mono" size="8.6">android/INSTALL.md</font> answers each refusal '
         'message by name, including the ones specific to MIUI, ColorOS, Funtouch, One UI and Pixel.'],
        ['On a Windows PC',
         'Download <font face="Mono" size="8.6">BODHA-Setup-1.0.0.exe</font> from the release, run '
         'it, and choose “More info → Run anyway” if SmartScreen asks. It installs for the current '
         'user only: no administrator password, nothing shared with the rest of the machine.'],
        ['From the source',
         'The web app, the Android app, the Windows app and the shelf are one repository: '
         '<font face="Mono" size="8.6">github.com/srijan7815-bit/bodha-ai</font>. Every artifact in '
         'this document can be rebuilt from it, and the build steps are scripts, not instructions.'],
    ], [104, K.content_width() - 104], S))
    st.append(Paragraph(
        'One product, three ways in: a student can start a question on the phone in a bus, finish '
        'reading on a school PC, and open the same conversation at home in a browser, because the '
        'conversation, the documents and the shelf live with the account. Sessions are per-account and '
        'checked on the server; a device holds only what it needs to draw the screen.', S['body']))
    # ════════════════════════════════════════════════════════════════════════
    # 12 What we tested
    # ════════════════════════════════════════════════════════════════════════
    h('12', 'What we tested, and what it showed', 's12')
    st.append(Paragraph(
        'A project that asks students to check evidence should be checkable itself. These are the '
        'tests that back the claims in this document, in the order they were run.', S['body']))
    st.append(K.table([
        ['Check', 'How', 'Result'],
        ['The live app answers', 'Request the home page and the shelf page on the deployed URL',
         'HTTP 200; title “BODHA AI · बोध — your patient AI tutor”'],
        ['A student can join', 'Register an account on the live site, then sign in',
         'Account created, session issued, second sign-in works'],
        ['The shelf retrieves', 'Search the corpus through /api/iks/search',
         'Ranked passages returned with work and section; eight hits for the test query'],
        ['Answers are grounded', 'Ask a question the shelf covers, end to end on the live site',
         'A grounded answer in ~18 seconds citing three Arthashastra passages by number'],
        ['The shelf is complete', 'Re-index all fifteen works and compare the digest',
         '15 works, 6,525 passages, digest 80e2cda0237b — reproducible'],
        ['The health check is honest', 'Read /api/health',
         'Chain, store and voice reported as configured, with the live chain named'],
        ['The Android file is installable', 'Verify signatures (v1, v2, v3) and the archive layout',
         'All three schemes verify; resources.arsc stored and 4-byte aligned, as a store build is'],
        ['The APK is the built one', 'Rebuild from source and compare',
         'Identical code, same signer certificate — an update, not a second app'],
        ['The shelf and computer pages load', 'Request /iks and /computer on the live site',
         'HTTP 200 with the shelf and the task page rendered'],
        ['The Windows installer publishes', 'Upload the installer as a release asset and fetch it',
         '107,302,749 bytes served, checksum matching the local file'],
        ['The Windows installer builds', 'Build the installer from desktop/ with makensis',
         '103 MB per-user installer from a 321 MB, 28-file payload; checksum recorded'],
        ['The desktop shell runs', 'Boot the same main.js under a virtual display',
         'Loads the live app; on a refused connection it shows the offline page, then returns to '
         'BODHA by itself when the server answers'],
        ['The web build is green', 'Run the production build after every change',
         'Compiled and type-checked with no errors before each push'],
    ], [118, 168, K.content_width() - 118 - 168], S))
    st.append(Paragraph('What the tests do not prove', S['h2']))
    st.append(Paragraph(
        'Two honest gaps remain, and they are recorded here rather than left for someone else to '
        'find. The Android file was verified as thoroughly as a Linux machine can verify an Android '
        'package — signatures, archive layout, manifest, code — but it was not installed on a physical '
        'phone from this machine; the install guide exists precisely because the phone\u2019s own '
        'switches are the most common reason a sideloaded app is refused. The Windows installer was '
        'built and its shell was run here, but on Linux with the same JavaScript, not on Windows; the '
        'Windows-specific parts are Electron\u2019s own runtime and a short NSIS script. Section 13 '
        'says what that means for a teacher who tries it.', S['body']))
    # ════════════════════════════════════════════════════════════════════════
    # 13 Limits and next steps
    # ════════════════════════════════════════════════════════════════════════
    h('13', 'Limits, and what comes next', 's13')
    st.append(Paragraph('Limits, stated plainly', S['h2']))
    st.append(K.bullets([
        '<b>BODHA needs the network.</b> The reasoning, the shelf, the voice and the computer all run '
        'on the server, which is why the phone stays light and why nothing works on a dead '
        'connection. Both apps say so in BODHA\u2019s own words and retry by themselves.',
        '<b>The shelf is in English translation.</b> Fifteen works in translation is a beginning, not '
        'a library. Idiom and nuance do not survive translation, and the app cannot yet read the '
        'Sanskrit or Tamil original against the translation.',
        '<b>A model can still be wrong.</b> Citations reduce the damage — a wrong claim can be caught '
        'at its source — but they do not remove it. Reading the cited passage is still the '
        'student\u2019s job, which is the habit BODHA is trying to build.',
        '<b>OCR has limits.</b> Printed pages read well; handwriting, marginalia and worn type do not. '
        'The app says when a page was read uncertainly instead of inventing text.',
        '<b>Voice costs time and money.</b> Reading aloud is streamed in small pieces to keep it '
        'usable on a slow connection, and a provider\u2019s bad day is visible rather than hidden.',
        '<b>Two install paths are fiddly.</b> A sideloaded Android app meets Play Protect, and an '
        'unsigned Windows installer meets SmartScreen. Both are documented step by step, but neither '
        'is as frictionless as a store listing.',
    ], S))
    st.append(Paragraph('What comes next', S['h2']))
    st.append(K.table([
        ['Next step', 'Why it matters'],
        ['A curated, open-access IKS library that BODHA searches first',
         'The single largest improvement to answer quality: more works, better passages, more of them '
         'in the original with translation alongside. This is the plan the submitted document named, '
         'and the shelf built for this project is its first instalment.'],
        ['Hindi and other Indian-language support, end to end',
         'The voice path already speaks Hindi and recognises it. The next step is the shelf and the '
         'interface: a student should be able to ask in Hindi and be answered in Hindi, with citations '
         'in the same language.'],
        ['Classroom materials for teachers',
         'A short guide that turns the four enquiries of Section 8 into project work a class can do, '
         'with the citations already gathered.'],
        ['Install without friction',
         'A signed Windows installer, and an Android build in a store, would remove the two warning '
         'screens a teacher currently has to walk past. Both need a paid certificate or a developer '
         'account, which is the next step rather than this one.'],
        ['Deeper evaluation with students',
         'Measure the thing the project actually claims: whether students check the cited source, and '
         'whether they ask better questions the second time.'],
    ], [170, K.content_width() - 170], S))
    # ════════════════════════════════════════════════════════════════════════
    # 14 Team, acknowledgement, references
    # ════════════════════════════════════════════════════════════════════════
    h('14', 'Team, acknowledgement and references', 's14')
    st.append(Paragraph(
        'Creators: <b>Srijan Singh</b> (Group Leader) and <b>Parv Mishra</b>, PM SHRI Kendriya '
        'Vidyalaya Kanpur Cantt. Guide: <b>Mrs. Veenu Ghai</b>, Computer Science. Submitted for '
        'NCSC 2026-27 under the sub-theme “Application of Indian Knowledge Systems for '
        'Sustainability”, registration ID NCSC-2026-27-272758.', S['body']))
    st.append(Paragraph('Acknowledgement', S['h2']))
    st.append(Paragraph(
        'Our thanks to Mrs. Veenu Ghai for reading every draft and for insisting that the citations '
        'be real; to the Principal and staff of PM SHRI Kendriya Vidyalaya Kanpur Cantt for the room '
        'to build this; and to the keepers of the open archives — Project Gutenberg, the Internet '
        'Archive, the Digital Library of India and JSTOR\u2019s open scans — without whose work a '
        'school project could not read a two-thousand-year-old text at all.', S['body']))
    st.append(Paragraph('References and sources', S['h2']))
    st.append(K.table([
        ['', 'Source'],
        ['Shelf works', 'Bhagavad Gita; the Upanishads; the Yoga Sutras; the Vedanta Sutras; the '
         'Ramayana; the Mahabharata (Book I); the Hitopadesha — Project Gutenberg plain texts.'],
        ['', 'Kautilya\u2019s Arthashastra; the Laws of Manu; the Rigveda; the Sushruta Samhita '
         '(English translation); the Sarva-Darshana-Samgraha; Colebrooke\u2019s Algebra with '
         'Arithmetic and Mensuration; the Surya Siddhanta; the Thirukkural — archive.org and Digital '
         'Library of India scans, read in English translation.'],
        ['Models and services', 'NVIDIA NIM API (integrate.api.nvidia.com) for the reasoning chain, '
         'Nemotron-Parse for OCR, and the low-latency voice path; Groq for Whisper large v3 turbo; '
         'Fish Audio for speech synthesis; E2B for the code sandbox; Tavily for web search; Firebase '
         'for data and file storage.'],
        ['Software', 'Next.js 15 · React · TypeScript · Tailwind CSS · Electron 44 · NSIS 3 · '
         'Source Serif 4 and Noto Serif Devanagari (Open Font Licence).'],
        ['Source', 'github.com/srijan7815-bit/bodha-ai — the web app, the Android app, the Windows '
         'app, the shelf, and the scripts that build every artifact in this document.'],
    ], [100, K.content_width() - 100], S))
    st.append(Spacer(1, 8))
    st.append(K.panel([Paragraph(
        'Every number in this document can be checked: the shelf digest, the checksums of the two '
        'apps, the model chain and the health endpoint are all reproducible from the repository.',
        S['small'])], K.content_width()))
    st.append(Paragraph('Try it in five minutes', S['h2']))
    st.append(K.table([
        ['1', 'Open <font face="Mono" size="8.6">bodha-ai-three.vercel.app</font> in a browser and make an account — an email address is enough.'],
        ['2', 'Open the <b>Knowledge Shelf</b> and search for a word you know is in the texts: “tank”, “rain”, “plant”, “dharma”. Watch what comes back, and which work it comes from.'],
        ['3', 'Go to the chat and ask a question that needs a source: <i>“How did traditional water harvesting work, and what do current studies say?”</i> Every citation in the answer is a link; open one and read the passage.'],
        ['4', 'Ask a question that needs arithmetic or a picture — <i>“chart the rainfall of Kanpur against the monsoon months”</i> — and watch the code run in the sandbox instead of being guessed at.'],
        ['5', 'Try one voice feature: dictate a question, or press read-aloud on the answer, or open Live Mode and simply talk.'],
    ], [22, K.content_width() - 22], S, header=False, zebra=True))
    st.append(Spacer(1, 4))
    st.append(Paragraph('The five steps above are the demonstration we would give a visiting teacher: '
                        'shelf, citation, sandbox, voice — the whole project in five minutes of class time.',
                        S['caption']))
    st.append(PageBreak())

    # ════════════════════════════════════════════════════════════════════════
    # Appendix A
    # ════════════════════════════════════════════════════════════════════════
    h('Appendix A', 'The project document as submitted', 'appA')
    st.append(Paragraph(
        'The three pages below are the project document submitted for NCSC 2026-27, photographed. '
        'Its content is carried through this PDF in full: Section 1 is its problem statement, '
        'Section 2 its description of BODHA, Section 3 its four-step method, Section 4 its feature '
        'table, Section 8 its sub-theme relevance, Section 9 its responsible-design commitments, '
        'Section 10 its technology table, and Section 14 its team and next steps. The photographs are '
        'reproduced here in grayscale, one per page, so that the source can be held beside the '
        'account of it.', S['body']))
    # The three photographed pages: the first at reading size beside this
    # introduction, the other two together on the page after.
    def photo(name, width):
        px_w, px_h = K.asset_size(name)
        return Image(K.asset(name), width=width, height=width * px_h / px_w, hAlign='CENTER')

    st.append(Spacer(1, 4))
    st.append(photo('doc-1.png', 356))
    st.append(Paragraph('Page 1 of the submitted document — title block, the problem, what BODHA '
                        'is, how it works, and the four steps.', S['caption']))
    st.append(PageBreak())
    half = (K.content_width() - 18) / 2
    pair = Table([[photo('doc-2.png', half), photo('doc-3.png', half)]],
                 colWidths=[half + 9, half + 9],
                 style=TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'),
                                   ('LEFTPADDING', (0, 0), (-1, -1), 0),
                                   ('RIGHTPADDING', (0, 0), (-1, -1), 0),
                                   ('TOPPADDING', (0, 0), (-1, -1), 0),
                                   ('BOTTOMPADDING', (0, 0), (-1, -1), 0)]))
    st.append(pair)
    st.append(Paragraph('Page 2 — the key-features table with each feature\u2019s scope, relevance to '
                        'the sub-theme, and the five responsible-design commitments.&nbsp;&nbsp;·&nbsp;&nbsp;'
                        'Page 3 — the technology table, the team, and the planned next steps.', S['caption']))
    st.append(Spacer(1, 10))
    st.append(K.Rule(thickness=0.9, colour=K.INK, space_before=0, space_after=8))
    st.append(Paragraph('BODHA · बोध — submitted by Srijan Singh and Parv Mishra, PM SHRI Kendriya '
                        'Vidyalaya Kanpur Cantt, for NCSC 2026-27. Source, apps and shelf: '
                        'github.com/srijan7815-bit/bodha-ai', S['small']))

    return glue(st, S, K)


def glue(story, S, K):
    """Keeps a section heading with the paragraph it introduces.

    A heading stranded at the foot of a page is the one typographic failure this
    document will not tolerate, so the mark, the heading, its rule and the first
    paragraph of a section move together."""
    from reportlab.platypus import KeepTogether as KT
    out, i = [], 0
    while i < len(story):
        flow = story[i]
        is_heading = isinstance(flow, Paragraph) and getattr(flow.style, 'name', '') == 'h1'
        if isinstance(flow, K.Mark) or is_heading:
            chunk, j = [flow], i + 1
            while j < len(story) and isinstance(story[j], (K.Rule, K.Mark)):
                chunk.append(story[j]); j += 1
            if is_heading and j < len(story) and isinstance(story[j], Paragraph):
                chunk.append(story[j]); j += 1
                out.append(KT(chunk)); i = j; continue
        out.append(flow); i += 1
    return out
