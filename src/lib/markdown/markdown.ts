import { createMarkdown, type Options } from 'mdlib-pure';
import { gfm } from 'mdlib-pure/gfm';

/**
 * Links in rendered Markdown open outside the app: a new tab in the browser,
 * the system browser in the desktop shell (its setWindowOpenHandler only sees
 * target="_blank" links; plain ones are swallowed by will-navigate).
 */
export const linkAttributes: NonNullable<Options['attributes']> = (node) =>
  node.type === 'link' ? { target: '_blank', rel: 'noopener noreferrer' } : null;

/** Shared instance for model output: rule tables compile once, so create it once. */
export const chatMarkdown = createMarkdown({ plugins: gfm(), attributes: linkAttributes });
