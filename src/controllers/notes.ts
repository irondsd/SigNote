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

// todo: pagination
export const getNotesByAddress = async (address: string) => {
  return NoteModel.find({ address }).sort({ createdAt: -1 }).exec();
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
  return NoteModel.findByIdAndDelete(id).exec();
};
