import type { Config } from "../config/index.js";
import { getPool } from "./client.js";

const MIGRATION = `
CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  phone_number VARCHAR(50),
  email VARCHAR(255),
  linked_id INT REFERENCES contacts(id),
  link_precedence VARCHAR(20) NOT NULL CHECK (link_precedence IN ('primary', 'secondary')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT at_least_one_contact CHECK (phone_number IS NOT NULL OR email IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_linked_id ON contacts(linked_id);
`;

export async function runMigrations(config: Config): Promise<void> {
  const pool = getPool(config);
  await pool.query(MIGRATION);
}
