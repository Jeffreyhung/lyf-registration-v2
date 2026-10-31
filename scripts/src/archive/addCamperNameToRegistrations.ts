import * as admin from "firebase-admin"

// Initialize the firebase Admin SDK so we can perform operations
admin.initializeApp()
const db = admin.firestore()

async function getPreRegEmails() {
  console.log("Adding camper name to registrations...")

  const registrations = await db.collectionGroup("registrations").get()
  console.log(`Found ${registrations.size} registrationss.`)

  await Promise.all(
    registrations.docs.map(async (reg) => {
      const camperRef = reg.data().camper as admin.firestore.DocumentReference
      const camper = await camperRef.get()
      const camperData = camper.data()
      if (!camperData) {
        console.error(`Camper not found for reg ID ${reg.ref.path}`)
      }
      const camperName = camperData ? `${camperData["firstName"]} ${camperData["lastName"]}` : `Camper not found`

      reg.ref.update({
        camperName: camperName
      })
    })
  )
}

getPreRegEmails()
  .then(() => console.log("Finished getting campers"))
  .catch((err) => console.log(`Failed to get campers. ${err}`))
