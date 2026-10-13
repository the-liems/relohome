import { expect, test } from "@playwright/test";
import { normalizeHousingMedia } from "../../src/housingMedia";

test("restored housing photos use the cloud origin without rewriting external photos or canonical fields", () => {
  const file = "a".repeat(40) + ".png";
  const before = {
    listing_id: "same-id",
    thumbnail_url: `http://127.0.0.1:8503/web/media/housing/${file}`,
    images: [
      { url: `https://old.example/web/media/housing/${file}` },
      { url: "https://provider.example/photo.jpg" },
    ],
    price: { amount: 4500000 },
    description: "An unchanged description",
  };
  const cloud = normalizeHousingMedia(before, "https://relo.example");
  expect(cloud.thumbnail_url).toBe(
    `https://relo.example/web/media/housing/${file}`,
  );
  expect(cloud.images[0]!.url).toBe(cloud.thumbnail_url);
  expect(cloud.images[1]!.url).toBe(before.images[1]!.url);
  expect(before.thumbnail_url).toContain("127.0.0.1");
  expect(cloud.price).toEqual(before.price);
  expect(cloud.listing_id).toBe(before.listing_id);
  expect(
    normalizeHousingMedia("javascript:alert(1)", "https://relo.example"),
  ).toBe("javascript:alert(1)");
});
