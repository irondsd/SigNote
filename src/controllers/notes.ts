import { Address } from 'viem';

import { POSITION_STEP } from '@/config/constants';
import { NoteModel } from '@/models/Note';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const getNextPosition = async (address: Address) => {
  const lastNote = await NoteModel.findOne({ address, deletedAt: null })
    .sort({ position: -1 })
    .select({ position: 1 })
    .lean()
    .exec();

  return (lastNote?.position ?? 0) + POSITION_STEP;
};

export const createNote = async (address: Address, title: string, content: string) => {
  const now = new Date();
  const position = await getNextPosition(address);

  const note = await NoteModel.create({
    address,
    title,
    content,
    position,
    createdAt: now,
    updatedAt: now,
  });

  return note;
};

export const getNotesByAddress = async (address: string, archived = false, limit = 30, offset = 0, search = '') => {
  const baseQuery = { address, archived, deletedAt: null };
  const normalizedSearch = search.trim();

  if (!normalizedSearch) {
    return NoteModel.find(baseQuery).sort({ position: -1 }).skip(offset).limit(limit).exec();
  }

  const safeSearchRegex = new RegExp(escapeRegExp(normalizedSearch), 'i');

  return NoteModel.find({
    ...baseQuery,
    $or: [{ title: safeSearchRegex }, { content: safeSearchRegex }],
  })
    .sort({ updatedAt: -1 })
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
