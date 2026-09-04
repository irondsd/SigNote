ALTER TABLE "users" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_owner_identity_id" text;--> statement-breakpoint

-- Backfill: adopt the address of every existing Google identity as the user's
-- own, treating it as verified.
--
-- We never captured `email_verified` before this release, so those rows are
-- NULL and there is no way to tell "verified" from "never asked". Google sets
-- the flag true on every real account, so adopting them is the pragmatic call
-- — and the alternative, making existing users re-prove an address they have
-- been signing in with for months, buys nothing. `auth_identities.email_verified`
-- is deliberately left NULL: that column is what the provider actually told
-- us, and it will fill in truthfully on the next sign-in.
--
-- Both directions of the uniqueness rule are enforced here, before the index
-- exists to enforce them: at most one user per address (email_rank), and at
-- most one address per user (user_rank). Ties break on the older identity.
WITH ranked AS (
  SELECT
    ai.id,
    ai.user_id,
    lower(ai.email) AS email,
    ai.created_at,
    row_number() OVER (PARTITION BY lower(ai.email) ORDER BY ai.created_at, ai.id) AS email_rank
  FROM auth_identities ai
  WHERE ai.provider = 'google' AND ai.email IS NOT NULL AND ai.email <> ''
), picked AS (
  SELECT *, row_number() OVER (PARTITION BY user_id ORDER BY created_at, id) AS user_rank
  FROM ranked
  WHERE email_rank = 1
)
UPDATE users u
SET email = p.email,
    email_verified_at = p.created_at,
    email_owner_identity_id = p.id
FROM picked p
WHERE u.id = p.user_id AND p.user_rank = 1 AND u.email IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));
