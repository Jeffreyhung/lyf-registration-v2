// Only names prefixed with "mock" may be referenced from a hoisted jest.mock factory.
const mockSend = jest.fn();
jest.mock("@slack/client", () => ({
  IncomingWebhook: jest.fn().mockImplementation((url: string) => ({url, send: mockSend})),
}));

import {
  sendMessageToRegistrationErrorMessages,
  sendMessageToRegistrationForCampChannel,
} from "../../src/slack/slackChannelWebhooks";

beforeEach(() => mockSend.mockReset().mockResolvedValue({text: "ok"}));

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

  it("stays silent for test data", async () => {
    await send("New registration: Test Camper", true);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("propagates a webhook failure to the caller", async () => {
    mockSend.mockRejectedValue(new Error("slack down"));
    await expect(send("hello")).rejects.toThrow("slack down");
  });
});
