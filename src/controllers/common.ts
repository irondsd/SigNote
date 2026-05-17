import { type Model, type UpdateQuery, type HydratedDocument } from 'mongoose';

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
