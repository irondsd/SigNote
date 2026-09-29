import { ImageAttachmentView } from '../ImageAttachmentView';
import { createAttachmentNode, type AttachmentAttrs } from './createAttachmentNode';

export type ImageAttachmentAttrs = AttachmentAttrs;

export const ImageAttachmentNode = createAttachmentNode({
  name: 'imageAttachment',
  htmlType: 'image-attachment',
  view: ImageAttachmentView,
});
