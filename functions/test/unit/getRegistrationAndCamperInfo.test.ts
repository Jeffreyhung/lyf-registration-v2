import type {Registration} from "lyf-registration-schemas";

import {getRegistrationAndCamperInfo} from "../../src/registrationUtils/getRegistrationAndCamperInfo";
import {FakeFirestore} from "./fakeFirestore";

const CAMPERS = "families/fam/campers";
const CAMPER_PATH = `${CAMPERS}/c1`;
const REGISTRATIONS = "camps/2026/registrations";
const REG_PATH = `${REGISTRATIONS}/r1`;

function registrationRef(db: FakeFirestore) {
  return db.doc(REG_PATH).as<Registration>();
}

describe("getRegistrationAndCamperInfo", () => {
  it("returns all nulls when the registration does not exist", async () => {
    const db = new FakeFirestore();

    const result = await getRegistrationAndCamperInfo(db.as(), registrationRef(db));

    expect(result).toEqual({camper: null, camperHealth: null, registration: null});
  });

  it("returns only the registration when it has no camper link", async () => {
    const db = new FakeFirestore().seed(REGISTRATIONS, "r1", {grade: 6});

    const result = await getRegistrationAndCamperInfo(db.as(), registrationRef(db));

    expect(result).toEqual({
      camper: null,
      camperHealth: null,
      registration: {grade: 6},
    });
  });

  it("resolves the camper and their private health record", async () => {
    const db = new FakeFirestore()
      .seed(CAMPERS, "c1", {firstName: "Ada"})
      .seed(`${CAMPER_PATH}/private`, "health", {medicalConditions: "none"});
    db.seed(REGISTRATIONS, "r1", {grade: 6, camper: db.doc(CAMPER_PATH)});

    const result = await getRegistrationAndCamperInfo(db.as(), registrationRef(db));

    expect(result.camper).toEqual({firstName: "Ada"});
    expect(result.camperHealth).toEqual({medicalConditions: "none"});
    expect(result.registration?.grade).toBe(6);
  });

  it("returns null health when the private record is missing", async () => {
    const db = new FakeFirestore().seed(CAMPERS, "c1", {firstName: "Ada"});
    db.seed(REGISTRATIONS, "r1", {camper: db.doc(CAMPER_PATH)});

    const result = await getRegistrationAndCamperInfo(db.as(), registrationRef(db));

    expect(result.camper).toEqual({firstName: "Ada"});
    expect(result.camperHealth).toBeNull();
  });

  it("returns a null camper when the linked camper document is gone", async () => {
    const db = new FakeFirestore();
    db.seed(REGISTRATIONS, "r1", {grade: 6, camper: db.doc(CAMPER_PATH)});

    const result = await getRegistrationAndCamperInfo(db.as(), registrationRef(db));

    expect(result.camper).toBeNull();
    expect(result.camperHealth).toBeNull();
    expect(result.registration?.grade).toBe(6);
  });
});
