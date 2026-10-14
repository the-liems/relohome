// Pure contracts: no network interception, invented provider result, LLM or UI fixture.
import { expect, test } from "@playwright/test";
import { ACTIVE_CHAT_TTL, forgetActiveChat, readActiveChat, rememberActiveChat } from "../../src/activeChatSession";

test("active chat cache retains only one owned pointer for 24 hours and expires without deleting backend data", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  rememberActiveChat("alice", "th_first", 1000, storage);
  expect(readActiveChat("alice", 1000, storage)).toEqual({ threadId: "th_first", expiresAt: 1000 + ACTIVE_CHAT_TTL });
  expect(readActiveChat("bob", 1000, storage)).toBeNull();
  rememberActiveChat("alice", "th_second", 2000, storage);
  expect(readActiveChat("alice", 2000, storage)?.threadId).toBe("th_second");
  expect(JSON.parse([...values.values()][0])).toEqual({ threadId: "th_second", expiresAt: 2000 + ACTIVE_CHAT_TTL });
  forgetActiveChat("alice", "th_first", storage);
  expect(readActiveChat("alice", 2000, storage)?.threadId).toBe("th_second");
  expect(readActiveChat("alice", 2000 + ACTIVE_CHAT_TTL, storage)).toBeNull();
  expect(values.size).toBe(0);
  rememberActiveChat("alice", "th_first", 3000, storage);
  forgetActiveChat("alice", undefined, storage);
  expect(readActiveChat("alice", 3000, storage)).toBeNull();
});

test("active chat cache tolerates unavailable storage and rejects malformed entries", () => {
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  expect(() => rememberActiveChat("alice", "th_first", 1000, blocked)).not.toThrow();
  expect(() => forgetActiveChat("alice", undefined, blocked)).not.toThrow();
  expect(readActiveChat("alice", 1000, blocked)).toBeNull();
  for (const value of ['{', '{}', '{"threadId":"","expiresAt":9999}', '{"threadId":"../../admin","expiresAt":9999}', '{"threadId":"th_first","expiresAt":"9999"}']) {
    expect(readActiveChat("alice", 1000, { getItem: () => value, setItem() {}, removeItem() {} })).toBeNull();
  }
});
import { searchScopeFeature } from "../../src/searchScope";
import {
  filtersFromSearch,
  mapRequest,
  individualListings,
  coincidentListings,
} from "../../src/mapWorkspace";
import {
  closedResultSummary,
  pendingServiceInput,
  nextPlanStep,
  hasMultipleRequestedServices,
  serviceTargets,
  canSelectServiceResult,
  navigationProgress,
} from "../../src/serviceJourney";
import type { Message, Thread } from "../../src/types";
import type { House } from "../../src/types";

test("next-step mode follows requested services, ignoring unrelated history and duplicate tasks", () => {
  const thread = { messages: [], state: { plan: { tasks: [] }, progress: { items: [
    { task_id: "current", agent: "flight" },
    { task_id: "old", agent: "property", historical_search: true },
  ] }, intake: { intent: { domains: ["flight"] } } } } as unknown as Thread;
  expect(hasMultipleRequestedServices(thread)).toBe(false);
  thread.state.intake.intent.domains = ["flight", "relocation"];
  expect(hasMultipleRequestedServices(thread)).toBe(true);
  delete thread.state.intake.intent;
  expect(hasMultipleRequestedServices(thread)).toBe(false);
  thread.state.progress.items.push({ task_id: "second-flight", agent: "flight" });
  expect(hasMultipleRequestedServices(thread)).toBe(false);
  thread.state.progress.items.push({ task_id: "pending:map", agent: "map" });
  expect(hasMultipleRequestedServices(thread)).toBe(true);
});

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

test("counted pins combine only exact coordinates, preserve houses and never round nearby points", () => {
  const homes = [
    { id: "one", lat: 21, lng: 105, price_vnd: 3500000 },
    { id: "two", lat: 21, lng: 105, price_vnd: 5000000 },
    { id: "three", lat: 21, lng: 105, price_vnd: 7000000 },
    { id: "nearby", lat: 21.0000001, lng: 105 },
    { id: "other-longitude", lat: 21, lng: 105.0000001 },
    { id: "invalid", lat: NaN, lng: 105 },
  ] as House[];
  const original = homes.map(h => ({ ...h }));
  const pins = coincidentListings(homes);
  expect(pins).toHaveLength(3);
  expect(pins[0].houses.map(h => h.id)).toEqual(["one", "two", "three"]);
  expect(pins[0].houses[1]).toBe(homes[1]);
  expect(pins.map(pin => [pin.lat, pin.lng])).toEqual([[21, 105], [21.0000001, 105], [21, 105.0000001]]);
  expect(homes).toEqual(original);
  expect(coincidentListings([...homes, homes[0]])[0].houses).toHaveLength(3);
  expect(coincidentListings(homes.slice(0, 2))[0].houses).toHaveLength(2);
  expect(coincidentListings([])).toEqual([]);
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

test("next plan step treats a viewing choice as reviewed navigation, never as a decided home", () => {
  const thread = {
    messages: [],
    state: {
      plan: { tasks: [{ id: "home", agent: "property" }] },
      progress: {
        items: [
          {
            task_id: "home",
            agent: "property",
            state: "reviewed",
            task_status: "done",
            chosen: null,
          },
          {
            task_id: "pending:relocation",
            agent: "relocation",
            state: "waiting",
            task_status: "needs_input",
            after: ["home"],
            chosen: null,
          },
        ],
      },
      viewing: {
        items: [
          { task_id: "home", status: "selected", listing_id: "viewing-only" },
        ],
      },
      intake: { user_confirmed_facts: {} },
    },
  } as unknown as Thread;
  expect(nextPlanStep(thread)).toMatchObject({
    taskId: "pending:relocation",
    agent: "relocation",
    kind: "input",
  });
  expect(thread.state.intake.user_confirmed_facts).toEqual({});
  expect(thread.state.progress.items[0].chosen).toBeNull();
});

test("next plan step skips confirmed/comparison/history and never invents a service", () => {
  const thread = {
    messages: [],
    state: {
      plan: { tasks: [{ id: "flight", agent: "flight" }] },
      progress: {
        items: [
          {
            task_id: "historic",
            agent: "property",
            historical_search: true,
            state: "reviewed",
          },
          {
            task_id: "comparison",
            agent: "property",
            inputs: { housing_mode: "compare" },
          },
          {
            task_id: "flight",
            agent: "flight",
            state: "confirmed",
            task_status: "done",
            chosen: { id: "selected" },
          },
          {
            task_id: "pending:relocation",
            agent: "relocation",
            state: "waiting",
            task_status: "needs_input",
          },
        ],
      },
    },
  } as unknown as Thread;
  expect(nextPlanStep(thread)?.agent).toBe("relocation");
  thread.state.progress.items.pop();
  expect(nextPlanStep(thread)).toBeNull();
  expect(nextPlanStep(null)).toBeNull();
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
