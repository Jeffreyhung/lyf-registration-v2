import { DataGridColumnAlign } from "@utils/registrationUtils"

describe("DataGridColumnAlign", () => {
  it("centres the header and the cells of a column", () => {
    expect(DataGridColumnAlign).toEqual({
      align: "center",
      headerAlign: "center",
      cellClassName: "centered-text-cell",
    })
  })
})
