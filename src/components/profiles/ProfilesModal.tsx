import { useUiStore } from '@/src/stores/ui.store';
import { useProfilesStore } from '@/src/stores/profiles.store';
import { useDialog } from '@/src/hooks/useDialog';
import { useExportImport } from '@/src/hooks/useExportImport';
import { Modal } from '@/src/components/ui/Modal';
import { Button } from '@/src/components/ui/Button';
import { ProfilesTable } from './ProfilesTable';
import { useShallow } from 'zustand/react/shallow';

export function ProfilesModal() {
  const open = useUiStore((s) => s.profilesModalOpen);
  const close = useUiStore((s) => s.closeProfilesModal);

  const profiles = useProfilesStore(useShallow((s) => s.profiles));
  const activeId = useProfilesStore((s) => s.activeProfileId);
  const error = useProfilesStore((s) => s.error);
  const saveCurrent = useProfilesStore((s) => s.saveCurrent);
  const apply = useProfilesStore((s) => s.apply);
  const rename = useProfilesStore((s) => s.rename);
  const remove = useProfilesStore((s) => s.delete);
  const exportProfile = useProfilesStore((s) => s.exportProfile);
  const importFile = useProfilesStore((s) => s.importFile);
  const saveCurrentTo = useProfilesStore((s) => s.saveCurrentTo);
  const clearError = useProfilesStore((s) => s.clearError);

  const dialog = useDialog();
  const { pickFile } = useExportImport();

  const handleSaveCurrent = async () => {
    const name = await dialog.prompt({
      title: 'Save profile',
      label: 'Name',
      required: true,
    });
    if (name) await saveCurrent(name).catch(() => {});
  };

  const handleImport = async () => {
    const file = await pickFile('.json');
    if (file) await importFile(file).catch(() => {});
  };

  const handleApply = async (id: string) => {
    await apply(id).catch(() => {});
  };

  const handleRename = async (id: string, current: string) => {
    const next = await dialog.prompt({
      title: 'Rename profile',
      label: 'Name',
      defaultValue: current,
      required: true,
    });
    if (next) await rename(id, next).catch(() => {});
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await dialog.confirm({
      title: 'Delete profile',
      message: `Delete "${name}"? This will delete the profile's system instruction, skills, tools, and MCP server configuration.`,
      destructive: true,
    });
    if (ok) await remove(id).catch(() => {});
  };

  const handleSaveHere = async (id: string) => {
    await saveCurrentTo(id).catch(() => {});
  };

  if (!open) return null;

  return (
    <Modal open={open} onClose={close} title="Profiles" className="max-w-3xl">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={handleSaveCurrent}>
              + Save current as new
            </Button>
            <Button variant="ghost" size="sm" onClick={handleImport}>
              ↑ Import
            </Button>
          </div>
        </div>

        {error && (
          <div role="alert" className="p-1.5 rounded bg-status-error/10 border border-status-error/40 text-status-error text-[10px] flex items-center gap-2">
            <span className="flex-1">⚠ {error}</span>
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={clearError}
              className="hover:text-white"
            >
              ×
            </button>
          </div>
        )}

        {profiles.length === 0 ? (
          <div className="text-zinc-500 text-sm text-center py-8">
            No profiles yet. Save your current context as a profile to switch between setups.
          </div>
        ) : (
          <ProfilesTable
            profiles={profiles}
            activeId={activeId}
            onApply={handleApply}
            onSaveHere={handleSaveHere}
            onRename={handleRename}
            onExport={(id) => exportProfile(id).catch(() => {})}
            onDelete={handleDelete}
          />
        )}
      </div>
    </Modal>
  );
}
