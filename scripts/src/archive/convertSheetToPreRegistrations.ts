import * as admin from "firebase-admin"
import * as fs from "fs"
import {
  DocumentReference,
  WriteBatch,
  FieldValue,
} from "firebase-admin/firestore"
import * as mailchimp from "@mailchimp/mailchimp_marketing"
import * as md5 from "md5"

import {
  Camper,
  Payment,
  Registration,
  RegistrationStatus,
} from "lyf-registration-schemas"

const IS_PROD = false
const IS_DEBUG = false
const NEXT_CAMP_YEAR = 2025

// Initialize the firebase Admin SDK so we can perform operations
admin.initializeApp()
const db = admin.firestore()

// Initialize mailchimp
// Copied from functions/src/utils/mailchimp.ts
mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY as string,
  server: process.env.MAILCHIMP_SERVER as string,
});

export enum MailchimpList {
  GENERAL = "2bd94e4a2c",
  PRE_REG = "0fc22524d1",
  REGISTERED = "7e35c51f18",
}

type MailchimpUser = {
  firstName: string
  lastName: string
}

/********************
 * Helper Functions *
 ********************/

function debugLog(message?: string, ...optionalParams: any[]) {
  if (IS_DEBUG) {
    console.log(message, ...optionalParams)
  }
}

async function updateSmallGroup(
  batch: WriteBatch,
  pastRegistrationRef: DocumentReference<Registration>,
  smallGroup: string
) {
  debugLog(
    `Updating small group for ${pastRegistrationRef.id} to ${smallGroup}`
  )
  batch.set(
    pastRegistrationRef,
    {
      smallGroup: smallGroup,
    },
    {
      merge: true,
    }
  )
}

function createPayment(
  batch: WriteBatch,
  newPreRegistrationRef: DocumentReference<Registration>,
  camperName: string,
  stripePaymentId: string,
  stripeCustomerId: string,
  donationAmountStr: string
): DocumentReference<Payment> {
  const donationAmount =
    donationAmountStr.length > 0 ? parseFloat(donationAmountStr) : 0.0

  const paymentRef = db
    .collection("payments")
    .doc(stripePaymentId) as DocumentReference<Payment>
  batch.set(
    paymentRef,
    {
      createdAt: FieldValue.serverTimestamp(),
      customerId: stripeCustomerId ?? null,

      donation: FieldValue.increment(donationAmount),
      items: FieldValue.arrayUnion({
        amount: 500,
        description: `TACL LYF Camp 2025 Pre-Registration: ${camperName}`,
      }),

      paymentMethod: "card",
      registrations: FieldValue.arrayUnion(newPreRegistrationRef),
      status: "paid",

      stripeId: stripePaymentId,

      total: FieldValue.increment(donationAmount + 500),
      type: "Stripe tap-to-pay",

      updatedAt: FieldValue.serverTimestamp(),
    },
    {
      merge: true,
    }
  )

  // Add the payment to the pre-registration for refund purposes.
  batch.set(
    newPreRegistrationRef,
    {
      payments: FieldValue.arrayUnion(paymentRef),
    },
    {merge: true}
  )

  debugLog(`Created payment ${paymentRef.path} for ${camperName}`)

  return paymentRef
}

function addParentAndEmailToMap(
  parentMap: Map<string, MailchimpUser>,
  parentNames: string,
  parentEmails: string
) {
  const splitParentNames = parentNames.split(",").map((s) => s.trim())
  const splitParentEmails = parentEmails
    .split(",")
    .map((s) => s.trim().toLowerCase())
  splitParentNames.forEach((firstAndLastNameString, i) => {
    const firstAndLastNameSplit = firstAndLastNameString.split(" ")

    parentMap.set(splitParentEmails[i], {
      firstName: firstAndLastNameSplit[0],
      lastName: firstAndLastNameSplit.at(-1) ?? firstAndLastNameSplit[1],
    })
  })
}

