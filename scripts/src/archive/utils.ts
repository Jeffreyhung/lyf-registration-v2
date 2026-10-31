import {appendFile, writeFile} from "fs"

export function appendToOutput(filename: string, content: string) {
  appendFile(`output/${filename}`, content, (err) => {
    if (err) {
      console.error(err)
    }
  })
}

export function writeOutput(filename: string, content: string) {
  writeFile(`output/${filename}`, content, (err) => {
    console.log(`Finished writing to file ${filename}`)
    if (err) {
      console.error(err)
      throw err
    }
  })
}
