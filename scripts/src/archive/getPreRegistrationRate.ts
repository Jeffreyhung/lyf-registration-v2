import * as admin from "firebase-admin"
import * as fs from "fs"
import {DocumentReference} from "firebase-admin/firestore"

const CURRENT_YEAR = 2025
const OLDEST_GROUP_SIZE = 11

// Initialize the firebase Admin SDK so we can perform operations
admin.initializeApp()
const db = admin.firestore()

async function getPreRegEmails() {
  console.log("Getting campers...")

  // Get all the active registrations from this year
  const registrations = db
    .collection("camps")
    .doc(CURRENT_YEAR.toString())
    .collection("registrations")
  const activeReg = await registrations.where("status", "==", "Active").get()

  console.log(`Found ${activeReg.size} registrations.`)
  const validRegs = activeReg.size - OLDEST_GROUP_SIZE

  const notYetPreRegCampers: string[] = []
  let numPreRegCampers = 0
  await Promise.all(
    activeReg.docs.map(async (reg) => {
      const camperRef = reg.data().camper as admin.firestore.DocumentReference
      const camper = await camperRef.get()
      const camperData = camper.data()
      const registrations = camperData?.registrations as DocumentReference[]
      const camperName = camperData
        ? `${camperData["firstName"]} ${camperData["lastName"]}`
        : `Camper not found`

      // We're assuming here that as long as the next year exists, they at least pre-registered.
      // This assumption only works when it's still the current year's pre-registration time.
      const hasNextYearReg = registrations.some((reg) =>
        reg.path.includes((CURRENT_YEAR + 1).toString())
      )

      if (hasNextYearReg) {
        numPreRegCampers++
      } else {
        notYetPreRegCampers.push(camperName)
      }
    })
  )

  console.log(`Found ${numPreRegCampers} pre-registered campers.`)
  console.log(
    `Pre-Registration rate is ${(numPreRegCampers / validRegs) * 100}%`
  )

  console.log("\n\nHere are the campers that haven't pre-registered yet:")
  console.log(notYetPreRegCampers.join("\n"))
  fs.writeFile(
    "output/notYetPreRegCampers.txt",
    notYetPreRegCampers.join("\n"),
    (err) => {
      if (err) throw err

      console.log("Finished writing to file.")
    }
  )
}

getPreRegEmails()
  .then(() => console.log("Finished getting campers"))
  .catch((err) => console.log(`Failed to get campers. ${err}`))
