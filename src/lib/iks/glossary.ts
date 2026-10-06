/**
 * The glossary that lets an English question reach a Sanskrit shelf.
 *
 * A student asks "why do we suffer?" — the texts say "duḥkha". They ask about
 * "duty" — the shelf talks about "dharma" for a thousand pages. Each pair below
 * widens a query with the equivalents the translators themselves used, at less
 * than full weight so a literal word match still outranks a synonym.
 *
 * Terms are written the way they appear after folding (plain letters, no
 * diacritics), because that is how both the query and the corpus are tokenised.
 */

/** word → the terms that should also be searched, with the weight they carry. */
const PAIRS: Array<[string, string[]]> = [
  // philosophy — self, reality, liberation
  ['soul', ['atman', 'self', 'jiva', 'purusha', 'spirit']],
  ['self', ['atman', 'soul', 'purusha']],
  ['atman', ['soul', 'self', 'spirit']],
  ['brahman', ['absolute', 'brahma', 'reality', 'supreme']],
  ['god', ['ishvara', 'brahma', 'deva', 'lord', 'divine']],
  ['reality', ['brahman', 'tattva', 'truth', 'sat']],
  ['truth', ['sat', 'satya', 'reality']],
  ['liberation', ['moksha', 'mukti', 'release', 'freedom', 'emancipation']],
  ['moksha', ['liberation', 'release', 'freedom']],
  ['freedom', ['moksha', 'mukti', 'liberation']],
  ['ignorance', ['avidya', 'nescience', 'illusion']],
  ['illusion', ['maya', 'avidya', 'ignorance']],
  ['maya', ['illusion', 'ignorance']],
  ['knowledge', ['jnana', 'vidya', 'wisdom', 'knowing']],
  ['wisdom', ['jnana', 'prajna', 'knowledge']],
  ['jnana', ['knowledge', 'wisdom']],
  ['consciousness', ['chit', 'chaitanya', 'awareness', 'mind']],
  ['awareness', ['consciousness', 'chit', 'mind']],
  ['mind', ['manas', 'chitta', 'thought', 'consciousness']],
  ['thought', ['manas', 'chitta', 'mind', 'thinking']],
  ['meditation', ['dhyana', 'yoga', 'contemplation', 'concentration']],
  ['dhyana', ['meditation', 'contemplation']],
  ['concentration', ['dharana', 'samadhi', 'meditation']],
  ['breath', ['prana', 'breathing', 'life']],
  ['prana', ['breath', 'life', 'vital']],
  ['body', ['sharira', 'deha', 'matter']],
  ['matter', ['prakriti', 'body', 'nature']],
  ['nature', ['prakriti', 'svabhava', 'matter']],
  ['prakriti', ['nature', 'matter']],
  ['purusha', ['soul', 'self', 'spirit']],
  ['rebirth', ['reincarnation', 'transmigration', 'birth', 'samsara']],
  ['reincarnation', ['rebirth', 'transmigration', 'samsara']],
  ['samsara', ['rebirth', 'world', 'cycle', 'migration']],
  ['suffering', ['duhkha', 'pain', 'sorrow', 'misery']],
  ['sorrow', ['duhkha', 'suffering', 'grief']],
  ['pleasure', ['sukha', 'happiness', 'joy', 'kama']],
  ['happiness', ['sukha', 'pleasure', 'joy', 'bliss']],
  ['desire', ['kama', 'craving', 'attachment', 'longing']],
  ['anger', ['krodha', 'wrath', 'passion']],
  ['fear', ['bhaya', 'dread']],
  ['death', ['mrityu', 'death', 'end', 'mortality']],
  ['immortality', ['amrita', 'deathless', 'eternal']],
  ['time', ['kala', 'time', 'ages', 'yuga']],
  ['yuga', ['age', 'cycle', 'time']],
  ['universe', ['cosmos', 'world', 'jagat', 'creation']],
  ['creation', ['cosmos', 'srsti', 'origin', 'world']],
  ['cosmos', ['universe', 'world', 'creation']],

  // action, duty, ethics
  ['duty', ['dharma', 'obligation', 'law', 'virtue']],
  ['dharma', ['duty', 'law', 'virtue', 'righteousness']],
  ['law', ['dharma', 'rule', 'ordinance', 'duty']],
  ['action', ['karma', 'act', 'deed', 'work']],
  ['karma', ['action', 'deed', 'work', 'fate']],
  ['work', ['karma', 'action', 'labour', 'karma']],
  ['devotion', ['bhakti', 'love', 'faith', 'worship']],
  ['bhakti', ['devotion', 'love', 'worship']],
  ['faith', ['shraddha', 'belief', 'devotion']],
  ['sacrifice', ['yajna', 'offering', 'oblation', 'ritual']],
  ['offering', ['yajna', 'oblation', 'sacrifice', 'gift']],
  ['ritual', ['yajna', 'ceremony', 'sacrifice', 'rite']],
  ['virtue', ['dharma', 'punya', 'merit', 'goodness']],
  ['sin', ['papa', 'evil', 'transgression', 'guilt']],
  ['evil', ['papa', 'sin', 'wickedness']],
  ['merit', ['punya', 'virtue', 'good']],
  ['renunciation', ['sannyasa', 'detachment', 'ascetic', 'abandonment']],
  ['detachment', ['vairagya', 'renunciation', 'dispassion']],
  ['discipline', ['yoga', 'tapas', 'practice', 'restraint']],
  ['practice', ['abhyasa', 'discipline', 'exercise']],
  ['peace', ['shanti', 'calm', 'tranquillity']],
  ['compassion', ['karuna', 'mercy', 'pity', 'kindness']],
  ['nonviolence', ['ahimsa', 'harmlessness']],
  ['charity', ['dana', 'gift', 'giving', 'alms']],
  ['gift', ['dana', 'charity', 'giving']],
  ['teacher', ['guru', 'acharya', 'preceptor']],
  ['guru', ['teacher', 'preceptor', 'master']],
  ['student', ['shishya', 'disciple', 'pupil', 'learner']],
  ['disciple', ['shishya', 'student', 'pupil']],
  ['king', ['raja', 'ruler', 'sovereign', 'prince']],
  ['ruler', ['raja', 'king', 'sovereign']],
  ['state', ['rajya', 'kingdom', 'realm', 'country']],
  ['kingdom', ['rajya', 'state', 'realm']],
  ['government', ['rajya', 'administration', 'rule', 'state']],
  ['administration', ['rajya', 'government', 'management']],
  ['spy', ['spies', 'secret', 'emissary', 'informant']],
  ['war', ['yuddha', 'battle', 'fight', 'conflict']],
  ['battle', ['yuddha', 'war', 'fight']],
  ['army', ['sena', 'troops', 'forces', 'soldier']],
  ['enemy', ['shatru', 'foe', 'adversary']],
  ['friend', ['mitra', 'ally', 'companion']],
  ['wealth', ['artha', 'riches', 'prosperity', 'money']],
  ['artha', ['wealth', 'prosperity', 'interest']],
  ['economy', ['artha', 'wealth', 'finance']],
  ['trade', ['commerce', 'merchant', 'market']],
  ['agriculture', ['farming', 'field', 'cultivation']],
  ['punishment', ['danda', 'penalty', 'justice']],
  ['justice', ['dharma', 'punishment', 'equity']],
  ['marriage', ['vivaha', 'wedding', 'wife', 'husband']],
  ['family', ['kula', 'household', 'kin']],
  ['son', ['putra', 'child', 'offspring']],
  ['woman', ['women', 'wife', 'female']],

  // sciences and arts
  ['medicine', ['ayurveda', 'healing', 'physic', 'treatment']],
  ['health', ['medicine', 'disease', 'body', 'healing']],
  ['disease', ['roga', 'illness', 'sickness', 'malady']],
  ['surgery', ['shalya', 'operation', 'surgical']],
  ['physician', ['vaidya', 'doctor', 'healer']],
  ['herb', ['herbs', 'plant', 'drug', 'medicine']],
  ['astronomy', ['jyotisha', 'stars', 'planets', 'heavenly']],
  ['planet', ['graha', 'star', 'heavenly', 'orbit']],
  ['sun', ['surya', 'savitr', 'light']],
  ['moon', ['chandra', 'soma', 'lunar']],
  ['eclipse', ['eclipses', 'shadow', 'sun', 'moon']],
  ['mathematics', ['ganita', 'arithmetic', 'number', 'calculation']],
  ['arithmetic', ['ganita', 'number', 'calculation', 'mathematics']],
  ['algebra', ['ganita', 'equation', 'unknown', 'mathematics']],
  ['number', ['sankhya', 'numeral', 'calculation']],
  ['zero', ['cipher', 'sunya', 'void', 'naught']],
  ['geometry', ['mensuration', 'measurement', 'figure', 'plane']],
  ['logic', ['nyaya', 'reasoning', 'inference', 'argument']],
  ['reasoning', ['nyaya', 'logic', 'inference']],
  ['inference', ['anumana', 'reasoning', 'logic']],
  ['grammar', ['vyakarana', 'language', 'speech', 'syntax']],
  ['language', ['speech', 'grammar', 'word', 'vak']],
  ['speech', ['vak', 'word', 'language', 'voice']],
  ['poetry', ['kavya', 'verse', 'poem', 'stanza']],
  ['verse', ['sloka', 'stanza', 'poem', 'couplet']],
  ['drama', ['natya', 'play', 'stage', 'actor']],
  ['music', ['sangita', 'song', 'melody', 'note']],
  ['dance', ['nritya', 'natya', 'movement']],
  ['architecture', ['sthapati', 'building', 'temple', 'construction']],
  ['painting', ['chitra', 'art', 'picture']],
  ['education', ['vidya', 'learning', 'study', 'instruction']],
  ['learning', ['vidya', 'knowledge', 'study', 'education']],
  ['study', ['learning', 'vidya', 'study']],
]

