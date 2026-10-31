import * as admin from "firebase-admin"
import {Registration} from "lyf-registration-schemas"

import {writeOutput} from "./utils"

// Initialize the firebase Admin SDK so we can perform operations
admin.initializeApp()
const db = admin.firestore()

async function addWaitlistTime() {
  console.log("Adding waitlist time to registrations...")

  const registrations = await db
    .collection("camps")
    .doc("2025")
    .collection("registrations")
  const waitlistRegs = await registrations
    .where("status", "==", "Waitlist")
    .get()

  console.log(`Found ${waitlistRegs.size} registrations.`)

  const createTimes: string[] = []
  const updateTimes: string[] = []

  await Promise.all(
    waitlistRegs.docs.map(async (reg) => {
      const data = reg.data() as Registration
      const camperName = data.camperName
      const createTime = data.createdAt
      const updateTime = reg.updateTime

      const waitlistTime = camperName === "Lucas Ho" ? createTime : updateTime

      createTimes.push(
        `${camperName}\t${createTime?.seconds}\t${createTime
          ?.toDate()
          .toString()}`
      )
      updateTimes.push(`${camperName}\t${waitlistTime?.seconds}`)

      // Assume that the last time the registration was updated was when the
      // parent completed registration
      reg.ref.update({
        waitlistTime: waitlistTime,
      })
    })
  )

  writeOutput("createTimes.txt", createTimes.join("\n"))
  writeOutput("updateTimes.txt", updateTimes.join("\n"))
}

addWaitlistTime()
  .then(() => console.log("Finished updating waitlist campers"))
  .catch((err) => console.log(`Failed to update waitlist campers. ${err}`))
