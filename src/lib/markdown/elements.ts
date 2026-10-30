import { useEffect, useState } from 'react';
import { linkAttributes } from './markdown';

/** Named config for <mdlib-editor config="…">: functions can't come from attributes. */
export const EDITOR_CONFIG = 'aether';

let ready: Promise<void> | undefined;

/**
 * Defines <mdlib-editor> / <mdlib-markdown> once. Loaded on demand: the bundle
 * with every plugin is ~20 KB gzip and only the editors need it. A failed load
 * is forgotten so the next caller retries.
 */
export function ensureMarkdownElements(): Promise<void> {
  ready ??= import('mdlib-pure/element')
    .then(({ defineElements }) => defineElements({ configs: { [EDITOR_CONFIG]: { attributes: linkAttributes } } }))
    .catch((err: unknown) => {
      ready = undefined;
      throw err;
    });
  return ready;
}

/** True once the custom elements are defined; false while loading or if loading failed. */
export function useMarkdownElements(): boolean {
  const [defined, setDefined] = useState(() => customElements.get('mdlib-editor') !== undefined);
  useEffect(() => {
    if (defined) return;
    let alive = true;
    ensureMarkdownElements().then(
      () => { if (alive) setDefined(true); },
      () => {}, // keep the plain-text fallback
    );
    return () => { alive = false; };
  }, [defined]);
  return defined;
}
