import { useSyncExternalStore } from 'react';

type PromptOptions = {
  title: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
};

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

export type ActiveDialog =
  | (PromptOptions & {
      kind: 'prompt';
      id: string;
      resolve: (v: string | null) => void;
      cancel: () => void;
    })
  | (ConfirmOptions & {
      kind: 'confirm';
      id: string;
      resolve: (v: boolean) => void;
      cancel: () => void;
    });

let queue: ActiveDialog[] = [];
const listeners = new Set<() => void>();
let counter = 0;

function emit() {
  listeners.forEach((l) => l());
}

function nextId() {
  counter += 1;
  return `dlg_${counter}`;
}

function enqueue(item: ActiveDialog) {
  queue = [...queue, item];
  emit();
}

function dequeue() {
  queue = queue.slice(1);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ActiveDialog | null {
  return queue[0] ?? null;
}

export function _resetDialogStore() {
  queue = [];
  counter = 0;
  emit();
}

export function useDialog() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  function prompt(opts: PromptOptions): Promise<string | null> {
    return new Promise((resolve) => {
      const id = nextId();
      let settled = false;
      enqueue({
        kind: 'prompt',
        id,
        ...opts,
        resolve: (v) => {
          if (settled) return;
          settled = true;
          resolve(v);
          dequeue();
        },
        cancel: () => {
          if (settled) return;
          settled = true;
          resolve(null);
          dequeue();
        },
      });
    });
  }

  function confirm(opts: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      const id = nextId();
      let settled = false;
      enqueue({
        kind: 'confirm',
        id,
        ...opts,
        resolve: (v) => {
          if (settled) return;
          settled = true;
          resolve(v);
          dequeue();
        },
        cancel: () => {
          if (settled) return;
          settled = true;
          resolve(false);
          dequeue();
        },
      });
    });
  }

  return { current, prompt, confirm };
}
