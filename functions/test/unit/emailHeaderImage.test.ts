import type {Firestore} from "firebase-admin/firestore";

import {getEmailHeaderImageUrl} from "../../src/registrationUtils/emailHeaderImage";
import {FakeFirestore} from "./fakeFirestore";

const GOOD_URL = "https://mcusercontent.com/abc/hero.jpg";

function dbWith(camp: Record<string, unknown> | null): Firestore {
  const db = new FakeFirestore();
  if (camp) db.seed("camps", "2027", camp);
  return db.as();
}

describe("getEmailHeaderImageUrl", () => {
  it("returns the configured https URL, trimmed", async () => {
    await expect(
      getEmailHeaderImageUrl(dbWith({emailHeaderImageUrl: ` ${GOOD_URL} `}), 2027)
    ).resolves.toBe(GOOD_URL);
  });

  it("is undefined when the field is unset, empty or the year is missing", async () => {
    await expect(getEmailHeaderImageUrl(dbWith({name: "LYF Camp 2027"}), 2027)).resolves.toBeUndefined();
    await expect(getEmailHeaderImageUrl(dbWith({emailHeaderImageUrl: ""}), 2027)).resolves.toBeUndefined();
    await expect(getEmailHeaderImageUrl(dbWith(null), 2027)).resolves.toBeUndefined();
  });

  it.each([
    "http://example.com/a.jpg",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "https://user:pw@example.com/a.jpg",
    42,
  ])("ignores a document value that is not an allowed https URL (%s)", async (value) => {
    await expect(
      getEmailHeaderImageUrl(dbWith({emailHeaderImageUrl: value}), 2027)
    ).resolves.toBeUndefined();
  });

  it("falls back instead of throwing when the read fails", async () => {
    const broken = {
      doc: () => ({get: () => Promise.reject(new Error("unavailable"))}),
    } as unknown as Firestore;
    await expect(getEmailHeaderImageUrl(broken, 2027)).resolves.toBeUndefined();
  });
});
