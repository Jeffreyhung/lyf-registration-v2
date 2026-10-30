import * as admin from "firebase-admin"

// Initialize the firebase Admin SDK so we can perform operations
admin.initializeApp()
const db = admin.firestore()

async function main() {
  console.log("Adding camper name to registrations...")

  const registrations = await db.collectionGroup("registrations").get()

  await Promise.all(
    registrations.docs.map(async (reg) => {
      await reg.ref.update({
        createdAt: reg.createTime,
        // On additional runs, we don't want to update the updateTime because the document metadata has already been modified.
        // updatedAt: reg.createTime, 
      })

      const camperRef = reg.data().camper as admin.firestore.DocumentReference
      await camperRef.update({
        registrations: admin.firestore.FieldValue.arrayUnion(reg.ref)
      })
    })
  )
}

main()
  .then(() => console.log("Finished editing"))
  .catch((err) => console.log(`Failed to edit. ${err}`))
