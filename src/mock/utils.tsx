import eligibilityCriteria from './eligibilityCriteria.json'
import latestUserInput from './latestUserInput.json'
import matchConditions from './matchConditions.json'
import matchFormConfig from './matchFormConfig.json'
import studies from './studies.json'
import importantQuestionsConfig from './importantQuestionsConfig.json'
import type {
  EligibilityCriterion,
  ImportantQuestionConfig,
  MatchAlgorithm,
  MatchCondition,
  MatchDetails,
  MatchFormConfig,
  MatchFormValues,
  MatchGroups,
  MatchInfoAlgorithm,
  Study,
  UserInputUi,
} from '../model'

// ─── Raw mock data ──────────────────────────────────────────────────────────

export const mockGetEligibilityCriteria = () =>
  Promise.resolve(eligibilityCriteria as EligibilityCriterion[])

export const mockGetMatchConditions = () =>
  Promise.resolve(matchConditions as MatchCondition[])

export const mockGetMatchFormConfig = () =>
  Promise.resolve(matchFormConfig as MatchFormConfig)

export const mockGetStudies = () => Promise.resolve(studies as Study[])

export const mockGetImportantQuestionsConfig = () =>
  Promise.resolve(importantQuestionsConfig as ImportantQuestionConfig)

// ─── User input ─────────────────────────────────────────────────────────────

// In-memory store for user input so postUserInput -> getLatestUserInput roundtrip works
let _storedUserInput: UserInputUi = {
  id: 1,
  name: 'Default',
  values: latestUserInput.results.reduce(
    (acc, { id, value }) =>
      id && value !== '' ? { ...acc, [id]: value } : acc,
    {} as MatchFormValues
  ),
}

export const mockGetLatestUserInput = (): Promise<UserInputUi> =>
  Promise.resolve({ ..._storedUserInput })

export const mockPostUserInput = (
  values: MatchFormValues,
  id?: number,
  name?: string
): Promise<UserInputUi> => {
  _storedUserInput = {
    id: id ?? _storedUserInput.id ?? 1,
    name: name ?? _storedUserInput.name ?? 'Default',
    values,
  }
  return Promise.resolve({ ..._storedUserInput })
}

// ─── Match logic (runs entirely in the browser from mock data) ───────────────

type CriteriaMap = Map<number, EligibilityCriterion>

function buildCriteriaMap(criteria: EligibilityCriterion[]): CriteriaMap {
  return new Map(criteria.map((c) => [c.id, c]))
}

function compareValues(
  actual: unknown,
  expected: unknown,
  operator: string
): boolean {
  if (actual === undefined || actual === null || actual === '') return false
  const a = Number(actual)
  const e = Number(expected)
  switch (operator) {
    case 'eq':
      // For arrays (multiselect), check inclusion
      if (Array.isArray(actual)) return (actual as unknown[]).includes(expected)
      return actual === expected || a === e
    case 'ne':
      return actual !== expected && a !== e
    case 'gt':
      return a > e
    case 'gte':
      return a >= e
    case 'lt':
      return a < e
    case 'lte':
      return a <= e
    case 'in':
      if (Array.isArray(expected))
        return (expected as unknown[]).includes(actual)
      return false
    default:
      return false
  }
}

type MatchStatus = true | false | undefined

function evaluateCriterionStatus(
  criterionId: number,
  values: MatchFormValues,
  criteriaMap: CriteriaMap
): MatchStatus {
  const criterion = criteriaMap.get(criterionId)
  if (!criterion) return false // unknown criterion -> false
  const fieldValue = values[criterion.fieldId]
  if (fieldValue === undefined || fieldValue === null || fieldValue === '')
    return undefined
  return compareValues(fieldValue, criterion.fieldValue, criterion.operator)
}

