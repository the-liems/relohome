# AhaMove v3 integration contract

Provider documentation: <https://developers-stg.ahamove.com/docs/introduction>

## Environment

| ReloHome value | AhaMove base URL | Default |
|---|---|---:|
| `staging` | `https://partner-apistg.ahamove.com/v3` | yes |
| `production` | `https://partner-api.ahamove.com/v3` | no |

The configured host is allowlisted. Production also requires an explicit
production-enable flag. Credentials are configuration, never API or MCP input.

## Provider coverage

| Capability | Provider operation | Moving API/MCP surface |
|---|---|---|
| Token | `POST /accounts/token` | internal only |
| Cities | `GET /cities` | `list_service_areas` |
| Services | `GET /services` | `list_moving_services` |
| Service detail/requests | `GET /services/:id` | `get_moving_service` |
| Estimate | `POST /orders/estimates` | `estimate_move` |
| Create | `POST /orders` | `create_move_order` |
| Order detail | `GET /orders/:id` | `get_move_order` |
| Batch detail | `GET /orders?ids=...` | `get_move_orders` |
| Tracking-number lookup | `GET /orders/tracks/:tracking` | `find_move_orders_by_tracking_number` |
| Tracking URL | `GET /orders/:id/shared-link` | `get_move_tracking_link` |
| Callback logs | `GET /orders/callback-logs` | `get_move_order_events` |
| Update path | `PATCH /orders/:id` | `update_move_order` |
| Cancel | `DELETE /orders/:id` or `/orders/tracks` | `cancel_move_order` |
| Rate driver | `PUT /orders/:id/rate` | `rate_move_driver` |

Account/sub-account administration is intentionally not exposed to the model.

## Moving point semantics

- `pickup` maps to AhaMove `path[0]`.
- `destinations[n]` maps to `path[n + 1]` and order is preserved.
- Coordinates are required internally even where AhaMove accepts address-only
  input, preventing silent provider geocoding ambiguity.
- Every destination should carry a unique partner `tracking_number` to support
  reconciliation after an ambiguous create response.

## Money and distance

ReloHome preserves the provider fields separately:

- distance in km;
- distance price;
- stop-point price;
- special-request price;
- COD commission;
- voucher discount;
- subtotal;
- total price;
- total payable;
- ISO currency.

Missing fields remain `null`; the mapper never invents a zero.

## Error normalization

| ReloHome code | Meaning |
|---|---|
| `AUTHENTICATION_ERROR` | Invalid/expired credential |
| `PROVIDER_FORBIDDEN` | Credential lacks permission |
| `PROVIDER_NOT_FOUND` | Service/order not found |
| `PROVIDER_CONFLICT` | Provider reports a conflict |
| `PROVIDER_RATE_LIMITED` | Retryable throttling |
| `PROVIDER_UNAVAILABLE` | Network, timeout or provider 5xx |
| `PROVIDER_INVALID_RESPONSE` | Malformed or incomplete provider data |
| `APPROVAL_*` | Missing, invalid, used or expired approval |
| `QUOTE_*` | Missing or expired quote |
| `INVALID_ORDER_STATUS` | Requested mutation is illegal for current state |
| `WRITE_DISABLED` | Operational kill switch is off |

## Webhook

`POST /v1/integrations/ahamove/webhooks/order-status` is owned by `moving-api`,
not by MCP. Authentication mode and secret must match the configuration agreed
with AhaMove. Callback bodies must not be logged by Fastify.
