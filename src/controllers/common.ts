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
  };
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
  const baseQuery = { userId, ...(archived !== undefined && { archived }), deletedAt: null };
  const normalized = search.trim().slice(0, MAX_SEARCH);

  if (!normalized) {
    return model.find(baseQuery).sort({ position: -1 }).skip(offset).limit(limit).exec();
  }

  const regex = new RegExp(escapeRegExp(normalized), 'i');

  return model
    .find({
      ...baseQuery,
      $or: searchFields.map((field) => ({ [field]: regex })),
    })
    .sort({ updatedAt: -1 })
    .skip(offset)
    .limit(limit)
    .exec();
}
