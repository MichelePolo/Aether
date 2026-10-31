import type { DetailedHTMLProps, HTMLAttributes } from 'react';

/** <mdlib-editor> attributes and properties (mdlib-pure/element). */
interface MdlibEditorAttributes extends HTMLAttributes<HTMLElement> {
  value?: string;
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