async function addParentsToMailchimp(parentMap: Map<string, MailchimpUser>) {
  await Promise.all(
    Array.from(parentMap.entries()).map(async ([email, parent], i) => {
      const hashedEmail = md5(email)
      await setTimeout(async () => {
      // Create the user if it doesn't exist
      debugLog(`Adding email ${email}`)
      try {
        await mailchimp.lists.setListMember(
          MailchimpList.PRE_REG,
          hashedEmail,
          {
            email_address: email,
            merge_fields: {
              FNAME: parent.firstName,
              LNAME: parent.lastName,
            },
            status_if_new: "subscribed",
            status: "subscribed",
          }
        )
      } catch (e) {
        console.log(`Failed to add ${email} with error ${e}`)
      }

      try {
        await mailchimp.lists.updateListMemberTags(
          MailchimpList.PRE_REG,
          hashedEmail,
          {
            tags: [
              {
                name: `${NEXT_CAMP_YEAR}PreReg`,
                status: "active",
              },
            ],
          }
        )
      } catch (e) {
        console.log(`Failed to add tag for ${email} with error ${e}`)
      }
      }, 300 * i)


    })
  )
}

/************************************************************************
 *** Main function to read the sheet and perform each individual step ***
 ***********************************************************************/
async function convertSheetToPreRegistrations() {
  console.log("Starting to convert sheet")
  // Parse the sheet
  const fileContents = fs.readFileSync("data/2025prereg.tsv", "utf-8")
  const splitByLine = fileContents.split(/\r?\n/)
  const nextYearCampRegistrations = db.collection(
    `camps/${NEXT_CAMP_YEAR}/registrations`
  )
  const linesToProcess = splitByLine.slice(24)
  const batch = db.batch()
  const parentMap = new Map<string, MailchimpUser>()

  await Promise.all(
    linesToProcess.map(async (line) => {
      const [
        isPreRegisteredString,
        firstName,
        lastName,
        pastRegistrationRefString,
        camperRefString,
        smallGroup,
        gradeStr,
        birthday,
        parentNames,
        parentEmails,
        notes,
        donationAmountStr,
        stripePaymentId,
        stripeCustomerId,
      ] = line.split("\t").map((s) => s.trim())
      const camperName = `${firstName} ${lastName}`

      debugLog(`Processing line for ${camperName}`)

      const isPreRegistered = isPreRegisteredString === "TRUE"
      const camperRef = db.doc(camperRefString) as DocumentReference<Camper>
      const pastRegistrationRef = db.doc(
        pastRegistrationRefString
      ) as DocumentReference<Registration>
      const grade = parseInt(gradeStr)

      // For every camper, we need to update their small group assignment so we're co-opting this script to do that.
      updateSmallGroup(batch, pastRegistrationRef, smallGroup)

      // Now process the pre-registration if applicable. Otherwise, skip the rest of the logic here
      if (!isPreRegistered) {
        return
      }

      // Create the new pre-registration and associate any payments to it.
      const newPreRegistrationRef = nextYearCampRegistrations.doc(camperRef.id)

      // Add pre-registration
      debugLog(
        `Adding pre-registration ${newPreRegistrationRef.path} for ${camperName}`
      )
      batch.set(
        newPreRegistrationRef,
        {
          amountPaid: 500,
          camperName: camperName,
          camper: camperRef,

          grade: grade + 1,
          isPreRegistered: true,
          status: RegistrationStatus.PARTIAL_PAYMENT,
          isReturning: true, // assumption that anyone who is coming from this list attended camp this year

          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),

          internalNotes: notes,
        },
        {
          merge: true,
        }
      )

      // Add the new pre-registration to their camper's list of registrations
      debugLog(
        `Adding pre-reg to camper's registrations ${camperRef.path} for ${camperName}`
      )
      batch.set(
        camperRef,
        {
          registrations: FieldValue.arrayUnion(newPreRegistrationRef),
        },
        {
          merge: true,
        }
      )

      if (isPreRegistered && stripePaymentId.length > 0) {
        createPayment(
          batch,
          newPreRegistrationRef,
          camperName,
          stripePaymentId,
          stripeCustomerId,
          donationAmountStr
        )
      }

      // Add the parent emails to the mailchimp pre-registration list
      addParentAndEmailToMap(parentMap, parentNames, parentEmails)
    })
  )

  if (IS_PROD) {
    await batch.commit()
    await addParentsToMailchimp(parentMap)
  }
}

convertSheetToPreRegistrations()
  .then(() => console.log("Finished converting sheet"))
  .catch((err) => console.log(`Failed to convert sheet.\n${err}`))
