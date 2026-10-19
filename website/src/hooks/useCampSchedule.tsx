import React from "react"
import { Dayjs } from "dayjs"
import { doc } from "firebase/firestore"
import { useDocumentData } from "react-firebase-hooks/firestore"

import { CampYear } from "lyf-registration-schemas"
import ProdContext from "@components/ProdContext"
import { timestampToCampTime } from "@utils/campTime"

export type CampSchedule = {
  /** True while the year is unknown or the document is still loading. */
  loading: boolean
  /** False once loaded if camps/{year} does not exist. */
  exists: boolean
  campInfo: CampYear | null
  preRegistrationOpen: Dayjs | null
  preRegistrationClose: Dayjs | null
  earlyRegOpen: Dayjs | null
  earlyRegEnd: Dayjs | null
  registrationOpen: Dayjs | null
  registrationLate: Dayjs | null
  registrationClose: Dayjs | null
  infoSessionDate: Dayjs | null
  campStart: Dayjs | null
  campEnd: Dayjs | null
  /** Lowercase emails allowed past the registration close gate. */
  bypassEmails: string[]
  error: Error | undefined
}

/**
 * The dates that drive the registration pages for one camp year, read from
 * camps/{year} (public) and converted to Dayjs in camp time. Pass null while
 * the year itself is still loading from config/site.
 */
export default function useCampSchedule(
  year: number | null | undefined
): CampSchedule {
  const { firestore } = React.useContext(ProdContext)
  const ref =
    firestore && typeof year === "number" ? doc(firestore, `camps/${year}`) : null
  const [data, docLoading, error] = useDocumentData<CampYear>(ref)

  const loading = typeof year !== "number" || docLoading
  const campInfo = !loading && data ? data : null

  return React.useMemo(
    () => ({
      loading,
      exists: !loading && !!data,
      campInfo,
      preRegistrationOpen: timestampToCampTime(campInfo?.preRegistrationOpenDate),
      preRegistrationClose: timestampToCampTime(campInfo?.preRegistrationCloseDate),
      earlyRegOpen: timestampToCampTime(campInfo?.earlyRegOpenDate),
      earlyRegEnd: timestampToCampTime(campInfo?.earlyRegEndDate),
      registrationOpen: timestampToCampTime(campInfo?.registrationOpenDate),
      registrationLate: timestampToCampTime(campInfo?.registrationLateDate),
      registrationClose: timestampToCampTime(campInfo?.registrationCloseDate),
      infoSessionDate: timestampToCampTime(campInfo?.infoSessionDate),
      campStart: timestampToCampTime(campInfo?.campStartDate),
      campEnd: timestampToCampTime(campInfo?.campEndDate),
      bypassEmails: Array.isArray(campInfo?.registrationBypassEmails)
        ? campInfo.registrationBypassEmails.map((e) => e.toLowerCase())
        : [],
      error,
    }),
    [loading, data, campInfo, error]
  )
}
