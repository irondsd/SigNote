import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';

const ATTACHMENT_NODES = new Set(['fileAttachment', 'imageAttachment']);

/**
 * Drops attachments bound to a Seal other than `sealId` — to any Seal, when the
 * editor has none. Such a file opens only under its own Seal's key and the
 * server will not link it anywhere else, so pasted in it would be a card that
 * never loads. Attachments with no owner (vault-keyed, or plaintext) pass.
 */
export function stripForeignAttachments(slice: Slice, sealId: string | undefined): { slice: Slice; dropped: number } {
  let dropped = 0;
  const strip = (fragment: Fragment): Fragment => {
    let changed = false;
    const kept: PMNode[] = [];
    fragment.forEach((node) => {
      const owner = node.attrs.keyNoteId as string | null | undefined;
      if (ATTACHMENT_NODES.has(node.type.name) && owner && owner !== sealId) {
        dropped++;
        changed = true;
        return;
      }
      const inner = node.childCount ? strip(node.content) : node.content;
      if (inner !== node.content) changed = true;
      kept.push(inner === node.content ? node : node.copy(inner));
    });
    return changed ? Fragment.fromArray(kept) : fragment;
  };

  const content = strip(slice.content);
  if (!dropped) return { slice, dropped };
  // An edge whose node was removed or rebuilt is no longer safely open.
  const openStart = content.firstChild === slice.content.firstChild ? slice.openStart : 0;
  const openEnd = content.lastChild === slice.content.lastChild ? slice.openEnd : 0;
  return { slice: new Slice(content, openStart, openEnd), dropped };
}
