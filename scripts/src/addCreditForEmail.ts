import * as admin from "firebase-admin"
import {firestore} from "firebase-admin"

// Initialize the firebase Admin SDK so we can perform operations
admin.initializeApp()
const db = admin.firestore()

type Credit = {
  email: string
  amount: number
  note: string[]
}

const creditsToAdd: Credit[] = [
  {
    email: "kath.rai@gmail.com",
    amount: 520,
    note: [
      "+1520: 2022 - Mila Rai, Mikayla Feng Cancellation",
      "-500: 2023 Pre-Reg Mila Rai",
      "-500: 2023 Pre-Reg Mikayla Feng",
    ],
  },
  {
    email: "reihsuu@hotmail.com",
    amount: 240,
    note: ["+740: 2022 - Isaac Liew Cancellation", "-500: 2023 Pre-Reg Isaac Liew"],
  },
  {
    email: "chenchenwu@gmail.com",
    amount: 0,
    note: ["+775: 2022 - Maxwell Chen, Rosalind Chen Cancellation", "-500: 2023 Pre-Reg Maxwell Chen", "-225: 2023 Partial Pre-Reg Rosalind Chen"],
  },
  {
    email: "yayasf@gmail.com",
    amount: 260,
    note: ["+760: 2022 - Griffin Yim Cancellation", "-500: 2023 Pre-Reg Griffin Yim"],
  },
  {
    email: "lenakuo@gmail.com",
    amount: 0,
    note: ["+400: 2022 - Jules Kuo-Gurton Cancellation", "-400: 2023 Partial Pre-Reg Jules Kuo-Gurton"]
  },
  // Older
  {
    email: "kaihuei.chou@gmail.com",
    amount: 360,
    note: ["+360: Stanley Ko"],
  },
  {
    email: "swu1259@gmail.com",
    amount: 720,
    note: ["+720: Jonathan Wu"],
  },
  {
    email: "mom4yangjr@yahoo.com",
    amount: 740,
    note: ["+740: Naomi Yang"],
  },
  {
    email: "tinaalamo@yahoo.com",
    amount: 600,
    note: ["+600: Devin Chang"],
  },
  {
    email: "asgurskis@yahoo.com",
    amount: 40,
    note: ["+40: 2019 - Aidan, Aeron, Orion Gurskis"],
  },
  {
    email: "pauline.liang@gmail.com",
    amount: 720,
    note: ["+720: Naomi Lin"],
  },
  {
    email: "dinasourandy@yahoo.com",
    amount: 720,
    note: ["+720: Anthony Ho"],
  },
  {
    email: "sophietseng1618@gmail.com",
    amount: 720,
    note: ["+720: Brandon Chen, Ashley Chen"],
  },
  {
    email: "mimichen2000@comcast.net",
    amount: 1080,
    note: ["+1080: Jeffae Schroff, Jerrae Schroff, Jettae Schroff"],
  },
  {
    email: "jessicaleelai@yahoo.com",
    amount: 740,
    note: ["+740: Samantha Lai"],
  },
  {
    email: "jessiyu@yahoo.com",
    amount: 700,
    note: ["+700: Connor Dong, Ashley Dong"],
  },
  {
    email: "wunchica@gmail.com",
    amount: 370,
    note: ["+370: Lori Liu"],
  },
  {
    email: "amychou@gmail.com",
    amount: 760,
    note: ["+760: Megan Wu"],
  },
  {
    email: "kathyandfelix@gmail.com",
    amount: 700,
    note: ["+700: Keria, Bryce, Elle Lin"],
  },
  {
    email: "sylviatseng1@gmail.com",
    amount: 400,
    note: ["+400: Aidan Tseng, Kira Tseng"],
  },
  {
    email: "elysemaxlin@gmail.com",
    amount: 400,
    note: ["+400: Max Lin"],
  },
]

async function addCreditForEmail() {
  console.log("Adding credits...")

  const skipped: string[] = []

  // Sequential so every lookup finishes (and every failure is reported)
  // before the script exits.
  for (const {email, amount, note} of creditsToAdd) {
    const family = await db
      .collection("families")
      .where("emails", "array-contains", email)
      .get()

    if (family.empty) {
      console.log(`SKIPPED ${email}: no family lists this email`)
      skipped.push(email)
      continue
    }

    // An email can legitimately be listed in more than one family (listed by
    // someone else and in their own). Never guess which one gets the credit.
    if (family.size > 1) {
      const ids = family.docs.map((d) => d.id).join(", ")
      console.log(
        `SKIPPED ${email}: listed in ${family.size} families (${ids}); resolve manually`
      )
      skipped.push(email)
      continue
    }

    const familyRef = family.docs[0].ref
    // We use the same familyId for the credit so we know to link it back.
    const creditRef = db.collection("credits").doc(familyRef.id)

    await creditRef.set(
      {
        amountRemaining: firestore.FieldValue.increment(amount),
        notes: firestore.FieldValue.arrayUnion(...note),
        family: familyRef,
      },
      {merge: true}
    )
    console.log(`Added ${amount} credit to family ${familyRef.id} (${email})`)
  }

  if (skipped.length > 0) {
    console.log(`\n${skipped.length} email(s) skipped: ${skipped.join(", ")}`)
  }
}

addCreditForEmail()
  .then(() => console.log("Finished adding credits"))
  .catch((err) => console.log(`Finished adding credits. ${err}`))
