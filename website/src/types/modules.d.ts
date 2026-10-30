// Packages that ship neither their own declarations nor an @types package.
// Only the members the website uses are declared.

declare module "file-saver" {
  export function saveAs(
    data: Blob | string,
    filename?: string,
    options?: { autoBom?: boolean }
  ): void
}

declare module "@nodeguy/server-date" {
  export type ServerDate = {
    date: Date
    offset: number
    uncertainty: number
  }
  export function getServerDate(options?: { url?: string }): Promise<ServerDate>
}
