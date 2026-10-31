import React from "react"
import { Card, CardHeader } from "@mui/material"
import { GridColDef, GridRowModel } from "@mui/x-data-grid"

import { RegistrationData } from "@hooks/useRegistrations"
import { RegistrationStatus } from "lyf-registration-schemas"
import { Table, TableValidRow, DataGridColumnAlign } from "@components/Table"
import { serverTimestamp, updateDoc } from "firebase/firestore"

type PendingPaymentsProps = {
  data: RegistrationData[]
  loading: boolean
}

interface PendingPaymentRow extends TableValidRow {
  name: string
  hasContacted: boolean
  updatedAt: Date
  parentInfo: string
  internalNotes: string
}

const columns: GridColDef<PendingPaymentRow>[] = [
  {
    field: "index",
    headerName: "Index",
    width: 10,
    ...DataGridColumnAlign,
  },
  {
    field: "name",
    headerName: "Name",
    minWidth: 130,
    maxWidth: 150,
    flex: 0.25,
    ...DataGridColumnAlign,
  },
  {
    field: "parentInfo",
    headerName: "Parent Info",
    type: "string",
    flex: 1,
    ...DataGridColumnAlign,
  },
  {
    field: "updatedAt",
    headerName: "Updated At",
    type: "dateTime",
    flex: 0.5,
    ...DataGridColumnAlign,
  },
  {
    field: "hasContacted",
    headerName: "Contacted?",
    type: "boolean",
    editable: true,
    width: 125,
    ...DataGridColumnAlign,
  },

  {
    field: "internalNotes",
    headerName: "Notes",
    type: "string",
    editable: true,
    flex: 1,
    ...DataGridColumnAlign,
  },
]

export default function PendingPayments({
  data,
  loading,
}: PendingPaymentsProps) {
  const pendingPayments = React.useMemo(
    () =>
      data
        .filter((reg) => reg.status === RegistrationStatus.PENDING_PAYMENT)
        .sort((a, b) => a.createdAt.seconds - b.createdAt.seconds),
    [data]
  )

  const rows: PendingPaymentRow[] = React.useMemo(
    () =>
      pendingPayments.map((reg, index) => ({
        id: index.toString(),
        index: index + 1,
        name: reg.camperName,
        updatedAt: reg.updatedAt ? reg.updatedAt.toDate() : new Date(),
        hasContacted: !!reg.hasContacted,
        parentInfo: reg.parents
          .map((p) => {
            let parentInfo = `${p.firstName} ${p.lastName}`
            if (p.phoneNumber) {
              parentInfo += ` | ${p.phoneNumber}`
            }

            if (p.email) {
              parentInfo += ` | ${p.email}`
            }

            return parentInfo
          })
          .join(",\n"),
        internalNotes: reg.internalNotes,
      })),
    [pendingPayments]
  )

  const updateRow = async (newRow: GridRowModel<PendingPaymentRow>) => {
    const registrationRef = pendingPayments[newRow.index - 1].registrationRef
    await updateDoc(registrationRef, {
      hasContacted: newRow.hasContacted ?? false,
      internalNotes: newRow.internalNotes ?? "",
      updatedAt: serverTimestamp(),
    })
  }

  return (
    <Card>
      <CardHeader
        title="Pending Payments"
        titleTypographyProps={{
          align: "center",
          variant: "h4",
        }}
      />

      <Table
        rows={rows}
        columns={columns}
        hiddenColumns={["index", "updatedAt"]}
        updateRow={updateRow}
        loading={loading}
      />
    </Card>
  )
}
