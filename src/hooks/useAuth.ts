import { useEffect, useMemo, useRef, useState } from 'react'
import { ApiStatus, RegisterInput, UserData } from '../model'
import {
  fetchUser,
  keepUserSessionAlive,
  logout,
  registerUser,
  updateDocsReviewStatus,
} from '../api/auth'
import { IS_MOCK_MODE, MOCK_USER } from '../mock/mockAuth'

export default function useAuth(): {
  isAuthenticated: boolean
  isRegistered: boolean
  hasDocsToBeReviewed: boolean
  user?: UserData
  loadingStatus: ApiStatus
  register: (input: RegisterInput) => Promise<void>
  reviewDocuments: (status: RegisterInput['reviewStatus']) => Promise<void>
  signout: () => void
  fetchAuth: () => void
} {
  // ── Mock mode: skip all API calls and return a pre-baked authenticated user ──
  if (IS_MOCK_MODE) {
    return {
      isAuthenticated: true,
      isRegistered: true,
      hasDocsToBeReviewed: false,
      user: MOCK_USER,
      loadingStatus: 'success',
      register: () => Promise.resolve(),
      reviewDocuments: () => Promise.resolve(),
      signout: () => {
        console.info('[Mock] signout called — no-op in mock mode')
      },
      fetchAuth: () => {
        console.info('[Mock] fetchAuth called — no-op in mock mode')
      },
    }
  }

  // ── Real mode ────────────────────────────────────────────────────────────────
  // (the rest of the hook is only reached when IS_MOCK_MODE is false)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [userData, setUserData] = useState<UserData>()
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [loadingStatus, setLoadingStatus] = useState<ApiStatus>('not started')

  const fetchAuth = () => {
    setLoadingStatus('sending')
    fetchUser()
      .then((ud) => {
        setUserData(ud)
        setLoadingStatus('success')
      })
      .catch((err) => {
        console.error(err)
        setLoadingStatus('error')
      })
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const auth = useMemo(() => {
    const isAuthenticated = userData !== undefined
    const isRegistered =
      isAuthenticated && (userData.authz?.['/portal'] ?? [])?.length > 0
    const hasDocsToBeReviewed =
      isRegistered && (userData.docs_to_be_reviewed ?? [])?.length > 0
    return {
      isAuthenticated,
      isRegistered,
      hasDocsToBeReviewed,
      user: userData,
      register: (registerInput: RegisterInput) =>
        registerUser(registerInput).then(setUserData),
      reviewDocuments: (status: RegisterInput['reviewStatus']) =>
        updateDocsReviewStatus(status).then((docsToBeReviewed) =>
          setUserData((prevUserData) =>
            prevUserData === undefined
              ? prevUserData
              : { ...prevUserData, docs_to_be_reviewed: docsToBeReviewed }
          )
        ),
      signout: () => {
        localStorage.clear()
        setUserData(undefined)
        logout()
      },
      loadingStatus,
      fetchAuth,
    }
  }, [userData, loadingStatus])

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!auth.isAuthenticated) {
      fetchAuth()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // keep access token alive
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const timer = useRef<number | undefined>(undefined)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (timer.current === undefined && auth.isAuthenticated)
      timer.current = window.setInterval(
        keepUserSessionAlive,
        10 * 60 * 1000 // ten minutes
      )

    return () => {
      if (timer.current !== undefined) window.clearInterval(timer.current)
    }
  }, [auth.isAuthenticated])

  return auth
}
