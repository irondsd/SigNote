import { FileAttachmentView } from '../FileAttachmentView';
import { createAttachmentNode, type AttachmentAttrs } from './createAttachmentNode';

export type FileAttachmentAttrs = AttachmentAttrs;

export const FileAttachmentNode = createAttachmentNode({
  name: 'fileAttachment',
  htmlType: 'file-attachment',
  view: FileAttachmentView,
});
