# ReloHome visual system — 2026-10-13

## Scope and audit

Frontend presentation only: retain routes, data, API contracts, request handlers, scheduling, matching and agent behavior. The existing Roommate plan is retained separately.

The app uses React and plain CSS, not Tailwind. Nineteen CSS files contain competing foundation, page and visual overrides. `ui/tokens.css` and `visual-polish.css` both define the palette. The visual layer has 111 literal colors; landlord CSS has 122, mostly legacy fallbacks. Most list cards have neither elevation nor distinct surfaces. Service identity uses positional selectors and inconsistent blue/purple assignments. Dark gradients and glow add noise without helping hierarchy. Existing screenshots show controls, results and plan cards competing at one visual level.

## Design contract

- Keep the photographic hero, content and useful existing layouts; avoid a generic SaaS template.
- Emerald brand; service accents: housing Emerald, map Blue, moving Orange, flight Indigo, roommate Rose, landlord Amber, guide Cyan.
- One canonical token source with distinct light and charcoal/navy dark palettes. Separate text, controls, decorative borders, service colors and status colors.
- Service identity uses semantic `data-service` attributes, never DOM position.
- Visible icon tiles, selected rails, elevated panels, compact cards, clear titles/prices and an obvious primary action.
- Preserve 320/390/768/1440 widths, keyboard focus and reduced motion. No new workflows or fake analytics.

## Ordered delivery

1. Capture the current landing and interior workspaces in an isolated Playwright context with existing test fixtures.
2. Consolidate tokens and shared controls; replace competing visual overrides rather than append another theme layer.
3. Upgrade landing sections and apply service semantics to navigation, cards and illustrations.
4. Apply the same hierarchy to Chat/Plan/Housing/Map/Flight/Moving/Roommate/Landlord/Admin/Guides.
5. Build, run relevant browser/interaction checks and audit color contrast with axe; compare light/dark desktop/mobile screenshots.
6. Document actual evidence and any pre-existing failures; rebuild the served frontend for local testing.

## Verification

Screenshots and audit output are local artifacts under `data/ui-design-system/`. Product code never imports test fixtures. Use the installed Playwright/browser because Chrome DevTools MCP is unavailable. Check both control and text contrast, including service-scoped buttons, selected states, dark cards and disabled states. Stop optional checks once remaining concrete risks are resolved.
