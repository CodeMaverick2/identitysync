import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { loadConfig } from "../src/config/index.js";
import { getPool } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { createApp } from "../src/app.js";

const config = loadConfig();
const pool = getPool(config);
const app = createApp(pool);

async function clear() {
  await pool.query("DELETE FROM contacts");
}

describe("POST /identify", () => {
  beforeAll(async () => {
    await runMigrations(config);
  });

  afterAll(async () => {
    await pool.end();
  });

  // ── 1. New contact creation ──────────────────────────────────────────────

  describe("new contact creation", () => {
    beforeAll(clear);

    it("creates a primary contact with both email and phone", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ email: "lorraine@hillvalley.edu", phoneNumber: "123456" });

      expect(res.status).toBe(200);
      const { contact: c } = res.body;
      expect(c.primaryContatctId).toBeGreaterThan(0);
      expect(c.emails).toEqual(["lorraine@hillvalley.edu"]);
      expect(c.phoneNumbers).toEqual(["123456"]);
      expect(c.secondaryContactIds).toEqual([]);
    });

    it("creates a primary contact with email only", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ email: "emailonly@hillvalley.edu" });

      expect(res.status).toBe(200);
      const { contact: c } = res.body;
      expect(c.emails).toEqual(["emailonly@hillvalley.edu"]);
      expect(c.phoneNumbers).toEqual([]);
      expect(c.secondaryContactIds).toEqual([]);
    });

    it("creates a primary contact with phone only", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ phoneNumber: "999000" });

      expect(res.status).toBe(200);
      const { contact: c } = res.body;
      expect(c.emails).toEqual([]);
      expect(c.phoneNumbers).toEqual(["999000"]);
      expect(c.secondaryContactIds).toEqual([]);
    });

    it("accepts phoneNumber as an integer (spec says number type)", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ email: "integer@test.com", phoneNumber: 777777 });

      expect(res.status).toBe(200);
      const { contact: c } = res.body;
      expect(c.phoneNumbers).toEqual(["777777"]);
      expect(c.secondaryContactIds).toEqual([]);
    });
  });

  // ── 2. Secondary creation ────────────────────────────────────────────────

  describe("secondary contact creation", () => {
    beforeAll(async () => {
      await clear();
      // Seed: primary with lorraine + 123456
      await request(app)
        .post("/identify")
        .send({ email: "lorraine@hillvalley.edu", phoneNumber: "123456" });
    });

    it("creates secondary when new email shares phone with primary", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ email: "mcfly@hillvalley.edu", phoneNumber: "123456" });

      expect(res.status).toBe(200);
      const { contact: c } = res.body;
      // Primary's email must come first
      expect(c.emails[0]).toBe("lorraine@hillvalley.edu");
      expect(c.emails).toContain("mcfly@hillvalley.edu");
      expect(c.phoneNumbers).toEqual(["123456"]);
      expect(c.secondaryContactIds).toHaveLength(1);
    });

    it("accumulates multiple secondaries — all appear in secondaryContactIds", async () => {
      // Add a second secondary
      await request(app)
        .post("/identify")
        .send({ email: "doc@hillvalley.edu", phoneNumber: "123456" });

      const res = await request(app)
        .post("/identify")
        .send({ email: "lorraine@hillvalley.edu", phoneNumber: "123456" });

      expect(res.status).toBe(200);
      const { contact: c } = res.body;
      expect(c.emails[0]).toBe("lorraine@hillvalley.edu");
      expect(c.emails).toHaveLength(3);
      expect(c.phoneNumbers).toEqual(["123456"]);
      expect(c.secondaryContactIds).toHaveLength(2);
    });
  });

  // ── 3. Idempotency ───────────────────────────────────────────────────────

  describe("idempotency — any query into the same chain returns the same contact", () => {
    let primaryId: number;

    beforeAll(async () => {
      await clear();
      const r1 = await request(app)
        .post("/identify")
        .send({ email: "lorraine@hillvalley.edu", phoneNumber: "123456" });
      await request(app)
        .post("/identify")
        .send({ email: "mcfly@hillvalley.edu", phoneNumber: "123456" });
      primaryId = r1.body.contact.primaryContatctId;
    });

    const queries = [
      { email: "lorraine@hillvalley.edu", phoneNumber: "123456" },
      { email: "mcfly@hillvalley.edu", phoneNumber: "123456" },
      { email: null, phoneNumber: "123456" },
      { email: "lorraine@hillvalley.edu", phoneNumber: null },
      { email: "mcfly@hillvalley.edu", phoneNumber: null },
    ];

    for (const payload of queries) {
      it(`returns same consolidated contact for ${JSON.stringify(payload)}`, async () => {
        const res = await request(app).post("/identify").send(payload);
        expect(res.status).toBe(200);
        const { contact: c } = res.body;
        expect(c.primaryContatctId).toBe(primaryId);
        expect([...c.emails].sort()).toEqual(
          ["lorraine@hillvalley.edu", "mcfly@hillvalley.edu"].sort()
        );
        expect(c.phoneNumbers).toContain("123456");
        expect(c.secondaryContactIds).toHaveLength(1);
      });
    }
  });

  // ── 4. Cross-link merge ──────────────────────────────────────────────────

  describe("cross-link: merging two separate chains", () => {
    let georgeId: number;

    beforeAll(async () => {
      await clear();
      const r = await request(app)
        .post("/identify")
        .send({ email: "george@hillvalley.edu", phoneNumber: "919191" });
      georgeId = r.body.contact.primaryContatctId;

      await request(app)
        .post("/identify")
        .send({ email: "biffsucks@hillvalley.edu", phoneNumber: "717171" });
    });

    it("makes newer primary secondary to the older one", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ email: "george@hillvalley.edu", phoneNumber: "717171" });

      expect(res.status).toBe(200);
      const { contact: c } = res.body;
      expect(c.primaryContatctId).toBe(georgeId);
      expect(c.emails[0]).toBe("george@hillvalley.edu");   // older primary email first
      expect(c.phoneNumbers[0]).toBe("919191");             // older primary phone first
      expect(c.emails).toContain("biffsucks@hillvalley.edu");
      expect(c.phoneNumbers).toContain("717171");
      expect(c.secondaryContactIds).toHaveLength(1);
    });

    it("merged chain remains stable — any further query returns same primary", async () => {
      const r1 = await request(app)
        .post("/identify")
        .send({ email: "biffsucks@hillvalley.edu" });
      const r2 = await request(app)
        .post("/identify")
        .send({ phoneNumber: "919191" });

      expect(r1.body.contact.primaryContatctId).toBe(georgeId);
      expect(r2.body.contact.primaryContatctId).toBe(georgeId);
    });
  });

  // ── 5. Email normalization ───────────────────────────────────────────────

  describe("email normalization", () => {
    beforeAll(async () => {
      await clear();
      await request(app)
        .post("/identify")
        .send({ email: "doc@hillvalley.edu", phoneNumber: "555000" });
    });

    it("treats email as case-insensitive (uppercased input matches stored lowercase)", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ email: "DOC@HILLVALLEY.EDU", phoneNumber: "555000" });

      expect(res.status).toBe(200);
      const { contact: c } = res.body;
      expect(c.emails).toEqual(["doc@hillvalley.edu"]); // no duplicate
      expect(c.secondaryContactIds).toEqual([]);          // idempotent
    });

    it("stores email in lowercase regardless of input casing", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ email: "NEWGUY@HILLVALLEY.EDU", phoneNumber: "555001" });

      expect(res.status).toBe(200);
      expect(res.body.contact.emails).toEqual(["newguy@hillvalley.edu"]);
    });
  });

  // ── 6. Input validation ──────────────────────────────────────────────────

  describe("input validation", () => {
    it("returns 400 when both fields are absent", async () => {
      const res = await request(app).post("/identify").send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it("returns 400 when both fields are null", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ email: null, phoneNumber: null });
      expect(res.status).toBe(400);
    });

    it("treats empty string email as absent — uses phoneNumber as sole field", async () => {
      const res = await request(app)
        .post("/identify")
        .send({ email: "", phoneNumber: "888111" });
      expect(res.status).toBe(200);
      const { contact: c } = res.body;
      expect(c.emails).toEqual([]);
      expect(c.phoneNumbers).toContain("888111");
    });
  });
});
