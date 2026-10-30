import React from "react"
import { Card, CardHeader } from "@mui/material"
import { GridColDef, GridRowModel } from "@mui/x-data-grid"
import { serverTimestamp, updateDoc } from "firebase/firestore"

import {
  RegistrationData,
  getParentNames,
  getParentEmails,
  getParentPhoneNumbers,
} from "@hooks/useRegistrations"
import { Table, DataGridColumnAlign } from "@components/Table"
import { RegistrationStatus } from "lyf-registration-schemas"

import { RowWithStatusAndNotes } from "./CancelStatusDialog"
import useFilterRegistrationStatus from "@hooks/useFilterRegistrationStatus"

type CamperCheckoutProps = {
  data: RegistrationData[]
  loading: boolean
  campYear: number
}

export interface CamperCheckoutRow extends RowWithStatusAndNotes {
  name: string
  status: string
  parentNames: string
  parentEmails: string
  isCheckedOut: boolean
  nameOfParentCheckedOut: string
  checkedOutTime: Date | undefined
  internalNotes: string
}

const columns: GridColDef[] = [
  {
    field: "name",
    headerName: "Name",
    minWidth: 130,
    maxWidth: 150,
    flex: 0.25,
    ...DataGridColumnAlign,
  },
  {
    field: "parentNames",
    headerName: "Parent Names",
    type: "string",
    minWidth: 150,
    maxWidth: 175,
    flex: 0.25,
    ...DataGridColumnAlign,
  },
  {
    field: "parentEmails",
    headerName: "Parent Emails",
    type: "string",
    minWidth: 150,
    maxWidth: 250,
    flex: 1,
    ...DataGridColumnAlign,
  },
  {
    field: "parentPhoneNumbers",
    headerName: "Parent Phone Numbers",
    type: "string",
    minWidth: 150,
    maxWidth: 200,
    flex: 1,
    ...DataGridColumnAlign,
  },
  {
    field: "isCheckedOut",
    headerName: "Is Checked Out?",
    type: "boolean",
    minWidth: 150,
    editable: true,
    ...DataGridColumnAlign,
  },
  {
    field: "nameOfParentCheckedOut",
    headerName: "Name of Parent Who Checked Out",
    type: "string",
    minWidth: 150,
    editable: true,
    ...DataGridColumnAlign,
  },
  {
    field: "checkedOutTime",
    headerName: "Checked Out At",
    type: "dateTime",
    width: 175,
    // @ts-expect-error I'm not sure what's the right type for GridColDef that includes nullable yet
    nullable: true,
    ...DataGridColumnAlign,
  },
  {
    field: "internalNotes",
    headerName: "Notes",
    editable: true,
    flex: 1,
    headerAlign: "center",
  },
]

export default function CamperCheckout({
  data,
  loading,
  campYear,
}: CamperCheckoutProps) {
  const [filteredData] = useFilterRegistrationStatus(data, [
    RegistrationStatus.ACTIVE,
  ])
  const registrationData = filteredData.sort((a, b) =>
    a.camperName.localeCompare(b.camperName)
  )

  const rows: CamperCheckoutRow[] = registrationData.map((reg, index) => ({
    id: index.toString(),
    index: index + 1,
    name: reg.camperName,
    status: reg.status,

    // Join the parent's names if they exist.
    parentNames: getParentNames(reg),
    // Join the parent's emails if they exist.
    parentEmails: getParentEmails(reg),
    // Join the parent's phone numbers if they exist.
    parentPhoneNumbers: getParentPhoneNumbers(reg),

    isCheckedOut: reg.isCheckedOut || false,
    nameOfParentCheckedOut: reg.nameOfParentCheckedOut || "",
    checkedOutTime: reg.checkedOutTime?.toDate(),
    internalNotes: reg.internalNotes,
  }))

  const updateRow = async (
    newRow: CamperCheckoutRow,
    newInternalNotes: string,
    newIsCheckedOut: boolean,
    newNameOfParentWhoCheckedOut: string
  ) => {
    const registrationRef = registrationData[newRow.index - 1].registrationRef
    await updateDoc(registrationRef, {
      internalNotes: newInternalNotes,
      isCheckedOut: newIsCheckedOut,
      nameOfParentCheckedOut: newNameOfParentWhoCheckedOut,
      updatedAt: serverTimestamp(),
      ...(newIsCheckedOut
        ? {
            checkedOutTime: newIsCheckedOut ? serverTimestamp() : undefined,
          }
        : {}),
    })
  }

  const updateRowPromise = async (
    newRow: GridRowModel<CamperCheckoutRow>,
    oldRow: GridRowModel<CamperCheckoutRow>
  ) =>
    new Promise<CamperCheckoutRow>((resolve, reject) => {
      if (
        newRow.internalNotes === oldRow.internalNotes &&
        newRow.isCheckedOut === oldRow.isCheckedOut &&
        newRow.nameOfParentCheckedOut === oldRow.nameOfParentCheckedOut
      ) {
        // Nothing changed so just resolve
        resolve(newRow)
        return
      }

      updateRow(
        newRow,
        newRow.internalNotes,
        newRow.isCheckedOut,
        newRow.nameOfParentCheckedOut
      )
        .then(() => resolve(newRow))
        .catch(() => reject(new Error("Failed to update row.")))
    })

  return (
    <>
      <Card>
        <CardHeader
          title={`${campYear} LYF Camp Camper Checkout`}
          titleTypographyProps={{
            align: "center",
            variant: "h4",
          }}
        />
        <Table
          rows={rows}
          columns={columns}
          loading={loading}
          pageSize={100}
          updateRow={updateRowPromise}
          hiddenColumns={["createdAt"]}
        />
      </Card>
    </>
  )
}
