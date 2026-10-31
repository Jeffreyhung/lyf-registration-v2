const CAMP_URL = "https://hooks.slack.test/services/camp";
const ERROR_URL = "https://hooks.slack.test/services/errors";

const mockFetch = jest.fn();

import {
  escapeSlackText,
  sendMessageToRegistrationErrorMessages,
  sendMessageToRegistrationForCampChannel,
} from "../../src/slack/slackChannelWebhooks";

beforeAll(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
});

beforeEach(() => {
  mockFetch.mockReset().mockResolvedValue({ok: true, status: 200, text: async () => "ok"});
  process.env.SLACK_REGISTRATION_WEBHOOK = CAMP_URL;
  process.env.SLACK_ERROR_WEBHOOK = ERROR_URL;
});

describe("escapeSlackText", () => {
  it("leaves ordinary text alone", () => {
    expect(escapeSlackText("LYF Camp 2026 Waitlist: Ada Lovelace")).toBe(
      "LYF Camp 2026 Waitlist: Ada Lovelace"
    );
  });

  it("neutralises mentions, links and entities a camper name could carry", () => {
    expect(escapeSlackText("Waitlist: <!channel> Ada")).toBe(
      "Waitlist: &lt;!channel&gt; Ada"
    );
    expect(escapeSlackText("<https://evil.example|Click here>")).toBe(
      "&lt;https://evil.example|Click here&gt;"
    );
    expect(escapeSlackText("Tom & Jerry")).toBe("Tom &amp; Jerry");
  });
});

describe.each([
  ["sendMessageToRegistrationForCampChannel", sendMessageToRegistrationForCampChannel, CAMP_URL, "SLACK_REGISTRATION_WEBHOOK"],
  ["sendMessageToRegistrationErrorMessages", sendMessageToRegistrationErrorMessages, ERROR_URL, "SLACK_ERROR_WEBHOOK"],
])("%s", (_name, send, url, envVar) => {
  it("posts the message as JSON to its own webhook for production data", async () => {
    await send("New registration: Ada");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(url, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({text: "New registration: Ada"}),
    });

    await send("Another", false);
    expect(mockFetch).toHaveBeenLastCalledWith(
      url,
      expect.objectContaining({body: JSON.stringify({text: "Another"})})
    );
  });

  it("escapes Slack markup before posting", async () => {
    await send("New registration: <!here> Ada & Co");
    expect(mockFetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        body: JSON.stringify({text: "New registration: &lt;!here&gt; Ada &amp; Co"}),
      })
    );
  });

  it("stays silent for test data", async () => {
    await send("New registration: Test Camper", true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("propagates a network failure to the caller", async () => {
    mockFetch.mockRejectedValue(new Error("slack down"));
    await expect(send("hello")).rejects.toThrow("slack down");
  });

  it("rejects when Slack answers with a non-2xx status", async () => {
    mockFetch.mockResolvedValue({ok: false, status: 404, text: async () => "no_service"});
    await expect(send("hello")).rejects.toThrow(`${envVar} responded 404: no_service`);
  });

  it("drops the message with a warning when the webhook is not configured", async () => {
    delete process.env[envVar];
    await expect(send("hello")).resolves.toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
