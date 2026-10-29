import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { photoListJson, photoRefs, resizePhoto, FULL_EDGE, THUMB_WIDTH } from "../scripts/import-strava-photos";

describe("import-strava-photos", () => {
  it("lists images from the Media column, skipping videos, with captions from media.csv", () => {
    const csv = 'Activity ID,Activity Name,Media\n1,Run,media/a.jpg|media/clip.mp4|media/b.JPG\n2,Swim,\n';
    const media = 'Media Filename,Media Caption\nmedia/b.JPG,"Summit, at last"\n';
    expect(photoRefs(csv, media)).toEqual([
      { activityId: 1, position: 0, file: "media/a.jpg" },
      { activityId: 1, position: 1, file: "media/b.JPG", caption: "Summit, at last" },
    ]);
    expect(photoRefs("Activity ID,Activity Name\n1,Run\n")).toEqual([]);
  });

  it("resizes, rotates and strips all metadata including GPS", async () => {
    const input = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#3a7" } })
      .withExif({ IFD0: { Make: "TestCam" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 0/1" } })
      .withMetadata({ orientation: 6 }) // stored sideways: should come out portrait
      .jpeg().toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const p = await resizePhoto(input);
    expect([p.width, p.height]).toEqual([800, FULL_EDGE]);
    const full = await sharp(p.full).metadata();
    const thumb = await sharp(p.thumb).metadata();
    expect(full.exif).toBeUndefined();
    expect(full.orientation).toBeUndefined();
    expect(thumb.exif).toBeUndefined();
    expect(thumb.width).toBe(THUMB_WIDTH);
  });

  it("builds the small photo list stored in data_json", () => {
    expect(photoListJson([{ activityId: 7, position: 2, file: "m.jpg", width: 1200, height: 800, caption: "c" }], "https://x"))
      .toEqual([{ id: "7_2", width: 1200, height: 800, caption: "c", url: "https://x/api/photos/7_2", thumb_url: "https://x/api/photos/7_2?size=thumb" }]);
  });
});
