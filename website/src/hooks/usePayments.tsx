import {
  collection,
  DocumentData,
  Firestore,
  FirestoreError,
  query,
} from "firebase/firestore"
import { useCollection } from "react-firebase-hooks/firestore"

import { AdminRole, roleHasCapability } from "lyf-registration-schemas"
import { Payment } from "@utils/databaseSchema"

type UsePaymentsProps = {
  isAdmin: boolean
  adminRole: AdminRole | null
  firestore: Firestore
}

export default function usePayments({
  isAdmin,
  adminRole,
  firestore,
}: UsePaymentsProps): [Payment[], boolean, FirestoreError | undefined] {
  const canReadPayments = isAdmin && roleHasCapability(adminRole, "managePayments")
  const [values, loading, error] = useCollection<Payment>(
    canReadPayments
      ? query<Payment, DocumentData>(
          // @ts-expect-error collection() is untyped; query<Payment> narrows it
          collection(firestore, "payments")
        )
      : null
  )

  const data: Payment[] =
    values?.docs.map((payment) => {
      return { ...payment.data(), ref: payment.ref, id: payment.id }
    }) ?? []

  return [data, loading, error]
}
