import { MatchFormFieldConfig, MatchFormGroupConfig } from '../../model'

// ─── Scoring weights ─────────────────────────────────────────────────────────
const W_EXACT = 100
const W_PREFIX = 50
const W_WORD = 30
const W_SUBSTR = 10
const W_FUZZY = 6

// ─── Medical abbreviations (F1) ──────────────────────────────────────────────
const ABBREVIATIONS: Record<string, string> = {
  wbc: 'White Blood Cell',
  rbc: 'Red Blood Cell',
  hgb: 'hemoglobin',
  plt: 'platelet',
  anc: 'Absolute Neutrophil Count',
  aml: 'myeloid leukemia',
  all: 'lymphoblastic leukemia',
  cns: 'cns',
  mrd: 'measurable residual disease',
  ecog: 'ecog',
  bm: 'bone marrow',
  ds: 'down syndrome',
}

// ─── Criterion relationships (F14) ──────────────────────────────────────────
export const CRITERION_RELATIONSHIPS: Record<
  string,
  { related: string[]; reason: string }
> = {
  creatinine_meas: {
    related: ['egfr_meas', 'bilirubin_meas'],
    reason: 'Kidney / organ function panel',
  },
  wbc_meas: {
    related: ['anc_meas', 'platelet_meas', 'hemoglobin_meas'],
    reason: 'Complete Blood Count (CBC)',
  },
}

// ─── Natural-language hints (F8) ─────────────────────────────────────────────
export const NL_HINTS: Record<string, string[]> = {
  'kidney function': ['creatinine', 'egfr'],
  'liver function': ['alt', 'ast', 'bilirubin'],
  'blood count': ['wbc', 'anc', 'platelet', 'hemoglobin'],
  cbc: ['wbc', 'anc', 'platelet', 'hemoglobin'],
  demographics: ['age', 'sex', 'weight'],
  diagnosis: ['diagnosis', 'refractory', 'relapse'],
}

// ─── Templates (F9) ─────────────────────────────────────────────────────────
export const TEMPLATES = [
  {
    name: 'Demographics',
    fieldNames: ['age', 'sex', 'weight'],
  },
  {
    name: 'Disease Status',
    fieldNames: [
      'diagnosis',
      'ever_refractory',
      'ever_relapse',
      'cns_status',
      'ecog',
    ],
  },
  {
    name: 'Organ Function',
    fieldNames: [
      'creatinine_meas',
      'egfr_meas',
      'alt_meas',
      'ast_meas',
      'bilirubin_meas',
    ],
  },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '')
}

function expandAbbrev(query: string): string {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((w) => ABBREVIATIONS[w] || w)
    .join(' ')
}

// ─── Fuzzy matching (Levenshtein distance) ───────────────────────────────────
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m

  // Use single-row optimization for memory efficiency
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let curr = new Array<number>(n + 1)

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

/** Returns true if query fuzzy-matches within target (max ~30% edit distance) */
function fuzzyMatch(query: string, target: string): boolean {
  if (query.length < 3) return false // too short for fuzzy
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (t.includes(q)) return true // exact substring is always a match

  // Check each word in the target against the query
  const targetWords = t.split(/\s+/)
  for (const word of targetWords) {
    if (word.length < 3) continue
    const maxDist = Math.max(
      1,
      Math.floor(Math.min(q.length, word.length) * 0.35)
    )
    if (levenshtein(q, word) <= maxDist) return true
    // Also check if query is a fuzzy prefix of the word
    if (word.length >= q.length) {
      const prefix = word.substring(0, q.length)
      if (levenshtein(q, prefix) <= Math.max(1, Math.floor(q.length * 0.3)))
        return true
    }
  }
  return false
}

// ─── Public types ────────────────────────────────────────────────────────────
export type ScoredField = {
  field: MatchFormFieldConfig
  groupName: string
  score: number
}

// ─── Search (F1 + F2 + F8 + fuzzy) ──────────────────────────────────────────
export function searchFields(
  query: string,
  fields: MatchFormFieldConfig[],
  groups: MatchFormGroupConfig[]
): ScoredField[] {
  if (!query.trim()) return []

  const groupMap = new Map(groups.map((g) => [g.id, g.name]))
  const expanded = expandAbbrev(query)
  const nq = norm(expanded)
  const words = nq.split(/\s+/).filter(Boolean)

  // NL hint boost set
  const boostedIds = new Set<number>()
  for (const [phrase, keywords] of Object.entries(NL_HINTS)) {
    if (norm(phrase).includes(nq) || nq.includes(norm(phrase))) {
      fields.forEach((f) => {
        if (
          keywords.some(
            (k) => norm(f.name).includes(k) || norm(f.label || '').includes(k)
          )
        ) {
          boostedIds.add(f.id)
        }
      })
    }
  }

  const results: ScoredField[] = []

  for (const field of fields) {
    const nName = norm(field.name)
    const nLabel = norm(field.label || '')
    const searchable = nName + ' ' + nLabel
    let score = 0

    // Exact match on name
    if (nName === nq) score += W_EXACT
    else if (nName.startsWith(nq)) score += W_PREFIX
    // Full label match
    else if (nLabel === nq) score += W_EXACT
    else if (nLabel.startsWith(nq)) score += W_PREFIX
    // All query words found
    else if (words.every((w) => searchable.includes(w))) score += W_WORD
    // Substring
    else if (searchable.includes(nq)) score += W_SUBSTR
    // Fuzzy match (catches typos like "refactory" → "refractory")
    else if (fuzzyMatch(nq, searchable)) score += W_FUZZY

    // Also check option labels for select/radio fields
    if (score === 0 && field.options) {
      for (const opt of field.options) {
        const optLabel = norm(opt.label || '')
        if (optLabel.includes(nq) || fuzzyMatch(nq, optLabel)) {
          score += W_FUZZY
          break
        }
      }
    }

    // NL hint boost
    if (boostedIds.has(field.id)) score += 80

    // Group name match
    const gName = groupMap.get(field.groupId) || ''
    if (norm(gName).includes(nq)) score += 5

    if (score > 0) {
      results.push({
        field,
        groupName: gName || 'General',
        score,
      })
    }
  }

  return results.sort((a, b) => b.score - a.score)
}

// ─── All fields for browse ──────────────────────────────────────────────────
export function getAllFieldsForBrowse(
  fields: MatchFormFieldConfig[],
  groups: MatchFormGroupConfig[]
): ScoredField[] {
  const groupMap = new Map(groups.map((g) => [g.id, g.name]))
  return fields.map((f) => ({
    field: f,
    groupName: groupMap.get(f.groupId) || 'General',
    score: 0,
  }))
}

// ─── Related fields (F14) ───────────────────────────────────────────────────
export function getRelatedSuggestions(
  addedFieldName: string,
  allFields: MatchFormFieldConfig[],
  groups: MatchFormGroupConfig[]
): {
  source: string
  fields: ScoredField[]
  reason: string
} | null {
  const groupMap = new Map(groups.map((g) => [g.id, g.name]))

  const key = Object.keys(CRITERION_RELATIONSHIPS).find(
    (k) => norm(k) === norm(addedFieldName)
  )
  if (!key) return null

  const { related, reason } = CRITERION_RELATIONSHIPS[key]
  const matched = allFields
    .filter((f) => related.some((r) => norm(r) === norm(f.name)))
    .map((f) => ({
      field: f,
      groupName: groupMap.get(f.groupId) || '',
      score: 100,
    }))

  if (matched.length) return { source: addedFieldName, fields: matched, reason }
  return null
}
