import React from "react"
import { GridColDef } from "@mui/x-data-grid"
import { Card, CardHeader } from "@mui/material"

// Components
import AuthContext from "@components/Auth/AuthContext"
import Table from "@components/Table"

// Hooks
import usePayments from "@hooks/usePayments"

// Utils
import { DataGridColumnAlign } from "@components/Table"
import { ProdContext } from "@components/ProdContext"

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

export default function PaymentDashboard() {
  const { isAdmin, adminRole } = React.useContext(AuthContext)
  const { firestore } = React.useContext(ProdContext)
  const [data, loading] = usePayments({ isAdmin, adminRole, firestore })

  // We want most recent payments first
  const sortedData = data.sort(
    (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)
  )

  const rows = sortedData.map((payment, index) => ({
    id: index.toString(),
    customerName: payment.customerName ?? "",
    customerEmail: payment.customerEmail ?? "",
    customerId: payment.customerId ?? "",
    donation: payment.donation ?? 0,
    total: payment.total ?? 0,
    stripeId: payment.stripeId ?? "",

    createdAt: payment.createdAt?.toDate() ?? new Date(0),
  }))

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
