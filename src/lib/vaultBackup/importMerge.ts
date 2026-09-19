import { attachmentAggregate, authenticatorAggregate, canonicalJson, tierAggregate } from './aggregate';
import type { VaultExportCategory } from './exportTypes';
import type {
  PortableAttachment,
  PortableAuthenticator,
  PortableTierRecord,
  VaultImportAnalysis,
  VaultImportLookupAttachment,
  VaultImportLookupRecord,
  VaultImportPlan,
  VaultImportStagedRecord,
  VaultImportTagPolicy,
} from './importTypes';

/**
 * The client half of a merge: decide, per archived record, whether the
 * destination already has it (identical — skip), has a different version
 * (conflict — the user chooses), or doesn't (new — insert). Pure, so the Worker
 * runs it and tests can too; `hash` is SHA-256 hex over a UTF-8 string.
 */

export type ImportDecision = 'keep' | 'replace' | 'copy';

type TierCategory = Exclude<VaultExportCategory, 'authenticators'>;
type ArchiveRecord = PortableTierRecord | PortableAuthenticator;
type ArchiveAttachment = VaultImportAnalysis['attachments'][number];

export type ImportRecordSummary = {
  title: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  archived: boolean;
  color: string | null;
  pattern: string | null;
  revision: number | null;
};

export type ImportConflict = {
  category: VaultExportCategory;
  id: string;
  /** The destination digest reviewed; commit refuses if it has changed. */
  expected: string;
  archive: ImportRecordSummary;
  existing: ImportRecordSummary;
  /** Null when allowed; otherwise why not. */
  replaceBlocked: 'attachment-in-use' | null;
  copyBlocked: 'bound-to-id' | 'attachment-in-use' | null;
};

/** A new record that cannot be inserted: one of its attachment ids is taken
 * here by a different file, and bodies name attachments by id. */
export type ImportBlocked = { category: VaultExportCategory; id: string; archive: ImportRecordSummary };

export type ImportComparison = {
  counts: Record<VaultExportCategory, { new: number; identical: number; conflict: number; blocked: number }>;
  conflicts: ImportConflict[];
  blocked: ImportBlocked[];
};

type Status =
  | { kind: 'new' }
  | { kind: 'identical' }
  | { kind: 'blocked' }
  | { kind: 'conflict'; expected: string; reusable: Set<string>; replaceable: boolean };

export type ImportComparisonState = {
  statuses: Map<string, Status>;
  comparison: ImportComparison;
};

const key = (category: VaultExportCategory, id: string) => `${category}:${id}`;

function summarize(record: ArchiveRecord): ImportRecordSummary {
  const tier = 'title' in record;
  return {
    title: tier ? (record as PortableTierRecord).title : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt,
    archived: record.archived,
    color: record.color,
    pattern: record.pattern,
    revision: tier ? null : (record as PortableAuthenticator).revision,
  };
}

function summarizeExisting(row: VaultImportLookupRecord): ImportRecordSummary {
  const { title, createdAt, updatedAt, deletedAt, archived, color, pattern, revision } = row;
  return { title, createdAt, updatedAt, deletedAt, archived, color, pattern, revision };
}

/** The archived record's aggregate digest, comparable with the server's. */
export function archiveDigest(
  category: VaultExportCategory,
  record: ArchiveRecord,
  tagNames: Map<string, string>,
  attachments: Map<string, ArchiveAttachment>,
  hash: (text: string) => string,
): string {
  if (category === 'authenticators')
    return hash(canonicalJson(authenticatorAggregate(record as PortableAuthenticator)));
  const tier = record as PortableTierRecord;
  return hash(
    canonicalJson(
      tierAggregate(
        category,
        tier,
        tier.tagRefs.map((id) => tagNames.get(id) ?? id),
        tier.attachmentRefs.map((id) => attachments.get(id)!).filter(Boolean),
      ),
    ),
  );
}

const attachmentDigest = (attachment: PortableAttachment, hash: (text: string) => string) =>
  hash(canonicalJson(attachmentAggregate(attachment)));

