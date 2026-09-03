/**
 * One-shot data migration: MongoDB → Postgres. Written for the cutover; NOT
 * run during normal operation. Idempotent-ish via ON CONFLICT DO NOTHING, so a
 * re-run tops up missing rows rather than duplicating.
 *
 *   MONGODB_URI=... MONGODB_DB=signote DATABASE_URL=postgres://... \
 *     bun run db:migrate:data
 *
 * Ids are preserved verbatim: Mongo ObjectId hex strings become the TEXT
 * primary keys, so client-cached ids, cross-references and the `sid` claim in
 * already-issued JWTs keep working. The embedded `versions` arrays and `tags`
 * id arrays are unpacked into the child/join tables; array order becomes
 * `seq` / `sortOrder`.
 *
 * Not carried over: `desktop_auth_attempts`. Those rows live five minutes, so
 * anything in flight during the cutover is stale before the deploy finishes —
 * the desktop app just re-initiates.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- walks untyped BSON documents */
import { config } from 'dotenv';
import { MongoClient, type Db as MongoDb } from 'mongodb';
import postgres from 'postgres';

config({ path: '.env.local' });
config();

const BATCH = 500;

type AnyDoc = Record<string, any>;

const oid = (v: any): string | null => (v == null ? null : String(v));
const date = (v: any): Date | null => (v == null ? null : new Date(v));

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  const pgUrl = process.env.DATABASE_URL;
  if (!mongoUri) throw new Error('Missing MONGODB_URI');
  if (!pgUrl) throw new Error('Missing DATABASE_URL');

  const mongo = new MongoClient(mongoUri);
  await mongo.connect();
  const mdb = mongo.db(process.env.MONGODB_DB ?? 'signote');
  const sql = postgres(pgUrl, { max: 4 });

  const counts: Record<string, number> = {};
  const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);

  // --- Users -------------------------------------------------------------
  await eachDoc(mdb, 'users', async (d) => {
    await sql`
      insert into users (id, display_name, created_at, updated_at)
      values (${oid(d._id)}, ${d.displayName ?? ''}, ${date(d.createdAt) ?? new Date()}, ${date(d.updatedAt) ?? new Date()})
      on conflict (id) do nothing`;
    bump('users');
  });

  // --- Auth identities ---------------------------------------------------
  await eachDoc(mdb, 'auth_identities', async (d) => {
    await sql`
      insert into auth_identities
        (id, user_id, provider, provider_subject, email, email_verified, last_login_at, raw_profile_json, created_at, updated_at)
      values
        (${oid(d._id)}, ${d.userId}, ${d.provider}, ${d.providerSubject}, ${d.email ?? null},
         ${d.emailVerified ?? null}, ${date(d.lastLoginAt) ?? new Date()}, ${jsonb(sql, d.rawProfileJson)},
         ${date(d.createdAt) ?? new Date()}, ${date(d.updatedAt) ?? new Date()})
      on conflict (id) do nothing`;
    bump('auth_identities');
  });

  // --- Auth sessions -----------------------------------------------------
  await eachDoc(mdb, 'authsessions', async (d) => {
    await sql`
      insert into auth_sessions
        (id, user_id, provider, client, ip, user_agent, browser, os, device_type, created_at, updated_at, expires_at, revoked_at)
      values
        (${oid(d._id)}, ${d.userId}, ${d.provider}, ${d.client ?? 'web'}, ${d.ip ?? ''}, ${d.userAgent ?? ''}, ${d.browser ?? ''},
         ${d.os ?? ''}, ${d.deviceType ?? 'unknown'}, ${date(d.createdAt) ?? new Date()}, ${date(d.updatedAt) ?? new Date()},
         ${date(d.expiresAt)}, ${date(d.revokedAt)})
      on conflict (id) do nothing`;
    bump('auth_sessions');
  });

  // --- Auth nonces -------------------------------------------------------
  await eachDoc(mdb, 'auth_nonces', async (d) => {
    await sql`
      insert into auth_nonces (nonce, used_at, created_at, expires_at, ip)
      values (${d.nonce}, ${date(d.usedAt)}, ${date(d.createdAt) ?? new Date()}, ${date(d.expiresAt)}, ${d.ip ?? null})
      on conflict (nonce) do nothing`;
    bump('auth_nonces');
  });

  // --- Encryption profiles ----------------------------------------------
  await eachDoc(mdb, 'encryptionprofiles', async (d) => {
    await sql`
      insert into encryption_profiles (id, user_id, version, server_share, salt, kdf, key_check, created_at, updated_at)
      values (${oid(d._id)}, ${d.userId}, ${d.version}, ${d.serverShare}, ${d.salt},
              ${jsonb(sql, d.kdf)}, ${jsonb(sql, d.keyCheck)}, ${date(d.createdAt) ?? new Date()}, ${date(d.updatedAt) ?? new Date()})
      on conflict (id) do nothing`;
    bump('encryption_profiles');
  });

  // --- Tags --------------------------------------------------------------
  await eachDoc(mdb, 'tags', async (d) => {
    await sql`
      insert into tags (id, user_id, name, color, last_used_at, created_at, updated_at)
      values (${oid(d._id)}, ${d.userId}, ${d.name}, ${d.color}, ${date(d.lastUsedAt)},
              ${date(d.createdAt) ?? new Date()}, ${date(d.updatedAt) ?? new Date()})
      on conflict (id) do nothing`;
    bump('tags');
  });

  // --- File attachments --------------------------------------------------
  await eachDoc(mdb, 'fileattachments', async (d) => {
    await sql`
      insert into file_attachments
        (id, user_id, note_id, note_tier, s3_key, filename, size, mime_type, encrypted, encryption_iv,
         created_at, deleted_at, storage_deleted_at, delete_attempts, last_delete_error)
      values
        (${oid(d._id)}, ${d.userId}, ${d.noteId ?? null}, ${d.noteTier ?? null}, ${d.s3Key}, ${d.filename},
         ${d.size}, ${d.mimeType}, ${d.encrypted ?? false}, ${d.encryptionIv ?? null}, ${date(d.createdAt) ?? new Date()},
         ${date(d.deletedAt)}, ${date(d.storageDeletedAt)}, ${d.deleteAttempts ?? 0}, ${d.lastDeleteError ?? null})
      on conflict (id) do nothing`;
    bump('file_attachments');
  });

  // --- Note tiers (+ versions + tag joins) -------------------------------
  await migrateTier(sql, mdb, 'notes', 'notes', 'note_versions', 'note_tags', (d) => ({
    content: d.content ?? '',
  }));
  await migrateTier(sql, mdb, 'secretnotes', 'secret_notes', 'secret_note_versions', 'secret_note_tags', (d) => ({
    encrypted_body: jsonbVal(d.encryptedBody),
  }));
  await migrateTier(sql, mdb, 'sealnotes', 'seal_notes', 'seal_note_versions', 'seal_note_tags', (d) => ({
    encrypted_body: jsonbVal(d.encryptedBody),
    wrapped_note_key: jsonbVal(d.wrappedNoteKey),
  }));

  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);

  await sql.end();
  await mongo.close();
  console.log('migration complete');
}

