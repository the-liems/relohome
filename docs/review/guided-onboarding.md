# ReloHome first-visit guide — issue #239

## Behaviour

- A short, optional welcome appears once on the first blank AI workspace visit
  (`/ai`), after status is available. It does not cover the marketing landing page,
  login, deep-linked conversations, resumed drafts, forms, plans, or checkout.
  The one-time decision is consumed at workspace readiness even when skipped for
  existing work: clearing a draft or closing a form later cannot trigger a popup.
- Closing, skipping or choosing a tour records the versioned, device-local
  `relohome.onboarding.v1.seen=1`. There is no server/profile change, personal data,
  model call or tracking event. Guest-to-account changes in the same browser do
  not re-invite. Another browser or clearing browser data can show the guide again.
  If storage is blocked, an in-memory fallback prevents repeated invitations in
  the mounted app; persistence across reloads is not guaranteed.
- The header's **? Hướng dẫn / Help** opens the chooser manually. The existing
  desktop header reveals on hover/focus; touch navigation stays visible.
- Housing and Moving each have an introductory tour. Replaying on the housing
  map or Moving form explains that workspace's actual controls instead.
- No automatic continuation on arrival at a new workspace: only the initial
  invitation is automatic. The user chooses whether to replay further guidance.
- Tours are read-only: Next/Back/Finish change only the tour. They never activate
  buttons, submit forms, fill drafts, select homes/vehicles, request quotes, or pay.
  Existing normal workspace reads still run independently.

## Accessibility and resilience

Native modal dialog, labelled/described content, keyboard containment, Escape,
focus restoration, VI/EN text, theme tokens and reduced-motion support. A mask
highlights stable data attributes rather than translated labels/provider IDs.
Mobile cards move above/below the target; long content is scrollable. Missing
targets get an explanatory card, not a synthetic click. Changing the workspace,
thread or form closes the guide; timers/listeners/observers are cleaned up.

## Less clutter, preserved data

Moving keeps driver/vehicle notes visible. Optional proof-of-delivery,
verification and promo fields are in a disclosure, initially expanded if there
are existing values. Collapsing never resets fields or changes payloads,
validation, provider selection, pricing, safety messages or payment behaviour.

## Verification

`onboarding.spec.ts` uses fresh storage and fake API responses with all mutations
recorded/rejected. It covers first invite, no repeat after reload, manual replay,
intro/map/form steps, no actions, unchanged Moving options/notes, keyboard/focus,
320px/dark/English, accessibility and unavailable optional storage on desktop and
mobile. General browser regressions use an explicit returning-visitor preference;
first-visit tests override it, rather than weakening existing assertions.

Run: `npm run build --workspace apps/web`, then Playwright `onboarding.spec.ts`
and the existing Moving/Housing regressions. No env changes, schema migration,
backend/provider call or production deployment is required by this feature.

Local verification: web production build and formatting/diff checks passed;
34 desktop/mobile browser cases (14 onboarding and 20 existing feature cases)
and 49 pure frontend contracts passed. The complete repository/browser suites
were not run. All API/provider data in these browser checks were fixtures.
