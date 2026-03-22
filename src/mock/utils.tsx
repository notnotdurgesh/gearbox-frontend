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

function evaluateCriterion(
  criterionId: number,
  values: MatchFormValues,
  criteriaMap: CriteriaMap
): boolean {
  const criterion = criteriaMap.get(criterionId)
  if (!criterion) return false // unknown criterion → undetermined, treat as false
  const fieldValue = values[criterion.fieldId]
  return compareValues(fieldValue, criterion.fieldValue, criterion.operator)
}

function evaluateAlgorithm(
  algorithm: MatchAlgorithm,
  values: MatchFormValues,
  criteriaMap: CriteriaMap
): boolean {
  const results = algorithm.criteria.map((item) => {
    if (typeof item === 'number') {
      return evaluateCriterion(item, values, criteriaMap)
    }
    return evaluateAlgorithm(item as MatchAlgorithm, values, criteriaMap)
  })

  if (algorithm.operator === 'AND') return results.every(Boolean)
  return results.some(Boolean)
}

function hasUnansweredCriteria(
  algorithm: MatchAlgorithm,
  values: MatchFormValues,
  criteriaMap: CriteriaMap
): boolean {
  return algorithm.criteria.some((item) => {
    if (typeof item === 'number') {
      const criterion = criteriaMap.get(item)
      if (!criterion) return true
      const fieldValue = values[criterion.fieldId]
      return (
        fieldValue === undefined || fieldValue === null || fieldValue === ''
      )
    }
    return hasUnansweredCriteria(item as MatchAlgorithm, values, criteriaMap)
  })
}

function buildMatchInfoAlgorithm(
  algorithm: MatchAlgorithm,
  values: MatchFormValues,
  criteriaMap: CriteriaMap
): MatchInfoAlgorithm {
  const criteria = algorithm.criteria.map((item) => {
    if (typeof item === 'number') {
      const criterion = criteriaMap.get(item)
      if (!criterion) {
        return {
          fieldName: `criterion_${item}`,
          fieldValue: undefined,
          operator: 'eq' as const,
          isMatched: false,
        }
      }
      const fieldValue = values[criterion.fieldId]
      return {
        fieldName: `field_${criterion.fieldId}`,
        fieldValue: criterion.fieldValue,
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
    const hasUnanswered = hasUnansweredCriteria(
      condition.algorithm,
      values,
      criteriaMap
    )
    if (hasUnanswered) {
      undetermined.push(studyId)
    } else {
      const isMatch = evaluateAlgorithm(
        condition.algorithm,
        values,
        criteriaMap
      )
      if (isMatch) {
        matched.push(studyId)
      } else {
        unmatched.push(studyId)
      }
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
