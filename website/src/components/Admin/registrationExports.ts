// One-click exports for the All Registrations grid. Each one is the dashboard
// version of a retired Admin SDK script in scripts/src (getCamperAddress,
// getActiveRegEmails, getPreRegEmails, getPreRegCampers, getActiveCamperInfo,
// getParentEmailsForCamper). They are built from every registration loaded for
// the camp year, so they ignore whatever filters the grid currently has.
import dayjs from "dayjs"

import {
  RegistrationData,
  getParentEmails,
  getParentNames,
} from "@hooks/useRegistrations"
import { CsvTable } from "@utils/csv"
import { RegistrationStatus } from "lyf-registration-schemas"

export type QuickExportOptions = {
  // Health columns are only included for roles that can read them; for other
  // roles the fields are never loaded, so the columns would just be blank.
  canReadHealth: boolean
}

export type QuickExport = {
  id: string
  // Menu label.
  label: string
  // Used in the README and the help tooltip.
  description: string
  // Middle part of the file name: <year>-lyf-<fileSuffix>-<date>.csv
  fileSuffix: string
  build: (
    registrations: RegistrationData[],
    options: QuickExportOptions
  ) => CsvTable
}

type Contact = { email: string; firstName: string; lastName: string }

const isActive = (reg: RegistrationData) =>
  reg.status === RegistrationStatus.ACTIVE

const isPreRegistered = (reg: RegistrationData) => !!reg.isPreRegistered

export const camperName = (reg: RegistrationData) =>
  reg.camperName || [reg.firstName, reg.lastName].filter(Boolean).join(" ")

const byCamperName = (a: RegistrationData, b: RegistrationData) =>
  camperName(a).localeCompare(camperName(b))

const familyEmails = (reg: RegistrationData) => reg.familyData?.emails ?? []

const yesNo = (value: boolean | undefined) => (value ? "yes" : "no")

/**
 * Every email we know for the families behind these registrations: each
 * parent's own email plus the family's account emails (the list the old
 * scripts exported), deduplicated case-insensitively. Names are filled in
 * where a parent document provides them.
 */
export function collectContacts(registrations: RegistrationData[]): Contact[] {
  const contacts = new Map<string, Contact>()
  const add = (email: string, firstName = "", lastName = "") => {
    const key = email.trim().toLowerCase()
    if (!key) return
    const existing = contacts.get(key)
    if (!existing) {
      contacts.set(key, { email: email.trim(), firstName, lastName })
    } else if (!existing.firstName && !existing.lastName) {
      existing.firstName = firstName
      existing.lastName = lastName
    }
  }

  registrations.forEach((reg) => {
    reg.parents.forEach((parent) => {
      if (parent.email) {
        add(parent.email, parent.firstName ?? "", parent.lastName ?? "")
      }
    })
    familyEmails(reg).forEach((email) => add(email))
  })

  return Array.from(contacts.values()).sort((a, b) =>
    a.email.localeCompare(b.email)
  )
}

const contactsTable = (registrations: RegistrationData[]): CsvTable => ({
  headers: ["Email", "First Name", "Last Name"],
  rows: collectContacts(registrations).map((c) => [
    c.email,
    c.firstName,
    c.lastName,
  ]),
})

