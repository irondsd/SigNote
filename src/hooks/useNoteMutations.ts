'use client';

import { useQueryClient, useMutation } from '@tanstack/react-query';

type CreateNoteInput = { title: string; content: string };
type UpdateNoteInput = { id: string; title?: string; content?: string; archived?: boolean };

async function apiCreateNote(input: CreateNoteInput) {
  const res = await fetch('/api/notes/t1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('Failed to create note');
  return res.json();
}

async function apiDeleteNote(id: string) {
  const res = await fetch(`/api/notes/t1/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete note');
  return res.json();
}

async function apiUpdateNote({ id, ...data }: UpdateNoteInput) {
  const res = await fetch(`/api/notes/t1/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update note');
  return res.json();
}

export const useCreateNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiCreateNote,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
};

export const useDeleteNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiDeleteNote,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
};

export const useUpdateNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: apiUpdateNote,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  });
};
