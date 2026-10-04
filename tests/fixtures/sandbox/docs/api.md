# Billing API

Every endpoint except `/login`, `/plans`, and `/health` needs `Authorization: Bearer <token>`. Tokens come from `/login` and last eight hours. Errors are JSON, `{ error: string }`, with the status codes listed per endpoint.

## Endpoints

### POST /login

Issue a session token.

- Request: `{ email, password }`
- Response: `{ token }`
- Errors: 401 Wrong email or password

### POST /logout

Revoke the current token.

- Request: `none`
- Response: `{ ok: true }`
- Errors: 401 Sign in required

### GET /me

The signed in user.

- Request: `none`
- Response: `{ id, email, plan }`
- Errors: 401 Sign in required

### GET /invoices

Invoices for the signed in user, newest first.

- Request: `?limit=50&cursor=`
- Response: `{ invoices: Invoice[], next: cursor | null }`
- Errors: 401

### GET /invoices/:id

One invoice.

- Request: `none`
- Response: `Invoice`
- Errors: 404 Not found

### POST /invoices/:id/pay

Mark an invoice paid after the processor confirms.

- Request: `{ processor_ref }`
- Response: `Invoice`
- Errors: 402 Payment failed, 409 Already paid

### POST /invoices/export

CSV of every invoice for the user.

- Request: `{ from?, to? }`
- Response: `{ csv }`
- Errors: 402 Export is available on the Team plan

### GET /plans

Public plan catalog.

- Request: `none`
- Response: `{ plans: Plan[] }`
- Errors: none

### POST /plans/change

Switch plan, prorated to the day.

- Request: `{ plan }`
- Response: `{ plan, prorated_cents, effective_at }`
- Errors: 402 Card required, 409 Same plan

### GET /usage

Seats and API calls this month.

- Request: `none`
- Response: `{ seats_used, seats_included, api_calls }`
- Errors: 401

### POST /seats

Add a seat.

- Request: `{ email }`
- Response: `{ seat }`
- Errors: 402 Seat limit for plan, 409 Already a member

### DELETE /seats/:id

Remove a seat.

- Request: `none`
- Response: `{ ok: true }`
- Errors: 404 Not found

### GET /api-keys

List API keys, secrets redacted.

- Request: `none`
- Response: `{ keys: ApiKey[] }`
- Errors: 401

### POST /api-keys

Create an API key, secret shown once.

- Request: `{ name }`
- Response: `{ key, secret }`
- Errors: 402 Team plan required

### DELETE /api-keys/:id

Revoke a key.

- Request: `none`
- Response: `{ ok: true }`
- Errors: 404

### GET /webhooks

Registered webhook endpoints.

- Request: `none`
- Response: `{ endpoints: Webhook[] }`
- Errors: 401

### POST /webhooks

Register an endpoint.

- Request: `{ url, events }`
- Response: `Webhook`
- Errors: 400 Bad URL, 402 Team plan required

### POST /webhooks/:id/test

Send a test event.

- Request: `none`
- Response: `{ delivered: boolean, status }`
- Errors: 404

### GET /audit

Audit log, enterprise only.

- Request: `?limit=&cursor=`
- Response: `{ events: AuditEvent[] }`
- Errors: 402 Enterprise plan required

### GET /health

Liveness.

- Request: `none`
- Response: `{ ok: true, version }`
- Errors: none

## Types

```ts
interface Invoice { id: string; userId: string; cents: number; issuedAt: string; paid: boolean }
interface Plan { id: 'free' | 'team' | 'enterprise'; monthly_cents: number; seats_included: number; export: boolean; api_keys: boolean; webhooks: boolean; audit: boolean }
interface ApiKey { id: string; name: string; created_at: string; last_used_at: string | null }
interface Webhook { id: string; url: string; events: string[]; active: boolean }
interface AuditEvent { id: string; actor: string; action: string; at: string; ip: string }
```

## Pagination

List endpoints take `limit` (max 100) and `cursor`. The response carries `next`, an opaque cursor, or `null` on the last page. Cursors expire after ten minutes.

## Rate limits

Sixty requests per minute per token on the free plan, six hundred on team, unlimited on enterprise. Over the limit returns 429 with a `Retry-After` header in seconds.
