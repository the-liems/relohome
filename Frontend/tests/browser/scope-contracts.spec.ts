// Pure contracts: no network interception, invented provider result, LLM or UI fixture.
import { expect, test } from "@playwright/test";
import { searchScopeFeature } from "../../src/searchScope";
import {
  filtersFromSearch,
  mapRequest,
  individualListings,
} from "../../src/mapWorkspace";
import {
  closedResultSummary,
  pendingServiceInput,
  serviceTargets,
  canSelectServiceResult,
  navigationProgress,
} from "../../src/serviceJourney";
import type { Message, Thread } from "../../src/types";
import type { House } from "../../src/types";

test("individual markers preserve IDs and coordinates even when source pins coincide", () => {
  const homes = [
    { id: "one", lat: 21, lng: 105 },
    { id: "two", lat: 21, lng: 105 },
    { id: "three", lat: 21.000001, lng: 105 },
  ] as House[];
  const markers = individualListings(homes);
  expect(markers.map((m) => m.key)).toEqual(["one", "two", "three"]);
  expect(markers.every((m) => m.houses.length === 1)).toBe(true);
  expect(markers.map((m) => m.lat)).toEqual(homes.map((h) => h.lat));
});

test("housing workspace opts out of aggregation without altering user filters or actual zoom", () => {
  const filters = filtersFromSearch({ max_price: 5000000 });
  const body = mapRequest(
    filters,
    { west: 105, south: 20, east: 106, north: 22 },
    10,
  );
  expect(body.cluster).toBe(false);
  expect(body.zoom).toBe(10);
  expect(body.max_price).toBe(5000000);
  expect(body.amenities).toBeUndefined();
  expect(body.district).toBeUndefined();
  expect(body.administrative_area_ids).toBeUndefined();
});

test("comparison is not a service target; search/map identity survives even legacy reused IDs", () => {
  const thread = {
    state: {
      plan: {
        version: 2,
        tasks: [
          {
            id: "search",
            agent: "property",
            inputs: { housing_mode: "compare" },
          },
        ],
      },
      task_status: { search: "done" },
      progress: { items: [{ task_id: "search" }] },
    },
    messages: [
      {
        content: {
          ui: {
            components: [
              {
                id: "map",
                type: "property",
                task_id: "search",
                data: { search_request: { min_price_vnd: 5 } },
              },
            ],
          },
        },
      },
      {
        content: {
          ui: {
            components: [
              {
                id: "table",
                type: "property",
                task_id: "search",
                data: { comparison: { rows: [] } },
              },
            ],
          },
        },
      },
    ],
  } as unknown as Thread;
  const targets = serviceTargets(thread);
  expect(targets.map((t) => t.c.id)).toEqual(["map"]);
  expect(targets[0].c.data.search_request).toEqual({ min_price_vnd: 5 });
  expect(canSelectServiceResult(thread, targets[0])).toBe(false);
  thread.messages[0].content.ui!.components[0].data.search_request.max_price = 7;
  thread.state.progress.items = [];
  expect(navigationProgress(thread).items[0]).toMatchObject({
    task_id: "search",
    historical_search: true,
    chosen: null,
    inputs: { max_price_vnd: 7 },
  });
  thread.state.plan.tasks[0].inputs.housing_mode = "search";
  expect(canSelectServiceResult(thread, targets[0])).toBe(true);
  thread.state.progress.items = [{ task_id: "search" }];
  thread.state.plan.tasks = [];
  expect(serviceTargets(thread).map((t) => t.c.id)).toEqual(["map"]);
  expect(canSelectServiceResult(thread, targets[0])).toBe(false);
});

test("preserves provider geometry holes; missing administrative boundary is never an envelope", () => {
  const outer = [
    [0, 0],
    [3, 0],
    [3, 3],
    [0, 0],
  ];
  const hole = [
    [1, 1],
    [2, 1],
    [2, 2],
    [1, 1],
  ];
  const geometry = {
    type: "MultiPolygon",
    coordinates: [[outer, hole], [outer]],
  };
  expect(searchScopeFeature({ geometry })?.geometry).toEqual(geometry);
  const bounding_box = { west: 0, east: 3, south: 0, north: 3 };
  expect(
    searchScopeFeature({ boundary_unavailable: true, bounding_box }),
  ).toBeNull();
  expect(
    searchScopeFeature({
      geometry: { type: "Polygon", coordinates: [] },
      bounding_box,
    }),
  ).toBeNull();
  expect(searchScopeFeature({ bounding_box })?.properties.basis).toBe(
    "search_envelope_not_administrative_boundary",
  );
});

test("viewport updates keep radius and administrative filters", () => {
  const center = { lat: 0, lng: 0 },
    radius_m = 2000;
  const filters = filtersFromSearch({
    center,
    radius_m,
    administrative_area_ids: ["contract-area"],
  });
  const bounding_box = { west: 1, east: 2, south: 1, north: 2 };
  expect(mapRequest(filters, bounding_box, 15)).toMatchObject({
    center,
    radius_m,
    bounding_box,
    administrative_area_ids: ["contract-area"],
  });
  expect(searchScopeFeature({ center, radius_m })?.properties.basis).toBe(
    "search_radius",
  );
});

test("pending service is found from progress even when computed intake.domains is absent", () => {
  const thread = {
    state: {
      plan: { tasks: [] },
      progress: {
        items: [
          {
            task_id: "pending:move",
            agent: "relocation",
            state: "waiting",
            task_status: "needs_input",
            chosen: null,
          },
        ],
      },
    },
  } as unknown as Thread;
  expect(pendingServiceInput(thread, "relocation")).toBe(true);
  expect(pendingServiceInput(thread, "flight")).toBe(false);
  thread.state.progress.items[0].chosen = { label: "contract choice" };
  expect(pendingServiceInput(thread, "relocation")).toBe(false);
});

test("folds only fully chosen results; comparisons and partially chosen multi-service replies stay visible", () => {
  const message = {
    content: {
      ui: {
        components: [
          { task_id: "home", data: {} },
          { task_id: "flight", data: {} },
        ],
      },
    },
  } as unknown as Message;
  const thread = {
    state: {
      progress: {
        items: [
          { task_id: "home", state: "confirmed", chosen: { label: "Home" } },
        ],
      },
    },
  } as unknown as Thread;
  expect(closedResultSummary(message, thread)).toBeNull();
  thread.state.progress.items.push({
    task_id: "flight",
    state: "confirmed",
    chosen: { label: "Flight" },
  });
  expect(closedResultSummary(message, thread)).toContain("Home; Flight");
  message.content.ui!.components[0].data.comparison = true;
  expect(closedResultSummary(message, thread)).toBeNull();
});
