import {createHash} from "crypto";

// Only names prefixed with "mock" may be referenced from a hoisted jest.mock factory.
const mockLists = {
  addListMember: jest.fn(),
  setListMember: jest.fn(),
  updateListMemberTags: jest.fn(),
};
jest.mock("@mailchimp/mailchimp_marketing", () => ({
  __esModule: true,
  default: {setConfig: jest.fn(), lists: mockLists},
}));
// ../utils opens Firestore/Stripe clients at import time; the mailchimp
// module only needs the RegistrationType enum from it.
jest.mock("../../src/utils", () => ({
  RegistrationType: {PreRegistration: "PreReg", Registration: "Reg"},
}));
const mockSlackError = jest.fn();
jest.mock("../../src/slack/slackChannelWebhooks", () => ({
  sendMessageToRegistrationErrorMessages: mockSlackError,
}));
const mockCaptureException = jest.fn();
jest.mock("@sentry/node", () => ({captureException: mockCaptureException}));

import {CampTrack} from "lyf-registration-schemas";

import {RegistrationType} from "../../src/utils";
import {
  addMailchimpTagForCampYear,
  addMailchimpTags,
  addMailchimpUserToMailingList,
  addParentsToMailchimpList,
  getMailchimpList,
  getMailchimpTag,
  getMailchimpTagForCampTrack,
  MailchimpList,
  mailchimpSubscriberHash,
  removeMailchimpTagForCampYear,
  removeMailchimpTags,
  subscribeEmailToGeneralMailingList,
} from "../../src/utils/mailchimp";
import {FakeFirestore} from "./fakeFirestore";

const EMAIL = "Ada@Example.com";
// Computed independently of the module under test.
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const HASH = md5("ada@example.com");

describe("mailchimpSubscriberHash", () => {
  it("is the MD5 hex digest of the lowercased email (Mailchimp's subscriber hash)", () => {
    expect(mailchimpSubscriberHash(EMAIL)).toBe(HASH);
    // Known vector from Mailchimp's documentation for the hash format.
    expect(mailchimpSubscriberHash("Urist.McVankab@freddiesjokes.com")).toBe(
      "62eeb292278cc15f5817cb78f7790b08"
    );
  });
});

beforeEach(() => {
  for (const fn of Object.values(mockLists)) fn.mockReset();
  mockSlackError.mockReset();
  mockCaptureException.mockReset();
});

describe("list and tag naming", () => {
  it("maps both registration types onto the registered list", () => {
    expect(getMailchimpList(RegistrationType.Registration)).toBe(
      MailchimpList.REGISTERED
    );
    expect(getMailchimpList(RegistrationType.PreRegistration)).toBe(
      MailchimpList.PRE_REG
    );
    expect(MailchimpList.PRE_REG).toBe(MailchimpList.REGISTERED);
  });

  it("falls back to the general list for an unknown type", () => {
    expect(getMailchimpList("other" as RegistrationType)).toBe(
      MailchimpList.GENERAL
    );
  });

  it("builds the camp year tag from the year and registration type", () => {
    expect(getMailchimpTag("2026", RegistrationType.Registration)).toBe("2026Reg");
    expect(getMailchimpTag("2026", RegistrationType.PreRegistration)).toBe(
      "2026PreReg"
    );
  });

  it("builds the camp track tag", () => {
    expect(getMailchimpTagForCampTrack("2026", CampTrack.YOUNGER)).toBe(
      "2026YoungerCampTrack"
    );
  });
});

describe("subscribeEmailToGeneralMailingList", () => {
  it("subscribes the lowercased email with the given names", async () => {
    mockLists.addListMember.mockResolvedValue({});

    subscribeEmailToGeneralMailingList(EMAIL, "Ada", "Lovelace");
    await Promise.resolve();

    expect(mockLists.addListMember).toHaveBeenCalledWith(MailchimpList.GENERAL, {
      merge_fields: {FNAME: "Ada", LNAME: "Lovelace"},
      email_address: "ada@example.com",
      status: "subscribed",
    });
  });

  it("does not throw when the member already exists", async () => {
    mockLists.addListMember.mockRejectedValue(new Error("Member Exists"));

    expect(() =>
      subscribeEmailToGeneralMailingList(EMAIL, "Ada", "Lovelace")
    ).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });
});

