import { describe, expect, it } from "vitest";
import {
  resolveYoutubePresence,
  splitOfficialVideos,
} from "./youtube-presence";

const v = (channelTitle: string) => ({
  channelTitle,
  title: "t",
  videoId: "x",
  views: 1,
});

describe("youtube presence", () => {
  it("is off without a key", async () => {
    expect(
      await resolveYoutubePresence("franz skincare", "US", { apiKey: "" })
    ).toBeNull();
  });

  it("separates the brand's own channel from external creators", () => {
    const { official, external } = splitOfficialVideos(
      [v("Franz Skincare"), v("Alessa Miki"), v("프란츠 공식")],
      ["프란츠", "Franz Skincare", "franzskincare"]
    );
    expect(official.map((x) => x.channelTitle)).toEqual([
      "Franz Skincare",
      "프란츠 공식",
    ]);
    expect(external.map((x) => x.channelTitle)).toEqual(["Alessa Miki"]);
  });
});
