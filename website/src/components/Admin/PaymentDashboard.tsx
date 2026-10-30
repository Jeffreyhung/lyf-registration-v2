import React from "react"
import { GridColDef } from "@mui/x-data-grid"
import { Button, Card, CardHeader, Stack } from "@mui/material"

// Components
import AuthContext from "@components/Auth/AuthContext"
import SnackbarAlertContext from "@components/SnackbarAlert/SnackbarAlertContext"
import Table from "@components/Table"

// Hooks
import usePayments from "@hooks/usePayments"

// Utils
import { DataGridColumnAlign } from "@components/Table"
import { ProdContext } from "@components/ProdContext"

type PaymentDashboardProps = {}

const columns: GridColDef[] = [
  {
    field: "customerName",
    headerName: "Name",
    minWidth: 75,
    flex: 0.5,
    ...DataGridColumnAlign,
  },
  {
    field: "customerEmail",
    headerName: "Email",
    minWidth: 200,
    flex: 0.5,
    ...DataGridColumnAlign,
  },
  {
    field: "customerId",
    headerName: "Customer Stripe ID",
    minWidth: 75,
    ...DataGridColumnAlign,
  },
  {
    field: "stripeId",
    headerName: "Payment Stripe ID",
    minWidth: 75,
    ...DataGridColumnAlign,
  },
  {
    field: "createdAt",
    headerName: "Created At",
    type: "dateTime",
    width: 150,
    ...DataGridColumnAlign,
  },
  {
    field: "donation",
    headerName: "Donation",
    type: "number",
    width: 75,
    ...DataGridColumnAlign,
  },
  // Need to add items
  {
    field: "total",
    headerName: "Total",
    type: "number",
    width: 75,
    ...DataGridColumnAlign,
  },
]

export default function PaymentDashboard({}: PaymentDashboardProps) {
  const { isAdmin, adminRole } = React.useContext(AuthContext)
  const { firestore } = React.useContext(ProdContext)
  const [data, loading, error] = usePayments({ isAdmin, adminRole, firestore })

  // We want most recent payments first. Sorted on a copy (the hook's array is
  // memoised and shared) and only when a new snapshot arrives.
  const rows = React.useMemo(
    () =>
      [...data]
        .sort(
          (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)
        )
        .map((payment, index) => ({
          id: index.toString(),
          customerName: payment.customerName ?? "",
          customerEmail: payment.customerEmail ?? "",
          customerId: payment.customerId ?? "",
          donation: payment.donation ?? 0,
          total: payment.total ?? 0,
          stripeId: payment.stripeId ?? "",

          createdAt: payment.createdAt?.toDate() ?? new Date(0),
        })),
    [data]
  )

  // Eventually want to make this a dashboard that contains charts for payments and donations.
  return (
    <Card>
      <CardHeader
        title="All Payments"
        titleTypographyProps={{
          align: "center",
          variant: "h4",
        }}
      />
      <Table rows={rows} columns={columns} loading={loading} pageSize={100} />
    </Card>
  )
}
