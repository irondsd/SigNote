import { NoteModel } from '@/models/Note';

export const createNote = async (address: string, title: string, content: string) => {
  const now = new Date();

  const note = await NoteModel.create({
    address,
    title,
    content,
    createdAt: now,
    updatedAt: now,
  });

  return note;
};

export const getNotesByAddress = async (address: string, archived = false, limit = 30, offset = 0) => {
  return NoteModel.find({ address, archived, deletedAt: null })
    .sort({ createdAt: -1 })
    .skip(offset)
    .limit(limit)
    .exec();
};

export const getNoteById = async (id: string) => {
  return NoteModel.findById(id).exec();
};

export const updateNote = async (id: string, title: string, content: string) => {
  const now = new Date();

  return NoteModel.findByIdAndUpdate(
    id,
    {
      title,
      content,
      updatedAt: now,
    },
    {
      new: true,
    },
  ).exec();
};

export const deleteNote = async (id: string) => {
  return NoteModel.findByIdAndUpdate(id, { deletedAt: new Date() }, { new: true }).exec();
};

export const undeleteNote = async (id: string) => {
  return NoteModel.findByIdAndUpdate(id, { deletedAt: null }, { new: true }).exec();
};

export const archiveNote = async (id: string) => {
  return NoteModel.findByIdAndUpdate(id, { archived: true }, { new: true }).exec();
};

export const unarchiveNote = async (id: string) => {
  return NoteModel.findByIdAndUpdate(id, { archived: false }, { new: true }).exec();
};
