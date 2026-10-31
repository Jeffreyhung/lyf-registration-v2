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
  getMailchimpListForCampYear,
  getMailchimpTag,
  getMailchimpTagForCampTrack,
  MAILCHIMP_GENERAL_LIST_ID,
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

// The per-year audience, as the directors configure it in the Camp Year tab.
const LIST_2026 = "be387aca9f";

/** A database whose camps/2026 names its audience and whose camps/2027 does not. */
function campsDb() {
  return new FakeFirestore()
    .seed("camps", "2026", {name: "LYF Camp 2026", mailchimpListId: LIST_2026})
    .seed("camps", "2027", {name: "LYF Camp 2027"});
}

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

describe("getMailchimpListForCampYear", () => {
  it("uses the audience configured on camps/{year}", async () => {
    await expect(getMailchimpListForCampYear(campsDb().as(), "2026")).resolves.toEqual({
      listId: LIST_2026,
      configured: true,
    });
  });

  it("falls back to the general list when the year has no audience", async () => {
    await expect(getMailchimpListForCampYear(campsDb().as(), "2027")).resolves.toEqual({
      listId: MAILCHIMP_GENERAL_LIST_ID,
      configured: false,
    });
  });

  it("falls back to the general list when the year does not exist", async () => {
    await expect(getMailchimpListForCampYear(campsDb().as(), "2030")).resolves.toEqual({
      listId: MAILCHIMP_GENERAL_LIST_ID,
      configured: false,
    });
  });

  it("ignores a value that is not an audience id rather than building a bad API URL", async () => {
    const db = new FakeFirestore().seed("camps", "2026", {
      mailchimpListId: "https://us7.admin.mailchimp.com/lists/",
    });
    await expect(getMailchimpListForCampYear(db.as(), "2026")).resolves.toEqual({
      listId: MAILCHIMP_GENERAL_LIST_ID,
      configured: false,
    });
  });
});

