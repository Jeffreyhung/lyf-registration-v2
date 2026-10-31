import {HttpsError} from "firebase-functions/v2/https";
import {Timestamp} from "firebase-admin/firestore";
import {MAX_IMAGE_URL_LENGTH} from "lyf-registration-schemas";

import {
  assertDateOrder,
  parseConfigInput,
  parseImageUrl,
  parseMailchimpListId,
} from "../../src/admin/campYearConfig";

function expectInvalid(fn: () => unknown, message: RegExp) {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(HttpsError);
  expect((caught as HttpsError).code).toBe("invalid-argument");
  expect((caught as HttpsError).message).toMatch(message);
}

const GOOD_URL = "https://mcusercontent.com/abc/_compresseds/hero.jpg";

describe("parseConfigInput key whitelist", () => {
  it("rejects anything that is not an object", () => {
    expectInvalid(() => parseConfigInput(null), /must be an object/);
    expectInvalid(() => parseConfigInput(["name"]), /must be an object/);
  });

  it("rejects keys outside CAMP_YEAR_CONFIG_KEYS, remainingSpots above all", () => {
    expectInvalid(
      () => parseConfigInput({remainingSpots: {Younger: 999}}),
      /remainingSpots is not an editable/
    );
    expectInvalid(() => parseConfigInput({constructor: "x"}), /not an editable/);
    expectInvalid(() => parseConfigInput({isTestData: true}), /not an editable/);
  });

  it("skips undefined values so a whole form can be sent", () => {
    expect(parseConfigInput({name: undefined, showRemainingSpots: undefined})).toEqual({});
  });
});

describe("parseConfigInput image URLs", () => {
  it("stores a trimmed https URL", () => {
    expect(parseConfigInput({infoSessionImageUrl: `  ${GOOD_URL} `})).toEqual({
      infoSessionImageUrl: GOOD_URL,
    });
    expect(parseConfigInput({emailHeaderImageUrl: GOOD_URL})).toEqual({
      emailHeaderImageUrl: GOOD_URL,
    });
  });

  it("stores empty string so the bundled fallback is used again", () => {
    expect(parseConfigInput({emailHeaderImageUrl: "   "})).toEqual({emailHeaderImageUrl: ""});
  });

  it.each([
    ["http (blocked by the site CSP)", "http://example.com/a.jpg"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:image/png;base64,AAAA"],
    ["relative path", "/images/a.jpg"],
    ["protocol-relative", "//example.com/a.jpg"],
    ["embedded credentials", "https://user:pw@example.com/a.jpg"],
    ["not a URL", "not a url"],
    ["too long", `https://example.com/${"a".repeat(MAX_IMAGE_URL_LENGTH)}`],
  ])("rejects %s", (_label, url) => {
    expectInvalid(() => parseImageUrl(url, "infoSessionImageUrl"), /infoSessionImageUrl must be an https/);
    expectInvalid(() => parseConfigInput({infoSessionImageUrl: url}), /infoSessionImageUrl must be an https/);
  });

  it("rejects non-string values", () => {
    expectInvalid(() => parseConfigInput({infoSessionImageUrl: 42}), /must be a string/);
    expectInvalid(() => parseConfigInput({emailHeaderImageUrl: {url: GOOD_URL}}), /must be a string/);
  });
});

describe("parseConfigInput Mailchimp audience id", () => {
  it("stores a trimmed audience id", () => {
    expect(parseConfigInput({mailchimpListId: " be387aca9f "})).toEqual({
      mailchimpListId: "be387aca9f",
    });
  });

  it("stores empty string so registrations fall back to the general list", () => {
    expect(parseConfigInput({mailchimpListId: "  "})).toEqual({mailchimpListId: ""});
  });

  it.each([
    ["an audience URL", "https://us7.admin.mailchimp.com/lists/members/?id=12345"],
    ["uppercase", "BE387ACA9F"],
    ["a path", "be387aca9f/members"],
    ["too short", "abc"],
  ])("rejects %s", (_label, value) => {
    expectInvalid(
      () => parseMailchimpListId(value, "mailchimpListId"),
      /mailchimpListId must be a Mailchimp audience id/
    );
    expectInvalid(
      () => parseConfigInput({mailchimpListId: value}),
      /mailchimpListId must be a Mailchimp audience id/
    );
  });

  it("rejects non-string values", () => {
    expectInvalid(() => parseConfigInput({mailchimpListId: 42}), /must be a string/);
  });
});

describe("parseConfigInput display flags", () => {
  it("accepts booleans for every flag", () => {
    expect(
      parseConfigInput({
        showWaitlistHeaderBar: true,
        showRemainingSpots: false,
        showWaitlistPosition: true,
      })
    ).toEqual({
      showWaitlistHeaderBar: true,
      showRemainingSpots: false,
      showWaitlistPosition: true,
    });
  });

  it.each([["string", "true"], ["number", 1], ["null", null], ["object", {}]])(
    "rejects a %s where a boolean is expected",
    (_label, value) => {
      expectInvalid(() => parseConfigInput({showRemainingSpots: value}), /showRemainingSpots must be true or false/);
    }
  );
});

describe("parseConfigInput other fields", () => {
  it("trims free text", () => {
    expect(parseConfigInput({name: "  LYF Camp 2027 "})).toEqual({name: "LYF Camp 2027"});
    expectInvalid(() => parseConfigInput({campsite: 5}), /campsite must be a string/);
  });

  it("converts ISO dates to Timestamps and rejects garbage", () => {
    const out = parseConfigInput({campStartDate: "2027-07-12T22:00:00Z"});
    expect(out.campStartDate).toBeInstanceOf(Timestamp);
    expectInvalid(() => parseConfigInput({campStartDate: "next summer"}), /ISO-8601/);
    expectInvalid(() => parseConfigInput({campStartDate: 1234}), /ISO-8601/);
  });

  it("rejects negative or non-numeric fees and caps", () => {
    expectInvalid(() => parseConfigInput({registrationFee: -1}), /non-negative number/);
    expectInvalid(() => parseConfigInput({registrationFee: "1325"}), /non-negative number/);
    expectInvalid(() => parseConfigInput({campTotalSizeCap: 1.5}), /whole number/);
    expectInvalid(() => parseConfigInput({campSizeCaps: {Middle: 10}}), /unknown track Middle/);
    expectInvalid(() => parseConfigInput({campSizeCaps: [10]}), /must be a map/);
  });

  it("normalizes bypass emails and rejects non-strings", () => {
    expect(parseConfigInput({registrationBypassEmails: [" A@B.com", "a@b.com"]})).toEqual({
      registrationBypassEmails: ["a@b.com"],
    });
    expectInvalid(() => parseConfigInput({registrationBypassEmails: "a@b.com"}), /list of emails/);
    expectInvalid(() => parseConfigInput({registrationBypassEmails: [1]}), /list of emails/);
  });
});

describe("assertDateOrder", () => {
  const ts = (iso: string) => Timestamp.fromDate(new Date(iso));

  it("rejects a changed pair that is out of order", () => {
    expectInvalid(
      () =>
        assertDateOrder(
          {campStartDate: ts("2027-07-18T00:00:00Z"), campEndDate: ts("2027-07-12T00:00:00Z")},
          new Set(["campEndDate"])
        ),
      /campStartDate must not be after campEndDate/
    );
  });

  it("ignores pre-existing disorder in untouched fields", () => {
    expect(() =>
      assertDateOrder(
        {campStartDate: ts("2027-07-18T00:00:00Z"), campEndDate: ts("2027-07-12T00:00:00Z")},
        new Set(["name"])
      )
    ).not.toThrow();
  });
});
