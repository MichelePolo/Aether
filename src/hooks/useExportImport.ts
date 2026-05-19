import { useCallback } from 'react';

export function useExportImport() {
  const triggerDownload = useCallback((filename: string, content: string) => {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const pickFile = useCallback((accept: string): Promise<File | null> => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener(
        'change',
        () => {
          const file = input.files?.[0] ?? null;
          if (input.parentNode) input.parentNode.removeChild(input);
          resolve(file);
        },
        { once: true },
      );
      input.click();
    });
  }, []);

  return { triggerDownload, pickFile };
}
