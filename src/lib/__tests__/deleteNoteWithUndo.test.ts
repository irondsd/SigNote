import { toast } from 'sonner';
import { deleteNoteWithUndo } from '@/lib/deleteNoteWithUndo';

jest.mock('sonner', () => ({ toast: { success: jest.fn() } }));

it('deletes and closes immediately, then restores only when Undo is clicked', () => {
  const order: string[] = [];
  deleteNoteWithUndo(
    'Secret',
    () => order.push('delete'),
    () => order.push('close'),
    () => order.push('undo'),
  );

  expect(order).toEqual(['delete', 'close']);
  expect(toast.success).toHaveBeenCalledWith(
    'Secret deleted',
    expect.objectContaining({ description: 'You can undo this action.', duration: 7000 }),
  );

  const options = (toast.success as jest.Mock).mock.calls[0][1];
  options.action.onClick();
  expect(order).toEqual(['delete', 'close', 'undo']);
  expect(toast.success).toHaveBeenLastCalledWith('Secret restored');
});