// Passing a JS object through postgres.js needs `sql.json`; null stays null.
function jsonb(sql: postgres.Sql, v: any) {
  return v == null ? null : sql.json(v);
}
// Marker wrapper so migrateTier can distinguish "json column" values.
function jsonbVal(v: any) {
  return { __json: v ?? null };
}

async function eachDoc(mdb: MongoDb, collection: string, fn: (d: AnyDoc) => Promise<void>) {
  const cursor = mdb.collection(collection).find({}).batchSize(BATCH);
  for await (const doc of cursor) await fn(doc as AnyDoc);
}

async function migrateTier(
  sql: postgres.Sql,
  mdb: MongoDb,
  mongoCollection: string,
  table: string,
  versionsTable: string,
  joinTable: string,
  contentCols: (d: AnyDoc) => Record<string, any>,
) {
  let notesN = 0;
  let versionsN = 0;
  let tagsN = 0;
  let danglingTags = 0;

  await eachDoc(mdb, mongoCollection, async (d) => {
    const id = oid(d._id)!;
    const base: Record<string, any> = {
      id,
      user_id: d.userId,
      title: d.title ?? '',
      position: d.position ?? 0,
      created_at: date(d.createdAt) ?? new Date(),
      updated_at: date(d.updatedAt) ?? new Date(),
      deleted_at: date(d.deletedAt),
      archived: d.archived ?? false,
      color: d.color ?? null,
      pattern: d.pattern ?? null,
      pinned: d.pinned ?? false,
      expires_at: date(d.expiresAt),
      burn_after_reading: d.burnAfterReading ?? false,
      ...contentCols(d),
    };

    // Unwrap the jsonbVal markers into sql.json() (or null).
    for (const [k, v] of Object.entries(base)) {
      if (v && typeof v === 'object' && '__json' in v) {
        base[k] = (v as any).__json == null ? null : sql.json((v as any).__json);
      }
    }

    await sql`insert into ${sql(table)} ${sql(base)} on conflict (id) do nothing`;
    notesN++;

    // Embedded versions → child rows (array order = seq via insertion order).
    const versions: AnyDoc[] = Array.isArray(d.versions) ? d.versions : [];
    for (const v of versions) {
      const vrow: Record<string, any> = {
        id: oid(v._id) ?? undefined,
        note_id: id,
        title: v.title ?? '',
        created_at: date(v.createdAt) ?? new Date(),
      };
      if ('content' in v) vrow.content = v.content ?? '';
      if ('encryptedBody' in v) vrow.encrypted_body = v.encryptedBody == null ? null : sql.json(v.encryptedBody);
      if (vrow.id === undefined) delete vrow.id;
      await sql`insert into ${sql(versionsTable)} ${sql(vrow)} on conflict (id) do nothing`;
      versionsN++;
    }

    // tags: ObjectId[] → ordered join rows.
    const tagIds: any[] = Array.isArray(d.tags) ? d.tags : [];
    let sortOrder = 0;
    for (const t of tagIds) {
      // Mongo never enforced this reference, so a note can carry a tag id that
      // no longer exists. The join table has a real FK — skip the dangling ones
      // rather than aborting the migration. Checked separately from the insert
      // so a re-run reports "already present", not "dangling".
      const tagId = oid(t);
      const known = await sql`select 1 from tags where id = ${tagId}`;
      if (known.length === 0) {
        danglingTags++;
        continue;
      }
      await sql`
        insert into ${sql(joinTable)} (note_id, tag_id, sort_order)
        values (${id}, ${tagId}, ${sortOrder++})
        on conflict (note_id, tag_id) do nothing`;
      tagsN++;
    }
  });

  console.log(
    `  ${table}: ${notesN} (versions ${versionsN}, tag-links ${tagsN}` +
      `${danglingTags > 0 ? `, ${danglingTags} dangling tag refs skipped` : ''})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