/** Folded pair table, built once. */
const TABLE = new Map<string, Array<[string, number]>>()

function remember(word: string, terms: string[], weight: number) {
  const entry = TABLE.get(word) ?? []
  for (const term of terms) {
    if (!term || term === word) continue
    entry.push([term, weight])
  }
  TABLE.set(word, entry)
}

for (const [word, terms] of PAIRS) {
  remember(word, terms, 0.55)
  // The other direction — the shelf's Sanskrit word should also reach the
  // student's English one, more weakly still.
  for (const term of terms) remember(term, [word], 0.4)
}

/**
 * Widens a tokenised query. `terms` are already folded and stemmed by the
 * caller, so they are matched loosely: exact first, then by stem.
 */
export function expandQuery(terms: string[]): Array<[string, number]> {
  const extra = new Map<string, number>()
  for (const term of terms) {
    const direct = TABLE.get(term)
    const stemmed = TABLE.get(term.replace(/s$/, ''))
    for (const [word, weight] of [...(direct ?? []), ...(stemmed ?? [])]) {
      const current = extra.get(word) ?? 0
      if (weight > current) extra.set(word, weight)
    }
  }
  return [...extra.entries()]
}

/**
 * If a question names one of these works, that work is read first. The values
 * are folded tokens that must appear as whole words in the question.
 */
