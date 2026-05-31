import { type Model, type UpdateQuery, type HydratedDocument } from 'mongoose';
import { MAX_SEARCH } from '@/config/constants';
import { getNextPosition } from '@/utils/calculatePosition';
import { escapeRegExp } from '@/utils/regexUtils';

type CommonFields = {
  deletedAt: Date | null;
  archived: boolean;
  color: string | null;
  pattern: string | null;
  position: number;
  pinned: boolean;
  expiresAt: Date | null;
  burnAfterReading: boolean;
};

export function commonOps<T extends CommonFields>(model: Model<T>) {
  type Doc = HydratedDocument<T> | null;
  type Update = UpdateQuery<T>;

  const exec = (id: string, update: Update): Promise<Doc> =>
    model.findByIdAndUpdate(id, update, { returnDocument: 'after' }).exec();

  return {
    softDelete: (id: string) => exec(id, { deletedAt: new Date() } as Update),
    restore: (id: string) => exec(id, { deletedAt: null } as Update),
    archive: (id: string) => exec(id, { archived: true } as Update),
    unarchive: (id: string) => exec(id, { archived: false } as Update),
    updateColor: (id: string, color: string | null) => exec(id, { color } as Update),
    updatePattern: (id: string, pattern: string | null) => exec(id, { pattern } as Update),
    updatePosition: (id: string, position: number) => exec(id, { position } as Update),
    // Use $set explicitly so null values are stored as null (not stripped
    // back to schema defaults by Mongoose's plain-object update shorthand).
    applyPatch: (id: string, update: Partial<CommonFields>) => exec(id, { $set: update } as Update),
  };
}

// Lenient grace matches the TTL `expireAfterSeconds: 3600` on `expiresAt`: while
// the doc is still physically in Mongo, the in-modal user can PATCH expiresAt=null
// to cancel the deletion. Strict-future filtering happens in `listByUserId`.
export function getByIdActive<T extends CommonFields>(model: Model<T>, id: string) {
  const graceCutoff = new Date(Date.now() - 3600_000);
  return model.findOne({ _id: id, $or: [{ expiresAt: null }, { expiresAt: { $gt: graceCutoff } }] }).exec();
}

export async function createEntity<T extends CommonFields>(
  model: Model<T>,
  userId: string,
  data: Record<string, unknown>,
  color?: string | null,
  pattern?: string | null,
) {
  const now = new Date();
  const position = await getNextPosition(model as unknown as Model<{ position?: number; userId: string }>, userId);

  return model.create({
    userId,
    ...data,
    position,
    ...(color != null && { color }),
    ...(pattern != null && { pattern }),
    createdAt: now,
    updatedAt: now,
  } as unknown as T);
}

export async function listByUserId<T extends CommonFields>(
  model: Model<T>,
  userId: string,
  opts: { archived?: boolean; limit?: number; offset?: number; search?: string; searchFields?: string[] } = {},
) {
  const { archived, limit = 30, offset = 0, search = '', searchFields = ['title'] } = opts;
  const baseQuery = {
    userId,
    ...(archived !== undefined && { archived }),
    deletedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  };
  const normalized = search.trim().slice(0, MAX_SEARCH);

  if (!normalized) {
    return model.find(baseQuery).sort({ pinned: -1, position: -1 }).skip(offset).limit(limit).exec();
  }

  const regex = new RegExp(escapeRegExp(normalized), 'i');

  return model
    .find({
      $and: [baseQuery, { $or: searchFields.map((field) => ({ [field]: regex })) }],
    })
    .sort({ pinned: -1, updatedAt: -1 })
    .skip(offset)
    .limit(limit)
    .exec();
}
