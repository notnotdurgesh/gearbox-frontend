import { MatchDetails, MatchFormValues, MatchGroups } from '../model'
import { fetchGearbox } from './utils'
import { IS_MOCK_MODE } from '../mock/mockAuth'
import { mockGetMatchDetails, mockGetMatchGroups } from '../mock/utils'

const baseUrl = '/gearbox-middleware'

export function getMatchGroups(values: MatchFormValues): Promise<MatchGroups> {
  if (IS_MOCK_MODE) return mockGetMatchGroups(values)

  const queryParams = encodeURIComponent(JSON.stringify(values))
  const url = `${baseUrl}/get_match_groups?values=${queryParams}`
  return fetchGearbox(url).then((res) => res.json() as Promise<MatchGroups>)
}

export function getMatchDetails(
  values: MatchFormValues
): Promise<MatchDetails> {
  if (IS_MOCK_MODE) return mockGetMatchDetails(values)

  const queryParams = encodeURIComponent(JSON.stringify(values))
  const url = `${baseUrl}/get_match_details?values=${queryParams}`
  return fetchGearbox(url).then((res) => res.json() as Promise<MatchDetails>)
}

export function getVersion(): Promise<string> {
  if (IS_MOCK_MODE) return Promise.resolve('mock-1.0.0')

  const url = `${baseUrl}/_version`
  return fetchGearbox(url).then((res) => res.json() as Promise<string>)
}
