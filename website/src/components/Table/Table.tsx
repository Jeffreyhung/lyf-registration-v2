import React from "react"
import {
  GridColDef,
  DataGrid,
  GridToolbar,
  GridToolbarProps,
  ToolbarPropsOverrides,
  GridRowModel,
  GridValidRowModel,
  GridCellModes,
  GridCellModesModel,
  GridCellParams,
  GridRowSelectionModel,
} from "@mui/x-data-grid"

// Components
import { SnackbarAlertContext } from "@components/SnackbarAlert"

export const DataGridColumnAlign: Pick<
  GridColDef,
  "align" | "headerAlign" | "cellClassName"
> = {
  align: "center",
  headerAlign: "center",
  cellClassName: "centered-text-cell",
}

export interface TableValidRow extends GridValidRowModel {
  id: string
  index: number
}

type TableProps<T extends TableValidRow> = {
  rows: GridRowModel<T>[]
  columns: GridColDef<T>[]
  hiddenColumns?: string[]
  loading: boolean
  updateRow?: (
    newRow: GridRowModel<T>,
    oldRow?: GridRowModel<T>
  ) => Promise<void> | Promise<T>
  pageSize?: number
  toolbar?: React.JSXElementConstructor<
    GridToolbarProps & ToolbarPropsOverrides
  >
  rowSelectionModel?: GridRowSelectionModel
  setRowSelectionModel?: (m: GridRowSelectionModel) => void
}

declare module "@mui/x-data-grid" {
  interface ToolbarPropsOverrides {
    rowSelection: GridRowSelectionModel
  }
}

export default function Table<T extends TableValidRow>({
  rows,
  columns,
  hiddenColumns = [],
  pageSize = 25,
  loading,
  updateRow,
  toolbar = GridToolbar,
  rowSelectionModel = [],
  setRowSelectionModel = () => {},
}: TableProps<T>) {
  // Handle updating the alert at the bottom of the page.
  const { setSnackbar } = React.useContext(SnackbarAlertContext)

  // Handle editing cell contents
  const handleProcessRowUpdateError = React.useCallback(
    (error: Error) => {
      setSnackbar({ children: error.message, severity: "error" })
    },
    [setSnackbar]
  )
  const processRowUpdate = updateRow
    ? async (newRow: GridRowModel<T>, oldRow: GridRowModel<T>) => {
        if (!newRow.index) {
          throw new Error(`Unable to find document for index: ${newRow.index}`)
        }

        setSnackbar({ severity: "info", children: "Syncing..." })

        // Call the passed in function to update the row.
        await updateRow(newRow, oldRow)

        setSnackbar({ severity: "success", children: "Changes saved" })
        return newRow
      }
    : undefined

  // See https://github.com/mui/mui-x/issues/2186
  const [cellModesModel, setCellModesModel] =
    React.useState<GridCellModesModel>({})

  const handleCellClick = React.useCallback(
    (params: GridCellParams, event: React.MouseEvent) => {
      if (!params.isEditable) {
        return
      }

      // Ignore portal
      if (!event.currentTarget.contains(event.target as Element)) {
        return
      }

      setCellModesModel((prevModel) => {
        return {
          // Revert the mode of the other cells from other rows
          ...Object.keys(prevModel).reduce(
            (acc, id) => ({
              ...acc,
              [id]: Object.keys(prevModel[id]).reduce(
                (acc2, field) => ({
                  ...acc2,
                  [field]: { mode: GridCellModes.View },
                }),
                {}
              ),
            }),
            {}
          ),
          [params.id]: {
            // Revert the mode of other cells in the same row
            ...Object.keys(prevModel[params.id] || {}).reduce(
              (acc, field) => ({
                ...acc,
                [field]: { mode: GridCellModes.View },
              }),
              {}
            ),
            [params.field]: { mode: GridCellModes.Edit },
          },
        }
      })
    },
    []
  )

  const handleCellModesModelChange = React.useCallback(
    (newModel: GridCellModesModel) => {
      setCellModesModel(newModel)
    },
    []
  )

  return (
    <DataGrid
      rows={rows}
      columns={columns}
      autoHeight
      getRowHeight={() => "auto"}
      loading={loading}
      processRowUpdate={processRowUpdate}
      onProcessRowUpdateError={handleProcessRowUpdateError}
      cellModesModel={cellModesModel}
      onCellModesModelChange={handleCellModesModelChange}
      onCellClick={handleCellClick}
      disableRowSelectionOnClick
      checkboxSelection={toolbar !== GridToolbar}
      onRowSelectionModelChange={(m) => setRowSelectionModel(m)}
      rowSelectionModel={rowSelectionModel}
      slots={{ toolbar: toolbar }}
      slotProps={{ toolbar: { rowSelection: rowSelectionModel } }}
      sx={{
        "& .centered-text-cell": {
          textAlign: "center",
        },
      }}
      initialState={{
        pagination: {
          paginationModel: {
            pageSize: pageSize,
          },
        },
        columns: {
          columnVisibilityModel: hiddenColumns.reduce(
            (obj, col) => Object.defineProperty(obj, col, { value: false }),
            {}
          ),
        },
      }}
    />
  )
}