describe("tag management", () => {
  it("activates tags on the hashed, lowercased member of the right list", async () => {
    await addMailchimpTags(EMAIL, ["2026Reg", "2026YoungerCampTrack"], RegistrationType.Registration);

    expect(mockLists.updateListMemberTags).toHaveBeenCalledWith(
      MailchimpList.REGISTERED,
      HASH,
      {
        tags: [
          {name: "2026Reg", status: "active"},
          {name: "2026YoungerCampTrack", status: "active"},
        ],
      }
    );
  });

  it("deactivates tags on removal", async () => {
    await removeMailchimpTags(EMAIL, ["2026Reg"], RegistrationType.Registration);

    expect(mockLists.updateListMemberTags).toHaveBeenCalledWith(
      MailchimpList.REGISTERED,
      HASH,
      {tags: [{name: "2026Reg", status: "inactive"}]}
    );
  });

  it("derives the camp year tag for add and remove", async () => {
    await addMailchimpTagForCampYear(EMAIL, 2026, RegistrationType.PreRegistration);
    expect(mockLists.updateListMemberTags).toHaveBeenLastCalledWith(
      MailchimpList.PRE_REG,
      HASH,
      {tags: [{name: "2026PreReg", status: "active"}]}
    );

    await removeMailchimpTagForCampYear(EMAIL, 2026, RegistrationType.PreRegistration);
    expect(mockLists.updateListMemberTags).toHaveBeenLastCalledWith(
      MailchimpList.PRE_REG,
      HASH,
      {tags: [{name: "2026PreReg", status: "inactive"}]}
    );
  });
});

describe("addMailchimpUserToMailingList", () => {
  it("upserts the member as subscribed", async () => {
    mockLists.setListMember.mockResolvedValue({status: "subscribed"});

    await addMailchimpUserToMailingList(EMAIL, "Ada", "Lovelace", RegistrationType.Registration);

    expect(mockLists.setListMember).toHaveBeenCalledWith(
      MailchimpList.REGISTERED,
      HASH,
      {
        email_address: EMAIL,
        merge_fields: {FNAME: "Ada", LNAME: "Lovelace"},
        status_if_new: "subscribed",
        status: "subscribed",
      }
    );
  });

  it("reports a Mailchimp failure to Sentry instead of failing the registration", async () => {
    const failure = new Error("Mailchimp is down");
    mockLists.setListMember.mockRejectedValue(failure);

    await expect(
      addMailchimpUserToMailingList(EMAIL, "Ada", "Lovelace", RegistrationType.Registration)
    ).resolves.toBeUndefined();
    expect(mockCaptureException).toHaveBeenCalledWith(failure);
  });
});

describe("addParentsToMailchimpList", () => {
  function parentsCollection() {
    const PARENTS = "families/fam/parents";
    const db = new FakeFirestore()
      .seed(PARENTS, "ada@example.com", {
        email: "Ada@Example.com",
        firstName: "Ada",
        lastName: "Lovelace",
      })
      .seed(PARENTS, "+15555550123", {
        firstName: "No",
        lastName: "Email",
      })
      .seed(PARENTS, "grace@example.com", {
        email: "grace@example.com",
        firstName: "Grace",
        lastName: "Hopper",
      });
    return db.collection(PARENTS).as();
  }

  it("subscribes and tags every parent that has an email and a full name", async () => {
    mockLists.setListMember.mockResolvedValue({status: "subscribed"});
    mockLists.updateListMemberTags.mockResolvedValue({});

    await addParentsToMailchimpList(
      RegistrationType.Registration,
      parentsCollection(),
      "2026",
      [CampTrack.YOUNGER, CampTrack.OLDER]
    );

    const subscribed = mockLists.setListMember.mock.calls.map((c) => c[1]).sort();
    expect(subscribed).toEqual([md5("ada@example.com"), md5("grace@example.com")].sort());

    expect(mockLists.updateListMemberTags).toHaveBeenCalledTimes(2);
    expect(mockLists.updateListMemberTags).toHaveBeenCalledWith(
      MailchimpList.REGISTERED,
      md5("ada@example.com"),
      {
        tags: [
          {name: "2026Reg", status: "active"},
          {name: "2026YoungerCampTrack", status: "active"},
          {name: "2026OlderCampTrack", status: "active"},
        ],
      }
    );
    expect(mockSlackError).not.toHaveBeenCalled();
  });

  it("only tags the camp year when no tracks are given", async () => {
    mockLists.setListMember.mockResolvedValue({status: "subscribed"});
    mockLists.updateListMemberTags.mockResolvedValue({});

    await addParentsToMailchimpList(
      RegistrationType.PreRegistration,
      parentsCollection(),
      "2026"
    );

    expect(mockLists.updateListMemberTags).toHaveBeenCalledWith(
      MailchimpList.PRE_REG,
      md5("grace@example.com"),
      {tags: [{name: "2026PreReg", status: "active"}]}
    );
  });

  it("reports tagging failures to Sentry and Slack without rejecting", async () => {
    mockLists.setListMember.mockResolvedValue({status: "subscribed"});
    const failure = new Error("tag failed");
    mockLists.updateListMemberTags.mockRejectedValue(failure);

    await expect(
      addParentsToMailchimpList(RegistrationType.Registration, parentsCollection(), "2026")
    ).resolves.toBeUndefined();

    expect(mockCaptureException).toHaveBeenCalledWith(failure);
    expect(mockSlackError).toHaveBeenCalledTimes(2);
    expect(mockSlackError).toHaveBeenCalledWith(
      expect.stringContaining("Failed to add tags to user ada@example.com: 2026Reg")
    );
  });
});