export const QUICK_EXPORTS: QuickExport[] = [
  {
    id: "active-addresses",
    label: "Active camper mailing addresses",
    description:
      "One row per Active registration with the camper, parent names and the family's street, suite, city, state, zip and country.",
    fileSuffix: "active-addresses",
    build: (registrations) => ({
      headers: [
        "Camper",
        "Parent Names",
        "Street",
        "Suite / Apt",
        "City",
        "State",
        "Zip",
        "Country",
      ],
      rows: registrations
        .filter(isActive)
        .sort(byCamperName)
        .map((reg) => [
          camperName(reg),
          getParentNames(reg).replace(/,\n/g, ", "),
          reg.familyData?.street ?? "",
          reg.familyData?.suite ?? "",
          reg.familyData?.city ?? "",
          reg.familyData?.state ?? "",
          reg.familyData?.zip ?? "",
          reg.familyData?.country ?? "",
        ]),
    }),
  },
  {
    id: "active-emails",
    label: "Active parent emails",
    description:
      "Deduplicated parent and family account emails for Active registrations, with names where known. Ready for a mailing list import.",
    fileSuffix: "active-parent-emails",
    build: (registrations) => contactsTable(registrations.filter(isActive)),
  },
  {
    id: "prereg-emails",
    label: "Pre-registered parent emails",
    description:
      "Deduplicated parent and family account emails for every registration flagged as pre-registered, whatever its status.",
    fileSuffix: "pre-registered-parent-emails",
    build: (registrations) =>
      contactsTable(registrations.filter(isPreRegistered)),
  },
  {
    id: "prereg-campers",
    label: "Pre-registered campers",
    description:
      "Every registration flagged as pre-registered with its status, grade and parent emails.",
    fileSuffix: "pre-registered-campers",
    build: (registrations) => ({
      headers: ["Camper", "Status", "Grade", "Parent Emails"],
      rows: registrations
        .filter(isPreRegistered)
        .sort(byCamperName)
        .map((reg) => [
          camperName(reg),
          reg.status,
          reg.grade,
          getParentEmails(reg),
        ]),
    }),
  },
  {
    id: "active-info",
    label: "Active camper info",
    description:
      "Camper details for Active registrations: names, birthday, grade, gender, pronouns, shirt size, flags, notes and, for roles that can read them, health fields.",
    fileSuffix: "active-camper-info",
    build: (registrations, { canReadHealth }) => {
      const headers = [
        "First Name",
        "Last Name",
        "Preferred Name",
        "Birthday",
        "Grade",
        "Gender",
        "Pronouns",
        "Shirt Size",
        "Pre-Registered",
        "Returning Camper",
        ...(canReadHealth
          ? ["Medical Conditions", "Diet and Food Allergies"]
          : []),
        "Cabin Preference",
        "Additional Notes",
        "Internal Notes",
      ]
      const rows = registrations
        .filter(isActive)
        .sort(byCamperName)
        .map((reg) => [
          reg.firstName ?? "",
          reg.lastName ?? "",
          reg.preferredName ?? "",
          reg.birthDate ? dayjs(reg.birthDate).format("M/D/YYYY") : "",
          reg.grade,
          reg.gender?.join(", ") ?? "",
          reg.pronouns ?? "",
          reg.shirtSize ?? "",
          yesNo(reg.isPreRegistered),
          yesNo(reg.isReturning),
          ...(canReadHealth
            ? [reg.medicalConditions ?? "", reg.dietAndFoodAllergies ?? ""]
            : []),
          reg.cabinPreference ?? "",
          reg.additionalNotes ?? "",
          reg.internalNotes ?? "",
        ])
      return { headers, rows }
    },
  },
]

const normalizeName = (name: string) =>
  name.toLowerCase().replace(/\s+/g, " ").trim()

const namesFor = (reg: RegistrationData) =>
  [
    camperName(reg),
    `${reg.firstName ?? ""} ${reg.lastName ?? ""}`,
    `${reg.preferredName ?? ""} ${reg.lastName ?? ""}`,
  ]
    .map(normalizeName)
    .filter((name) => name.length > 0)

/**
 * Finds the registrations whose camper matches one of the typed names
 * (full, or preferred + last name; case and spacing do not matter). Names
 * with no match are returned so the user can fix typos.
 */
export function matchCampersByName(
  registrations: RegistrationData[],
  names: string[]
): { matched: RegistrationData[]; notFound: string[] } {
  const matched = new Set<RegistrationData>()
  const notFound: string[] = []

  names.forEach((name) => {
    const wanted = normalizeName(name)
    if (!wanted) return
    const hits = registrations.filter((reg) => namesFor(reg).includes(wanted))
    if (hits.length === 0) {
      notFound.push(name.trim())
    } else {
      hits.forEach((reg) => matched.add(reg))
    }
  })

  return { matched: Array.from(matched).sort(byCamperName), notFound }
}

export const namedCampersTable = (
  registrations: RegistrationData[]
): CsvTable => ({
  headers: [
    "Camper",
    "Status",
    "Birthday",
    "Parent Names",
    "Parent Emails",
    "Family Account Emails",
  ],
  rows: registrations.map((reg) => [
    camperName(reg),
    reg.status,
    reg.birthDate ? dayjs(reg.birthDate).format("M/D/YYYY") : "",
    getParentNames(reg).replace(/,\n/g, ", "),
    getParentEmails(reg),
    familyEmails(reg).join(", "),
  ]),
})

export const exportFileName = (
  campYear: number,
  suffix: string,
  date = dayjs()
) => `${campYear}-lyf-${suffix}-${date.format("YYYY-MM-DD")}`