export function compareArchive(
  analysis: VaultImportAnalysis,
  records: Record<VaultExportCategory, ArchiveRecord[]>,
  existing: Record<VaultExportCategory, Map<string, VaultImportLookupRecord>>,
  existingFiles: Map<string, VaultImportLookupAttachment>,
  hash: (text: string) => string,
): ImportComparisonState {
  const tagNames = new Map(analysis.tags.map((tag) => [tag.sourceId, tag.normalizedName]));
  const attachments = new Map(analysis.attachments.map((attachment) => [attachment.id, attachment]));
  const statuses = new Map<string, Status>();
  const comparison: ImportComparison = {
    counts: {
      notes: { new: 0, identical: 0, conflict: 0, blocked: 0 },
      secrets: { new: 0, identical: 0, conflict: 0, blocked: 0 },
      seals: { new: 0, identical: 0, conflict: 0, blocked: 0 },
      authenticators: { new: 0, identical: 0, conflict: 0, blocked: 0 },
    },
    conflicts: [],
    blocked: [],
  };

  for (const category of Object.keys(records) as VaultExportCategory[]) {
    for (const record of records[category]) {
      const refs = 'attachmentRefs' in record ? record.attachmentRefs : [];
      // Attachment ids this account already holds, split by whether the row
      // here is the very same file under the same owner.
      const same = new Set<string>();
      const taken = new Set<string>();
      for (const id of refs) {
        const found = existingFiles.get(id);
        if (!found) continue;
        const archived = attachments.get(id);
        if (archived && found.digest !== null && found.digest === attachmentDigest(archived, hash)) same.add(id);
        else taken.add(id);
      }

      const current = existing[category].get(record.id);
      let status: Status;
      if (!current) {
        status = taken.size || same.size ? { kind: 'blocked' } : { kind: 'new' };
      } else if (current.digest === archiveDigest(category, record, tagNames, attachments, hash)) {
        status = { kind: 'identical' };
      } else {
        status = { kind: 'conflict', expected: current.digest, reusable: same, replaceable: taken.size === 0 };
        const copyBlocked =
          category === 'seals' || category === 'authenticators'
            ? ('bound-to-id' as const)
            : // A Secret's ciphertext body names its attachments by id, so a copy
              // must keep them — impossible while those ids are in use here.
              category === 'secrets' && (taken.size || same.size)
              ? ('attachment-in-use' as const)
              : null;
        comparison.conflicts.push({
          category,
          id: record.id,
          expected: current.digest,
          archive: summarize(record),
          existing: summarizeExisting(current),
          replaceBlocked: taken.size ? 'attachment-in-use' : null,
          copyBlocked,
        });
      }
      if (status.kind === 'blocked') comparison.blocked.push({ category, id: record.id, archive: summarize(record) });
      statuses.set(key(category, record.id), status);
      comparison.counts[category][status.kind === 'blocked' ? 'blocked' : status.kind]++;
    }
  }
  return { statuses, comparison };
}

export type ImportPlanResult = {
  plan: VaultImportPlan;
  staged: Record<VaultExportCategory, VaultImportStagedRecord[]>;
  /** Archived attachment ids to upload. */
  uploads: Set<string>;
};

/** Turns the review's decisions into what gets staged. Anything undecided is
 * kept as it is; a decision the comparison ruled out is refused. */
export function buildImportPlan(
  analysis: VaultImportAnalysis,
  records: Record<VaultExportCategory, ArchiveRecord[]>,
  state: ImportComparisonState,
  decisions: Map<string, ImportDecision>,
  tagPolicy: VaultImportTagPolicy,
): ImportPlanResult {
  const sizes = new Map(analysis.attachments.map((attachment) => [attachment.id, attachment.size]));
  const conflicts = new Map(
    state.comparison.conflicts.map((conflict) => [key(conflict.category, conflict.id), conflict]),
  );
  const staged: ImportPlanResult['staged'] = { notes: [], secrets: [], seals: [], authenticators: [] };
  const uploads = new Set<string>();

  for (const category of Object.keys(records) as VaultExportCategory[]) {
    for (const record of records[category]) {
      const status = state.statuses.get(key(category, record.id));
      if (!status || status.kind === 'identical' || status.kind === 'blocked') continue;
      const refs = 'attachmentRefs' in record ? record.attachmentRefs : [];
      if (status.kind === 'new') {
        staged[category].push({ action: 'insert', expected: null, record });
        refs.forEach((id) => uploads.add(id));
        continue;
      }
      const decision = decisions.get(key(category, record.id)) ?? 'keep';
      const conflict = conflicts.get(key(category, record.id))!;
      if (decision === 'keep') continue;
      if (decision === 'replace') {
        if (conflict.replaceBlocked) throw new Error('IMPORT_DECISION_NOT_ALLOWED');
        staged[category].push({ action: 'replace', expected: status.expected, record });
        refs.filter((id) => !status.reusable.has(id)).forEach((id) => uploads.add(id));
      } else {
        if (conflict.copyBlocked) throw new Error('IMPORT_DECISION_NOT_ALLOWED');
        staged[category].push({ action: 'copy', expected: null, record });
        refs.forEach((id) => uploads.add(id));
      }
    }
  }

  let expectedAttachmentBytes = 0;
  for (const id of uploads) expectedAttachmentBytes += sizes.get(id) ?? 0;
  return {
    plan: {
      tagPolicy,
      expected: {
        notes: staged.notes.length,
        secrets: staged.secrets.length,
        seals: staged.seals.length,
        authenticators: staged.authenticators.length,
        attachments: uploads.size,
      },
      expectedAttachmentBytes,
    },
    staged,
    uploads,
  };
}

export const importDecisionKey = key;
export type { TierCategory };
