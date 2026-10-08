// Pure validation contracts; no provider/mock/GPS fixtures.
import { expect, test } from "@playwright/test";
import {
  validCoordinates,
  locationErrorMessage,
} from "../../src/housingInteraction";
import { MAP_CITIES } from "../../src/mapScope";

test("coordinate validation accepts configured map centers, rejects missing, nonfinite and out-of-range values", () => {
  for (const city of Object.values(MAP_CITIES))
    expect(validCoordinates(city.center[1], city.center[0])).toBe(true);
  for (const lat of [null, undefined, NaN, Infinity, "21", 91, -91])
    expect(validCoordinates(lat, 105)).toBe(false);
  for (const lng of [null, undefined, NaN, Infinity, "105", 181, -181])
    expect(validCoordinates(21, lng)).toBe(false);
});

test("permission denial, timeout and unavailable location have distinct actionable messages", () => {
  expect(locationErrorMessage(1)).toContain("quyền");
  expect(locationErrorMessage(3)).toContain("thời gian");
  expect(locationErrorMessage(2)).toContain("Không dùng vị trí giả");
});
