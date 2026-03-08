import type { Pool, PoolClient } from "pg";
import type { Contact, IdentifyResponse } from "./identify.types.js";
import type { IdentifyBody } from "./identify.validation.js";

const CHAIN_CTE = `
  WITH RECURSIVE chain AS (
    SELECT id, phone_number, email, linked_id, link_precedence, created_at, updated_at, deleted_at
    FROM contacts WHERE id = $1 AND deleted_at IS NULL
    UNION ALL
    SELECT c.id, c.phone_number, c.email, c.linked_id, c.link_precedence, c.created_at, c.updated_at, c.deleted_at
    FROM contacts c
    INNER JOIN chain ch ON c.linked_id = ch.id
    WHERE c.deleted_at IS NULL
  )
  SELECT * FROM chain
`;

type ContactRow = {
  id: number;
  phone_number: string | null;
  email: string | null;
  linked_id: number | null;
  link_precedence: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
};

function toContact(r: ContactRow): Contact {
  return {
    id: r.id,
    phoneNumber: r.phone_number,
    email: r.email,
    linkedId: r.linked_id,
    linkPrecedence: r.link_precedence as "primary" | "secondary",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

async function fetchChain(client: PoolClient, primaryId: number): Promise<ContactRow[]> {
  const result = await client.query(CHAIN_CTE, [primaryId]);
  return result.rows as ContactRow[];
}

function normalizeEmail(v: string | undefined): string | undefined {
  if (v == null || v === "") return undefined;
  return v.trim().toLowerCase() || undefined;
}

function normalizePhone(v: string | number | undefined): string | undefined {
  if (v == null || v === "") return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function getPrimaryOf(contact: Contact, allContacts: Map<number, Contact>): Contact {
  if (contact.linkPrecedence === "primary" || contact.linkedId == null) {
    return contact;
  }
  const linked = allContacts.get(contact.linkedId);
  if (!linked) return contact;
  return getPrimaryOf(linked, allContacts);
}

function buildResponse(primary: Contact, secondaries: Contact[]): IdentifyResponse {
  const sorted = [...secondaries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const all = [primary, ...sorted];

  const emails: string[] = [];
  const phoneNumbers: string[] = [];
  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();
  for (const c of all) {
    if (c.email && !seenEmails.has(c.email)) {
      seenEmails.add(c.email);
      emails.push(c.email);
    }
    if (c.phoneNumber && !seenPhones.has(c.phoneNumber)) {
      seenPhones.add(c.phoneNumber);
      phoneNumbers.push(c.phoneNumber);
    }
  }

  return {
    contact: {
      primaryContatctId: primary.id,
      emails,
      phoneNumbers,
      secondaryContactIds: sorted.map((s) => s.id),
    },
  };
}

export type IdentifyService = ReturnType<typeof createIdentifyService>;

export function createIdentifyService(pool: Pool) {
  return {
    async identify(body: IdentifyBody): Promise<IdentifyResponse> {
      const email = normalizeEmail(body.email ?? undefined);
      const phone = normalizePhone(body.phoneNumber ?? undefined);
      if (!email && !phone) {
        throw new Error("At least one of email or phoneNumber is required");
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const conds: string[] = [];
        const params: (string | null)[] = [];
        let idx = 1;
        if (email) {
          conds.push(`email = $${idx++}`);
          params.push(email);
        }
        if (phone) {
          conds.push(`phone_number = $${idx++}`);
          params.push(phone);
        }
        const matchQuery = `
          SELECT id, phone_number, email, linked_id, link_precedence, created_at, updated_at, deleted_at
          FROM contacts
          WHERE deleted_at IS NULL AND (${conds.join(" OR ")})
        `;
        const matches = await client.query(matchQuery, params);

        const rows = matches.rows as ContactRow[];
        const allMatches = rows.map(toContact);
        const matchMap = new Map(allMatches.map((c) => [c.id, c]));

        let idsToFetch = new Set(allMatches.flatMap((c) => (c.linkedId ? [c.linkedId] : [])));
        while (idsToFetch.size > 0) {
          const missing = [...idsToFetch].filter((id) => !matchMap.has(id));
          if (missing.length === 0) break;
          const fetched = await client.query(
            `SELECT id, phone_number, email, linked_id, link_precedence, created_at, updated_at, deleted_at
             FROM contacts WHERE id = ANY($1::int[]) AND deleted_at IS NULL`,
            [missing]
          );
          idsToFetch = new Set<number>();
          for (const r of fetched.rows as ContactRow[]) {
            const c = toContact(r);
            matchMap.set(c.id, c);
            if (c.linkedId) idsToFetch.add(c.linkedId);
          }
        }

        if (allMatches.length === 0) {
          const inserted = await client.query(
            `INSERT INTO contacts (email, phone_number, linked_id, link_precedence)
             VALUES ($1, $2, NULL, 'primary')
             RETURNING id, phone_number, email, linked_id, link_precedence, created_at, updated_at, deleted_at`,
            [email ?? null, phone ?? null]
          );
          const newContact = toContact(inserted.rows[0] as ContactRow);
          await client.query("COMMIT");
          return buildResponse(newContact, []);
        }

        const primaries = new Map<number, Contact>();
        for (const c of allMatches) {
          const p = getPrimaryOf(c, matchMap);
          primaries.set(p.id, p);
        }

        let primary: Contact;
        const primaryList = Array.from(primaries.values());

        if (primaryList.length > 1) {
          primaryList.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          primary = primaryList[0];
          const toDemote = primaryList.slice(1);
          for (const p of toDemote) {
            await client.query(
              `UPDATE contacts SET linked_id = $1, link_precedence = 'secondary', updated_at = NOW() WHERE id = $2`,
              [primary.id, p.id]
            );
            await client.query(
              `UPDATE contacts SET linked_id = $1, updated_at = NOW() WHERE linked_id = $2`,
              [primary.id, p.id]
            );
          }
        } else {
          primary = primaryList[0];
        }

        const chainRows = await fetchChain(client, primary.id);
        const hasExact = chainRows.some(
          (r) =>
            (r.email === email || (email == null && r.email == null)) &&
            (r.phone_number === phone || (phone == null && r.phone_number == null))
        );
        const hasNewInfo =
          (email && !chainRows.some((r) => r.email === email)) ||
          (phone && !chainRows.some((r) => r.phone_number === phone));

        if (!hasExact && hasNewInfo) {
          await client.query(
            `INSERT INTO contacts (email, phone_number, linked_id, link_precedence)
             VALUES ($1, $2, $3, 'secondary')`,
            [email ?? null, phone ?? null, primary.id]
          );
        }

        const finalRows = await fetchChain(client, primary.id);
        const primaryRow = finalRows.find((r) => r.id === primary.id)!;
        const secondaryRows = finalRows.filter((r) => r.id !== primary.id);
        const secondaryContacts = secondaryRows.map(toContact);

        await client.query("COMMIT");
        return buildResponse(toContact(primaryRow), secondaryContacts);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
  };
}
