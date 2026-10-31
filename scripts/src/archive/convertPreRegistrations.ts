import * as admin from "firebase-admin"

// Initialize the firebase Admin SDK so we can perform operations
admin.initializeApp()
const db = admin.firestore()

async function main() {
  console.log("Converting remaining isPreRegistration to isPreRegistered...")

  const preRegistrations = await db
    .collection("camps")
    .doc("2023")
    .collection("registrations")
    .where("isPreRegistration", "==", true)
    .get()

  console.log(`Preregistrations: ${preRegistrations.size}`)

  // Go through every registration and do the following:
  // 1. Change isPreRegistration to isPreRegistered
  // 2. Check if there's a corresponding pre-registration. If so then,
  //   a. Remove the pre-registration
  //   b. Set isPreRegistered for the full registration to true
  //   c. Remove the pre-registration reference from the camper

  await Promise.all(
    preRegistrations.docs.map(async (reg) => {
      const regData = reg.data()
      const camperName= regData.camperName as string

      console.log(`Converting ${camperName}`)
      if (regData.status !== "Cancelled") {
        console.log(`----${camperName} status was ${regData.status}`)
      }

      const {isPreRegistration, ...rest} = regData
      await reg.ref.set({
        ...rest,
        isPreRegistered: true,
      })
    })
  )
}

main()
  .then(() => console.log("Finished editing"))
  .catch((err) => console.log(`Failed to edit. ${err}`))