export const WORK_HINTS: Record<string, string[]> = {
  gita: ['gita', 'geeta', 'bhagavad', 'bhagavadgita', 'krishna', 'arjuna', 'songcelestial'],
  upanishads: ['upanishad', 'upanishads', 'vedanta', 'brahman', 'atman'],
  'yoga-sutras': ['yoga', 'patanjali', 'sutra', 'sutras', 'samadhi', 'ashtanga'],
  'vedanta-sutras': ['shankara', 'sankara', 'brahmasutra', 'advaita', 'badarayana'],
  ramayana: ['ramayana', 'rama', 'sita', 'hanuman', 'valmiki', 'ayodhya', 'ravana'],
  mahabharata: ['mahabharata', 'vyasa', 'pandava', 'kaurava', 'arjuna', 'bhima'],
  hitopadesha: ['hitopadesha', 'panchatantra', 'fable', 'counsel', 'narayana'],
  sarvadarsana: ['darshana', 'darshanas', 'nyaya', 'vaisheshika', 'sankhya', 'mimamsa', 'jaina', 'buddhist', 'schools'],
  manu: ['manu', 'manusmriti', 'smriti', 'buhler', 'caste', 'varna', 'ashrama'],
  arthashastra: ['kautilya', 'chanakya', 'arthashastra', 'statecraft', 'diplomacy', 'treasury', 'spies'],
  rigveda: ['rigveda', 'rig', 'veda', 'vedas', 'hymn', 'hymns', 'indra', 'agni', 'varuna', 'usha', 'soma'],
  'surya-siddhanta': ['surya', 'siddhanta', 'jyotisha', 'astronomy', 'eclipse', 'planets', 'calendar'],
  lilavati: ['lilavati', 'bhaskara', 'brahmagupta', 'algebra', 'arithmetic', 'mathematics', 'ganita', 'zero'],
  thirukkural: ['kural', 'thirukkural', 'tirukkural', 'valluvar', 'tamil'],
  sushruta: ['sushruta', 'susruta', 'ayurveda', 'surgery', 'medicine', 'physician'],
}
