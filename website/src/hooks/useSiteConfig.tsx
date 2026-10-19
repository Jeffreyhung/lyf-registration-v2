import React from "react"
import { doc } from "firebase/firestore"
import { useDocumentData } from "react-firebase-hooks/firestore"

import { SITE_CONFIG_PATH, SiteConfig } from "lyf-registration-schemas"
import ProdContext from "@components/ProdContext"

export type SiteConfigState = {
  /** config/site as stored, or null once loaded if the document is missing. */
  siteConfig: SiteConfig | null
  currentCampYear: number | null
  preRegistrationCampYear: number | null
  loading: boolean
  error: Error | undefined
}

/**
 * Reads config/site from the active (prod or test) database. The document is
 * public, so this works before sign-in — the time gates depend on it.
 */
export default function useSiteConfig(): SiteConfigState {
  const { firestore } = React.useContext(ProdContext)
  const [data, loading, error] = useDocumentData<SiteConfig>(
    firestore ? doc(firestore, SITE_CONFIG_PATH) : null
  )

  const currentCampYear =
    typeof data?.currentCampYear === "number" ? data.currentCampYear : null
  const preRegistrationCampYear =
    typeof data?.preRegistrationCampYear === "number"
      ? data.preRegistrationCampYear
      : null

  return {
    siteConfig: loading ? null : data ?? null,
    currentCampYear,
    preRegistrationCampYear,
    loading,
    error,
  }
}
