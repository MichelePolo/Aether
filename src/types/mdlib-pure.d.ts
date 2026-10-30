import type { DetailedHTMLProps, HTMLAttributes } from 'react';

/** <mdlib-editor> attributes (mdlib-pure/element). `value` is set as a property, see MarkdownEditor. */
interface MdlibEditorAttributes extends HTMLAttributes<HTMLElement> {
  plugins?: string;
  config?: string;
  view?: 'split' | 'write' | 'preview';
  delay?: number;
  label?: string;
  name?: string;
  disabled?: boolean;
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'mdlib-editor': DetailedHTMLProps<MdlibEditorAttributes, HTMLElement>;
    }
  }
}
