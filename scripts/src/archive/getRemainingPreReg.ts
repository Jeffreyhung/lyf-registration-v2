import * as admin from "firebase-admin"
import * as fs from "fs"

// Initialize the firebase Admin SDK so we can perform operations
admin.initializeApp()
const db = admin.firestore()

// This is with the separate isPreReg registrations. I want to get rid of this and consolidate those
// registrations into one.

async function main() {
  console.log("Getting remaining pre-reg emails...")

  const registrations = db
    .collection("camps")
    .doc("2024")
    .collection("registrations")
  const preRegs = await registrations
    .where("isPreRegistered", "==", true)
    .get()

  const campers: string[] = []
  const allEmails: string[] = []
  await Promise.all(
    preRegs.docs.map(async (reg) => {
      const regData = reg.data()

      // Ignore cancelled pre-regs
      if (regData.status === "Cancelled" || regData.status === "Active") {
        return
      }

      const camperRef = regData.camper as admin.firestore.DocumentReference
      const camper = await camperRef.get()
      const camperRegistrations = (camper.data() as any)
        .registrations as admin.firestore.DocumentReference[]

      // This reduce functions counts the number of times we see a registration that starts
      // with /camps/2023 to see if we have multiple registrations for 2023.
      // If we find multiple registrations, then that means the camper has also registered for camp.
      if (
        camperRegistrations.reduce(
          (accumulator, currentValue) =>
            currentValue.path.startsWith("camps/2024")
              ? accumulator + 1
              : accumulator,
          0
        ) > 1
      ) {
        return
      }

      const family = await camperRef.parent.parent?.get()
      const familyData = family?.data()
      if (familyData == undefined) {
        throw `No family found for camper.`
      }

      const parents = await family?.ref.collection("parents").listDocuments() ?? []
      let parentNames: string[] = []
      await Promise.all(parents?.map(async (parent) => {
        const data = (await parent.get()).data()
        if (!data) {
          return
        }
        parentNames.push(`${data.firstName} ${data.lastName} <${data.email}>`)
      }))

      const emails = familyData.emails as string[]
      campers.push(`${regData.camperName}: ${parentNames.join(", ")}`)
      emails.forEach((e) => allEmails.push(e))
    })
  )

  fs.writeFile("output/preRegEmails.txt", allEmails.join(", "), (err) => {
    if (err) throw err

    console.log("Finished writing to file.")
  })

  fs.writeFile("output/remainingPreRegCampers.txt", campers.join("\n"), (err) => {
    if (err) throw err

    console.log("Finished writing to file.")
  })
}

main()
  .then(() => console.log("Finished getting emails"))
  .catch((err) => console.log(`Failed to get emails. ${err}`))
