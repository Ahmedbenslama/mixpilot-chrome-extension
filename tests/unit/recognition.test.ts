import { describe, expect, it } from "vitest";
import { parseAudDResponse } from "../../src/recognition/provider";

describe("AudD response adapter", () => {
  it("normalizes a successful match and only includes supplied metadata", () => {
    expect(parseAudDResponse({ status: "success", result: {
      title: "Example", artist: "Artist", album: "Record", release_date: "2024", song_link: "https://example.test/song",
    } })).toEqual({ title: "Example", artist: "Artist", album: "Record", releaseDate: "2024", songUrl: "https://example.test/song" });
  });
  it("reports provider errors and no-match as errors, never as a result", () => {
    expect(() => parseAudDResponse({ status: "error", error: { error_message: "Invalid token" } })).toThrow("Invalid token");
    expect(() => parseAudDResponse({ status: "success", result: null })).toThrow("No matching track");
  });
});
