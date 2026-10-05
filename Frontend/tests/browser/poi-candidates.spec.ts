import { test, expect } from "@playwright/test";
import { mergePlaceCandidates } from "../../src/placeCandidates";

test("POI candidate IDs deduplicate agent and search rows", () => {
  const a = { id: "place-a", label: "A", lat: 21, lng: 105 };
  expect(mergePlaceCandidates([a, { ...a }])).toHaveLength(1);
});

test("POI candidate aliases retain an explicitly selected old pin", () => {
  const old = { id: "old-way", label: "A", lat: 21, lng: 105 };
  const fresh = {
    id: "canonical-area",
    alias_ids: ["old-way"],
    label: "A",
    lat: 21.001,
    lng: 105.001,
  };
  expect(mergePlaceCandidates([old, fresh])).toEqual([fresh]);
  expect(mergePlaceCandidates([old, fresh], "old-way")).toEqual([old]);
  expect(mergePlaceCandidates([fresh, old], "old-way")).toEqual([old]);
  const refreshed = { ...old, lat: 21.002, lng: 105.002 };
  expect(mergePlaceCandidates([refreshed], old)).toEqual([old]);
});

test("POI candidate names and shared housing pins never establish equality", () => {
  const rows = [
    { id: "stop-1", label: "Bách Khoa", lat: 21, lng: 105 },
    { id: "stop-2", label: "Bách Khoa", lat: 21, lng: 105 },
    { id: "listing-1", label: "Phòng trọ", lat: 21, lng: 105 },
    { id: "listing-2", label: "Phòng trọ", lat: 21, lng: 105 },
  ];
  expect(mergePlaceCandidates(rows)).toEqual(rows);
});
