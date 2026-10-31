import { csvCell, toCsv } from "@utils/csv"

describe("csvCell", () => {
  it("renders null and undefined as empty cells", () => {
    expect(csvCell(null)).toBe("")
    expect(csvCell(undefined)).toBe("")
  })

  it("stringifies non-string values", () => {
    expect(csvCell(12)).toBe("12")
    expect(csvCell(false)).toBe("false")
  })

  it("leaves plain text alone", () => {
    expect(csvCell("Jane Doe")).toBe("Jane Doe")
  })

  it("prefixes cells a spreadsheet would evaluate as a formula", () => {
    expect(csvCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)")
    expect(csvCell("+1")).toBe("'+1")
    expect(csvCell("-1")).toBe("'-1")
    expect(csvCell("@cmd")).toBe("'@cmd")
    expect(csvCell("\tx")).toBe("'\tx")
  })

  it("quotes cells containing commas, quotes or newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"')
    expect(csvCell("line1\r\nline2")).toBe('"line1\r\nline2"')
  })

  it("applies the formula guard before quoting", () => {
    expect(csvCell("=1,2")).toBe("\"'=1,2\"")
  })
})

describe("toCsv", () => {
  it("writes the header row then each row, CRLF separated", () => {
    expect(
      toCsv({
        headers: ["a", "b"],
        rows: [
          [1, null],
          ["x,y", "z"],
        ],
      })
    ).toBe('a,b\r\n1,\r\n"x,y",z')
  })

  it("writes only the header row for an empty table", () => {
    expect(toCsv({ headers: ["Email", "Name"], rows: [] })).toBe("Email,Name")
  })
})
