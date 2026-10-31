import * as admin from "firebase-admin"

// Initialize the firebase Admin SDK so we can perform operations
admin.initializeApp()
const db = admin.firestore()

async function main() {
  console.log("Combining pre-registrations with registrations...")

  const registrationDocs = await db
    .collection("camps")
    .doc("2023")
    .collection("registrations")
    .get()

  // Get every pre-registration
  // Going to have to go to camper anyways so no need to get all the registrations
  // Check if there's a proper full registration
  // Mark the full registration as Active and print out the ones that weren't so I know to check them
  // Ensure grade is the same
  // Oh wait going to have to go through every registration and change isPreRegistration to isPreRegistered
  // Add a preRegistrationTime? We won't have this for 2023
  const registrations: admin.firestore.QueryDocumentSnapshot<admin.firestore.DocumentData>[] =
    []
  const preRegistrations: admin.firestore.QueryDocumentSnapshot<admin.firestore.DocumentData>[] =
    []
  registrationDocs.forEach((reg) => {
    if (!!reg.data().isPreRegistration) {
      preRegistrations.push(reg)
    } else {
      registrations.push(reg)
    }
  })
  console.log(`Preregistrations: ${preRegistrations.length}`)
  console.log(`Registrations: ${registrations.length}`)

  // Go through every registration and do the following:
  // 1. Change isPreRegistration to isPreRegistered
  // 2. Check if there's a corresponding pre-registration. If so then,
  //   a. Remove the pre-registration
  //   b. Set isPreRegistered for the full registration to true
  //   c. Remove the pre-registration reference from the camper

  await Promise.all(
    registrations.map(async (reg) => {
      const regData = reg.data()
      const camperName= regData.camperName as string

      const camperRef = regData.camper as admin.firestore.DocumentReference
      const preReg = preRegistrations.find(
        (reg) => reg.data().camper.path == camperRef.path
      )

      // We found a corresponding pre-registration
      if (preReg != undefined) {
        console.log(`Pre-reg found for ${camperName}`)

        // Go to the camper and remove the now defunct prereg reference
        console.log(`--Removing reg with id: ${preReg.ref.id}`)
        await camperRef.update({
          registrations: admin.firestore.FieldValue.arrayRemove(preReg.ref),
        })
        await preReg.ref.delete()
        if (preReg.data().grade !== regData.grade) {
          console.log(`--Grades did not match up for ${camperName}`)
        }

        if (regData.status !== 'Active') {
          console.log(`*******${camperName}: ${regData.status}`)
        }
      } else {
        console.log(
          `No corresponding pre-reg found for: ${camperName}`
        )
      }

      const {isPreRegistration, ...rest} = regData
      await reg.ref.set({
        ...rest,
        isPreRegistered: !!preReg,
      })
    })
  )
}

main()
  .then(() => console.log("Finished editing"))
  .catch((err) => console.log(`Failed to edit. ${err}`))