function evaluateAlgorithmStatus(
  algorithm: MatchAlgorithm,
  values: MatchFormValues,
  criteriaMap: CriteriaMap
): MatchStatus {
  const results = algorithm.criteria.map((item) => {
    if (typeof item === 'number') {
      return evaluateCriterionStatus(item, values, criteriaMap)
    }
    return evaluateAlgorithmStatus(item as MatchAlgorithm, values, criteriaMap)
  })

  if (algorithm.operator === 'AND') {
    if (results.some((r) => r === false)) return false
    if (results.some((r) => r === undefined)) return undefined
    return true
  } else {
    // OR
    if (results.some((r) => r === true)) return true
    if (results.some((r) => r === undefined)) return undefined
    return false
  }
}

function buildMatchInfoAlgorithm(
  algorithm: MatchAlgorithm,
  values: MatchFormValues,
  criteriaMap: CriteriaMap
): MatchInfoAlgorithm {
  // Build a lookup from fieldId → label & options for human-readable names
  const fieldLookup = new Map(
    (matchFormConfig as MatchFormConfig).fields.map((f) => [
      f.id,
      {
        label: f.label || f.name,
        options: f.options || [],
      },
    ])
  )

  function resolveValueLabel(
    fieldId: number,
    rawValue: unknown
  ): string | string[] | undefined {
    const info = fieldLookup.get(fieldId)
    if (!info || !info.options.length) return undefined
    if (Array.isArray(rawValue)) {
      return rawValue.map((v) => {
        const opt = info.options.find(
          (o) => o.value === v || String(o.value) === String(v)
        )
        return opt ? opt.label : String(v)
      })
    }
    const opt = info.options.find(
      (o) => o.value === rawValue || String(o.value) === String(rawValue)
    )
    return opt ? opt.label : undefined
  }

  const criteria = algorithm.criteria.map((item) => {
    if (typeof item === 'number') {
      const criterion = criteriaMap.get(item)
      if (!criterion) {
        return {
          fieldName: `Unknown criterion (${item})`,
          fieldValue: undefined,
          operator: 'eq' as const,
          isMatched: false,
        }
      }
      const fieldValue = values[criterion.fieldId]
      const info = fieldLookup.get(criterion.fieldId)
      const fieldName = info ? info.label : `Field ${criterion.fieldId}`
      const fieldValueLabel = resolveValueLabel(
        criterion.fieldId,
        criterion.fieldValue
      )
      return {
        fieldName,
        fieldValue: criterion.fieldValue,
        fieldValueLabel,
        operator: criterion.operator,
        isMatched: compareValues(
          fieldValue,
          criterion.fieldValue,
          criterion.operator
        ),
      }
    }
    return buildMatchInfoAlgorithm(item as MatchAlgorithm, values, criteriaMap)
  })

  const isMatched =
    algorithm.operator === 'AND'
      ? criteria.every((c) => c.isMatched)
      : criteria.some((c) => c.isMatched)

  return {
    operator: algorithm.operator,
    criteria,
    isMatched,
  }
}

export const mockGetMatchGroups = (
  values: MatchFormValues
): Promise<MatchGroups> => {
  const criteriaMap = buildCriteriaMap(
    eligibilityCriteria as EligibilityCriterion[]
  )
  const matched: number[] = []
  const unmatched: number[] = []
  const undetermined: number[] = []

  for (const condition of matchConditions as MatchCondition[]) {
    const studyId = condition.studyId
    const status = evaluateAlgorithmStatus(
      condition.algorithm,
      values,
      criteriaMap
    )

    if (status === true) {
      matched.push(studyId)
    } else if (status === false) {
      unmatched.push(studyId)
    } else {
      undetermined.push(studyId)
    }
  }

  return Promise.resolve({ matched, unmatched, undetermined })
}

export const mockGetMatchDetails = (
  values: MatchFormValues
): Promise<MatchDetails> => {
  const criteriaMap = buildCriteriaMap(
    eligibilityCriteria as EligibilityCriterion[]
  )
  const details: MatchDetails = {}

  for (const condition of matchConditions as MatchCondition[]) {
    details[condition.studyId] = buildMatchInfoAlgorithm(
      condition.algorithm,
      values,
      criteriaMap
    )
  }

  return Promise.resolve(details)
}
