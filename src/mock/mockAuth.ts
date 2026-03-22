import type { UserData } from '../model'

/**
 * A pre-baked mock UserData object that represents a fully authenticated,
 * registered user. Used when REACT_APP_MOCK_MODE=true.
 */
export const MOCK_USER: UserData = {
  username: 'mock-user@example.com',
  sub: 'mock-user-sub-1234',
  is_admin: false,
  authz: {
    '/portal': [{ method: 'read', service: 'arborist' }],
    '/services/gearbox': [{ method: 'read', service: 'arborist' }],
  },
  docs_to_be_reviewed: [],
}

export const IS_MOCK_MODE = true
