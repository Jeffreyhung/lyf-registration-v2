// Only names prefixed with "mock" may be referenced from a hoisted jest.mock factory.
const mockSend = jest.fn();
jest.mock("@slack/client", () => ({
  IncomingWebhook: jest.fn().mockImplementation((url: string) => ({url, send: mockSend})),
}));

import {
  escapeSlackText,
  sendMessageToRegistrationErrorMessages,
  sendMessageToRegistrationForCampChannel,
} from "../../src/slack/slackChannelWebhooks";

beforeEach(() => mockSend.mockReset().mockResolvedValue({text: "ok"}));

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
  ["sendMessageToRegistrationForCampChannel", sendMessageToRegistrationForCampChannel],
  ["sendMessageToRegistrationErrorMessages", sendMessageToRegistrationErrorMessages],
])("%s", (_name, send) => {
  it("posts the message for production data", async () => {
    await send("New registration: Ada");
    expect(mockSend).toHaveBeenCalledWith("New registration: Ada");

    await send("Another", false);
    expect(mockSend).toHaveBeenLastCalledWith("Another");
  });

  it("escapes Slack markup before posting", async () => {
    await send("New registration: <!here> Ada & Co");
    expect(mockSend).toHaveBeenCalledWith(
      "New registration: &lt;!here&gt; Ada &amp; Co"
    );
  });

  it("stays silent for test data", async () => {
    await send("New registration: Test Camper", true);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("propagates a webhook failure to the caller", async () => {
    mockSend.mockRejectedValue(new Error("slack down"));
    await expect(send("hello")).rejects.toThrow("slack down");
  });
});
