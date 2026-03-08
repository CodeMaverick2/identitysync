# IdentitySync - Identity Reconciliation

REST API that identifies and links customer contact details across multiple purchases, returning a single consolidated identity.

---

## Live API

**Base URL:** `https://identitysync-lw5t.onrender.com`

> **Note:** Hosted on Render's free tier — the instance spins down after 15 minutes of inactivity. First request may take ~30 seconds to cold-start.

```bash
curl -X POST https://identitysync-lw5t.onrender.com/identify \
  -H "Content-Type: application/json" \
  -d '{"email": "rahul.sharma@gmail.com", "phoneNumber": "9876543210"}'
```

---

## API

### `POST /identify`

**Request** (`application/json`) — at least one field required:

```json
{ "email": "rahul.sharma@gmail.com", "phoneNumber": "9876543210" }
```

`phoneNumber` can be a string or integer. Either field can be `null` or omitted as long as the other is present.

**Response `200`:**

```json
{
  "contact": {
    "primaryContatctId": 1,
    "emails": ["rahul.sharma@gmail.com", "rahul.s@work.com"],
    "phoneNumbers": ["9876543210"],
    "secondaryContactIds": [23]
  }
}
```

- `primaryContatctId` — ID of the oldest contact in the linked chain *(typo preserved from spec)*
- `emails` — all unique emails, primary's first
- `phoneNumbers` — all unique phones, primary's first
- `secondaryContactIds` — IDs of all secondary contacts, ordered by creation time

**Behaviour:**

| Scenario | What happens |
|---|---|
| No existing match | New primary contact created |
| Shares email or phone with existing, but has new info | New secondary created, linked to primary |
| Bridges two separate chains | Chains merge — older primary stays primary |
| Exact same request repeated | Idempotent — no new row, same response |

**Errors:**

| Status | Reason |
|---|---|
| `400` | Both `email` and `phoneNumber` absent or null |
| `500` | Server / database error |

### `GET /health`

```json
{ "status": "ok", "timestamp": "2024-01-01T00:00:00.000Z" }
```

---

## Local Setup

**Prerequisites:** Node.js 18+, a PostgreSQL database

```bash
git clone https://github.com/CodeMaverick2/identitysync && cd identitysync
cp .env.example .env          # then set DATABASE_URL in .env
npm install
npm run dev                   # starts on port 3000, migrations run automatically
```

---

## Tests

```bash
npm test   # 18 integration tests — requires DATABASE_URL in .env
```

---

## Tech Stack

Node.js · TypeScript · Express · PostgreSQL · Zod · Vitest