describe("tag naming", () => {
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

    expect(mockLists.addListMember).toHaveBeenCalledWith(MAILCHIMP_GENERAL_LIST_ID, {
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
  it("activates tags on the hashed, lowercased member of the given list", async () => {
    await addMailchimpTags(LIST_2026, EMAIL, ["2026Reg", "2026YoungerCampTrack"]);

    expect(mockLists.updateListMemberTags).toHaveBeenCalledWith(LIST_2026, HASH, {
      tags: [
        {name: "2026Reg", status: "active"},
        {name: "2026YoungerCampTrack", status: "active"},
      ],
    });
  });

  it("deactivates tags on removal", async () => {
    await removeMailchimpTags(LIST_2026, EMAIL, ["2026Reg"]);

    expect(mockLists.updateListMemberTags).toHaveBeenCalledWith(LIST_2026, HASH, {
      tags: [{name: "2026Reg", status: "inactive"}],
    });
  });

  it("derives the camp year tag and the year's list for add and remove", async () => {
    const db = campsDb().as();

    await addMailchimpTagForCampYear(db, EMAIL, 2026, RegistrationType.PreRegistration);
    expect(mockLists.updateListMemberTags).toHaveBeenLastCalledWith(LIST_2026, HASH, {
      tags: [{name: "2026PreReg", status: "active"}],
    });

    await removeMailchimpTagForCampYear(db, EMAIL, 2026, RegistrationType.PreRegistration);
    expect(mockLists.updateListMemberTags).toHaveBeenLastCalledWith(LIST_2026, HASH, {
      tags: [{name: "2026PreReg", status: "inactive"}],
    });

    // An unconfigured year tags the member on the general list.
    await addMailchimpTagForCampYear(db, EMAIL, 2027, RegistrationType.Registration);
    expect(mockLists.updateListMemberTags).toHaveBeenLastCalledWith(
      MAILCHIMP_GENERAL_LIST_ID,
      HASH,
      {tags: [{name: "2027Reg", status: "active"}]}
    );
  });
});

describe("addMailchimpUserToMailingList", () => {
  it("upserts the member as subscribed", async () => {
    mockLists.setListMember.mockResolvedValue({status: "subscribed"});

    await addMailchimpUserToMailingList(LIST_2026, EMAIL, "Ada", "Lovelace");

    expect(mockLists.setListMember).toHaveBeenCalledWith(LIST_2026, HASH, {
      email_address: EMAIL,
      merge_fields: {FNAME: "Ada", LNAME: "Lovelace"},
      status_if_new: "subscribed",
      status: "subscribed",
    });
  });

  it("reports a Mailchimp failure to Sentry instead of failing the registration", async () => {
    const failure = new Error("Mailchimp is down");
    mockLists.setListMember.mockRejectedValue(failure);

    await expect(
      addMailchimpUserToMailingList(LIST_2026, EMAIL, "Ada", "Lovelace")
    ).resolves.toBeUndefined();
    expect(mockCaptureException).toHaveBeenCalledWith(failure);
  });
});

describe("addParentsToMailchimpList", () => {
  const PARENTS = "families/fam/parents";

  function setup() {
    return campsDb()
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
  }

  it("subscribes and tags every parent that has an email and a full name on the year's list", async () => {
    mockLists.setListMember.mockResolvedValue({status: "subscribed"});
    mockLists.updateListMemberTags.mockResolvedValue({});
    const db = setup();

    await addParentsToMailchimpList(
      db.as(),
      RegistrationType.Registration,
      db.collection(PARENTS).as(),
      "2026",
      [CampTrack.YOUNGER, CampTrack.OLDER]
    );

    const subscribed = mockLists.setListMember.mock.calls.map((c) => c[1]).sort();
    expect(subscribed).toEqual([md5("ada@example.com"), md5("grace@example.com")].sort());
    expect(mockLists.setListMember.mock.calls.map((c) => c[0])).toEqual([LIST_2026, LIST_2026]);

    expect(mockLists.updateListMemberTags).toHaveBeenCalledTimes(2);
    expect(mockLists.updateListMemberTags).toHaveBeenCalledWith(
      LIST_2026,
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
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("uses the general list and reminds the directors when the year has no audience", async () => {
    mockLists.setListMember.mockResolvedValue({status: "subscribed"});
    mockLists.updateListMemberTags.mockResolvedValue({});
    const db = setup();

    await addParentsToMailchimpList(
      db.as(),
      RegistrationType.PreRegistration,
      db.collection(PARENTS).as(),
      "2027",
      [],
      true
    );

    expect(mockLists.setListMember.mock.calls.map((c) => c[0])).toEqual([
      MAILCHIMP_GENERAL_LIST_ID,
      MAILCHIMP_GENERAL_LIST_ID,
    ]);
    expect(mockLists.updateListMemberTags).toHaveBeenCalledWith(
      MAILCHIMP_GENERAL_LIST_ID,
      md5("grace@example.com"),
      {tags: [{name: "2027PreReg", status: "active"}]}
    );
    // One reminder per fulfilment, to the test channel, and nothing in Sentry.
    expect(mockSlackError).toHaveBeenCalledTimes(1);
    expect(mockSlackError).toHaveBeenCalledWith(
      expect.stringContaining("camps/2027 has no Mailchimp audience configured"),
      true
    );
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it("reports tagging failures to Sentry and Slack without rejecting", async () => {
    mockLists.setListMember.mockResolvedValue({status: "subscribed"});
    const failure = new Error("tag failed");
    mockLists.updateListMemberTags.mockRejectedValue(failure);
    const db = setup();

    await expect(
      addParentsToMailchimpList(
        db.as(),
        RegistrationType.Registration,
        db.collection(PARENTS).as(),
        "2026"
      )
    ).resolves.toBeUndefined();

    expect(mockCaptureException).toHaveBeenCalledWith(failure);
    expect(mockSlackError).toHaveBeenCalledTimes(2);
    expect(mockSlackError).toHaveBeenCalledWith(
      expect.stringContaining(`Failed to add tags to user ada@example.com in list ${LIST_2026}: 2026Reg`),
      false
    );
  });
});
