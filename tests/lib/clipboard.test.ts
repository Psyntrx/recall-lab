/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "@/lib/clipboard";

afterEach(() => vi.restoreAllMocks());

describe("copyText", () => {
  it("copies full non-empty text through the secure Clipboard API", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const prompt = "Complete generated prompt\nincluding the required JSON schema";
    await copyText(prompt);
    expect(writeText).toHaveBeenCalledWith(prompt);
  });

  it("surfaces a rejected clipboard write without falsely using fallback", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("Permission denied")) } });
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(true) });
    const legacyCopy = vi.spyOn(document, "execCommand").mockReturnValue(true);
    await expect(copyText("prompt text")).rejects.toThrow("Permission denied");
    expect(legacyCopy).not.toHaveBeenCalled();
  });

  it("uses the legacy fallback when Clipboard API is unavailable", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(true) });
    const legacyCopy = vi.spyOn(document, "execCommand").mockReturnValue(true);
    await copyText("complete fallback prompt");
    expect(legacyCopy).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("explains why system clipboard access may fail on an insecure LAN origin", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(false) });
    await expect(copyText("complete prompt")).rejects.toThrow(/requires HTTPS or localhost/i);
  });
});
