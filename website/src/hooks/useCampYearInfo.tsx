import { useDocumentData } from "react-firebase-hooks/firestore"
import { Firestore, doc } from "firebase/firestore"

import { CampYear } from "lyf-registration-schemas"

export default function useCampYearInfo(
  campYear: number,
  firestore: Firestore
) {
  return useDocumentData<CampYear>(doc(firestore, `camps/${campYear}`))
}
