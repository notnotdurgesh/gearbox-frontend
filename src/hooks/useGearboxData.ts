import { useState, useEffect } from 'react'
import type {
  ApiStatus,
  EligibilityCriterion,
  ImportantQuestionConfig,
  MatchCondition,
  MatchFormConfig,
  Study,
} from '../model'
import { getEligibilityCriteria } from '../api/eligibilityCriteria'
import { getMatchConditions } from '../api/matchConditions'
import { getMatchFormConfig } from '../api/matchFormConfig'
import { getStudies } from '../api/studies'
import type useAuth from './useAuth'
import { getImportantQuestionsConfig } from '../api/importantQuestionsConfig'
import { IS_MOCK_MODE } from '../mock/mockAuth'
import {
  mockGetEligibilityCriteria,
  mockGetImportantQuestionsConfig,
  mockGetMatchConditions,
  mockGetMatchFormConfig,
  mockGetStudies,
} from '../mock/utils'

export default function useGearboxData(auth: ReturnType<typeof useAuth>) {
  const [conditions, setConditions] = useState([] as MatchCondition[])
  const [config, setConfig] = useState({
    groups: [],
    fields: [],
  } as MatchFormConfig)
  const [criteria, setCriteria] = useState([] as EligibilityCriterion[])
  const [studies, setStudies] = useState([] as Study[])
  const [status, setStatus] = useState<ApiStatus>('not started')
  const [importantQuestionsConfig, setImportantQuestionsConfig] =
    useState<ImportantQuestionConfig>({ groups: [] })

  const fetchAll = () => {
    setStatus('sending')

    const fetchers = IS_MOCK_MODE
      ? [
          mockGetMatchConditions(),
          mockGetMatchFormConfig(),
          mockGetEligibilityCriteria(),
          mockGetStudies(),
          mockGetImportantQuestionsConfig(),
        ]
      : [
          getMatchConditions(),
          getMatchFormConfig(),
          getEligibilityCriteria(),
          getStudies(),
          getImportantQuestionsConfig(),
        ]

    Promise.all(fetchers)
      .then(
        ([conditions, config, criteria, studies, importantQuestionsConfig]) => {
          setConditions(conditions as MatchCondition[])
          setConfig(config as MatchFormConfig)
          setCriteria(criteria as EligibilityCriterion[])
          setStudies(studies as Study[])
          setStatus('not started')
          setImportantQuestionsConfig(
            importantQuestionsConfig as ImportantQuestionConfig
          )
        }
      )
      .catch((err) => {
        console.error(err)
        setStatus('error')
      })
  }

  const resetAll = () => {
    setConditions([])
    setConfig({ groups: [], fields: [] } as MatchFormConfig)
    setCriteria([])
    setStudies([])
    setImportantQuestionsConfig({ groups: [] })
  }

  useEffect(() => {
    if (IS_MOCK_MODE || auth.isRegistered)
      fetchAll() // load data on login / mock mode
    else resetAll() // clear data on logout
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.isRegistered])

  return {
    action: {
      fetchAll,
    },
    state: {
      conditions,
      config,
      criteria,
      studies,
    },
    status,
    importantQuestionsConfig,
  }
}
