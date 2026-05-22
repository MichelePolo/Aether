import { useEffect, useRef } from 'react';
import { useSessionsStore } from '@/src/stores/sessions.store';

let ref: HTMLInputElement | null = null;

export function triggerImportOpen(): void {
  ref?.click();
}

export function HiddenImportInput() {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref = inputRef.current;
    return () => {
      if (ref === inputRef.current) ref = null;
    };
  }, []);

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await useSessionsStore.getState().importSession(file);
    } finally {
      e.target.value = '';
    }
  };

  return (
    <input
      ref={inputRef}
      type="file"
      accept="application/json"
      hidden
      onChange={onChange}
    />
  );
}
