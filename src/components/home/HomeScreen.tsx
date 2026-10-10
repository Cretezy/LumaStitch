// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Home screen (SPEC §5 "Home", FR-8.4/8.5): shown when no design is open. Start actions, the local
 * project library grid, library backup/restore, and a whole-window drop zone for files.
 */
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  ArchiveRestore,
  Archive,
  FilePlus,
  FileUp,
  FolderOpen,
  HardDrive,
  ImageUp,
  Info,
  LoaderCircle,
  Search,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tip } from '@/components/ui/tooltip';
import { ACCEPT_IMPORT, downloadBlob, pickFile, safeFileName, saveFile } from '@/io/project/files';
import { backupLibrary, restoreLibrary } from '@/library/backup';
import {
  deleteDesign,
  duplicateDesign,
  listDesigns,
  loadDesign,
  renameDesign,
  requestPersistentStorage,
  type DesignMeta,
} from '@/library/library';
import { serializeProject } from '@/model/schema';
import { handleFile, openDesignById, openFile } from '@/store/actions';
import { useUi } from '@/store/uiStore';
import { cn } from '@/lib/utils';
import { DesignCard } from './DesignCard';
import { backupFileDate } from './format';
import { ConfirmDeleteDialog, RenameDesignDialog } from './LibraryDialogs';
import { LogoMark } from './LogoMark';

const ACCEPT_BACKUP = { 'application/zip': ['.zip'] };

const toast = (m: string, kind: 'info' | 'error' | 'success' = 'info') => useUi.getState().showToast(m, kind);
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Ask for persistent storage once per page load (App may also ask; the call is idempotent).
let persistPromise: Promise<boolean> | null = null;
const persistOnce = () => (persistPromise ??= requestPersistentStorage());

/** Re-renders every `ms` so relative dates ("5 minutes ago") stay fresh. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

type Busy = null | 'backup' | 'restore' | 'file';

export function HomeScreen() {
  const [designs, setDesigns] = useState<DesignMeta[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<DesignMeta | null>(null);
  const [deleting, setDeleting] = useState<DesignMeta | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const now = useNow(60_000);

  const refresh = useCallback(async () => {
    try {
      setDesigns(await listDesigns());
      setLoadError(null);
    } catch (err) {
      setLoadError(errText(err));
      setDesigns((d) => d ?? []);
    }
  }, []);

  useEffect(() => {
    void refresh();
    let alive = true;
    void persistOnce().then((p) => alive && setPersisted(p));
    // Pick up changes made in another tab.
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  // ------------------------------------------------------------------ actions

  const run = useCallback(async (kind: Exclude<Busy, null>, fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } catch (err) {
      toast(errText(err), 'error');
    } finally {
      setBusy(null);
    }
  }, []);

  const openDesign = useCallback(
    async (id: string) => {
      if (opening) return;
      setOpening(id);
      const ok = await openDesignById(id);
      // On success the home screen unmounts; on failure stay and refresh the list.
      if (!ok) {
        setOpening(null);
        void refresh();
      }
    },
    [opening, refresh],
  );

  const importFile = (file: File) =>
    run('file', async () => {
      if (/\.zip$/i.test(file.name)) await restoreFrom(file);
      else await handleFile(file);
    });

  async function restoreFrom(file: Blob) {
    const { restored, skipped } = await restoreLibrary(file);
    await refresh();
    const s = skipped ? ` ${skipped} file${skipped === 1 ? '' : 's'} could not be read.` : '';
    if (restored)
      toast(`Restored ${restored} design${restored === 1 ? '' : 's'}.${s}`, skipped ? 'info' : 'success');
    else toast(`No designs were restored.${s}`, 'error');
  }

  const onNewDesign = () => useUi.getState().openDialog('newDesign');
  const onOpenFile = () => run('file', openFile);
  const onImport = () =>
    run('file', async () => {
      const f = await pickFile({ description: 'SVG or image', accept: ACCEPT_IMPORT });
      if (f) await handleFile(f);
    });

  const onBackup = () =>
    run('backup', async () => {
      const blob = await backupLibrary();
      const r = await saveFile(blob, `lumastitch-library-${backupFileDate()}.zip`, {
        description: 'LumaStitch library backup',
        accept: ACCEPT_BACKUP,
      });
      if (r !== 'cancelled')
        toast(
          `Library backed up (${designs?.length ?? 0} design${designs?.length === 1 ? '' : 's'}).`,
          'success',
        );
    });

  const onRestore = () =>
    run('restore', async () => {
      const f = await pickFile({ description: 'LumaStitch library backup', accept: ACCEPT_BACKUP });
      if (f) await restoreFrom(f);
    });

  const onDuplicate = async (m: DesignMeta) => {
    try {
      const id = await duplicateDesign(m.id);
      if (!id) throw new Error('That design could not be found.');
      await refresh();
      toast(`Duplicated “${m.name}”.`, 'success');
    } catch (err) {
      toast(`Could not duplicate: ${errText(err)}`, 'error');
    }
  };

  const onDownload = async (m: DesignMeta) => {
    try {
      const d = await loadDesign(m.id);
      if (!d) throw new Error('That design could not be found.');
      downloadBlob(
        new Blob([serializeProject(d)], { type: 'application/json' }),
        safeFileName(d.name, 'lumastitch'),
      );
    } catch (err) {
      toast(`Could not download: ${errText(err)}`, 'error');
    }
  };

  const doRename = async (name: string) => {
    if (!renaming) return;
    try {
      await renameDesign(renaming.id, name);
      setRenaming(null);
      await refresh();
    } catch (err) {
      toast(`Could not rename: ${errText(err)}`, 'error');
    }
  };

  const doDelete = async () => {
    if (!deleting) return;
    const m = deleting;
    try {
      await deleteDesign(m.id);
      setDeleting(null);
      await refresh();
      toast(`Deleted “${m.name}”.`);
    } catch (err) {
      toast(`Could not delete: ${errText(err)}`, 'error');
    }
  };

  // ------------------------------------------------------------------ drag & drop

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current++;
    setDragging(true);
  };
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (!files.length || busy) return;
    if (files.length > 1) toast(`Opening “${files[0].name}”. Drop one file at a time.`);
    void importFile(files[0]);
  };

  // ------------------------------------------------------------------ render

  const q = query.trim().toLowerCase();
  const visible = designs && q ? designs.filter((d) => d.name.toLowerCase().includes(q)) : designs;
  const count = designs?.length ?? 0;

  return (
    <div
      className="relative flex h-full flex-col bg-background text-foreground"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-6">
          <LogoMark className="size-8" />
          <div className="min-w-0">
            <h1 className="text-base leading-tight font-semibold tracking-tight">LumaStitch</h1>
            <p className="truncate text-xs text-muted-foreground">
              SVG &amp; images → machine embroidery (.pes)
            </p>
          </div>
          <div className="ml-auto">
            <Tip label="About LumaStitch">
              <Button
                variant="ghost"
                size="icon"
                aria-label="About LumaStitch"
                onClick={() => useUi.getState().openDialog('about')}
              >
                <Info />
              </Button>
            </Tip>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-6">
          <section aria-labelledby="home-start" className="grid gap-3">
            <h2 id="home-start" className="sr-only">
              Start
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <ActionTile
                primary
                icon={<FilePlus />}
                title="New design"
                subtitle="Start blank and choose a fabric"
                onClick={onNewDesign}
              />
              <ActionTile
                icon={<FolderOpen />}
                title="Open file…"
                subtitle=".lumastitch project, SVG or image"
                onClick={onOpenFile}
                disabled={busy !== null}
              />
              <ActionTile
                icon={<ImageUp />}
                title="Import SVG or image…"
                subtitle="SVG, PNG, JPG or WebP artwork"
                onClick={onImport}
                disabled={busy !== null}
              />
            </div>
          </section>

          <section aria-labelledby="home-library" className="grid gap-3">
            <div className="flex min-h-8 items-center gap-3">
              <h2 id="home-library" className="text-sm font-semibold">
                Your designs
                {count > 0 && (
                  <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">{count}</span>
                )}
              </h2>
              {count > 6 && (
                <div className="relative ml-auto w-56">
                  <Search
                    className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search designs"
                    aria-label="Search designs"
                    className="pl-7"
                  />
                </div>
              )}
            </div>

            {persisted === false && (
              <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                <ShieldAlert className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
                <span>
                  This browser hasn't granted persistent storage, so it could clear saved designs if disk
                  space runs low. Back up your library or download project files for anything you want to
                  keep.
                </span>
              </p>
            )}

            {loadError && (
              <p
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                Could not read the design library: {loadError}
              </p>
            )}

            {designs === null ? (
              <div className="grid h-40 place-items-center text-muted-foreground">
                <LoaderCircle className="size-5 animate-spin" aria-label="Loading designs" />
              </div>
            ) : count === 0 ? (
              <EmptyState onRestore={onRestore} disabled={busy !== null} />
            ) : visible && visible.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No designs match “{query.trim()}”.
              </p>
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-4" aria-label="Designs">
                {visible!.map((m) => (
                  <DesignCard
                    key={m.id}
                    meta={m}
                    now={now}
                    opening={opening === m.id}
                    onOpen={() => void openDesign(m.id)}
                    onRename={() => setRenaming(m)}
                    onDuplicate={() => void onDuplicate(m)}
                    onDownload={() => void onDownload(m)}
                    onDelete={() => setDeleting(m)}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex h-11 max-w-6xl items-center gap-2 px-6 text-xs text-muted-foreground">
          <HardDrive className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            Designs are saved automatically in this browser and never leave your computer.
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" onClick={onBackup} disabled={busy !== null || count === 0}>
              {busy === 'backup' ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : (
                <Archive aria-hidden />
              )}
              Back up library
            </Button>
            <Button variant="ghost" size="sm" onClick={onRestore} disabled={busy !== null}>
              {busy === 'restore' ? (
                <LoaderCircle className="animate-spin" aria-hidden />
              ) : (
                <ArchiveRestore aria-hidden />
              )}
              Restore from backup
            </Button>
            <Button variant="ghost" size="sm" onClick={() => useUi.getState().openDialog('about')}>
              <Info aria-hidden />
              About
            </Button>
          </div>
        </div>
      </footer>

      {dragging && (
        <div
          className="pointer-events-none absolute inset-2 z-40 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-background/85 backdrop-blur-sm"
          aria-hidden
        >
          <div className="grid justify-items-center gap-2 text-center">
            <FileUp className="size-10 text-primary" />
            <p className="text-base font-medium">Drop to open</p>
            <p className="text-sm text-muted-foreground">SVG, PNG, JPG, WebP or a .lumastitch project</p>
          </div>
        </div>
      )}

      {renaming && (
        <RenameDesignDialog name={renaming.name} onCancel={() => setRenaming(null)} onRename={doRename} />
      )}
      {deleting && (
        <ConfirmDeleteDialog name={deleting.name} onCancel={() => setDeleting(null)} onConfirm={doDelete} />
      )}
    </div>
  );
}

function ActionTile({
  icon,
  title,
  subtitle,
  onClick,
  primary,
  disabled,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'group flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60',
        primary
          ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
          : 'bg-card hover:border-primary/40 hover:bg-accent',
      )}
    >
      <span
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-md [&_svg]:size-[18px]',
          primary ? 'bg-primary-foreground/15' : 'bg-accent text-primary group-hover:bg-background',
        )}
        aria-hidden
      >
        {icon}
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span
          className={cn('truncate text-xs', primary ? 'text-primary-foreground/80' : 'text-muted-foreground')}
        >
          {subtitle}
        </span>
      </span>
    </button>
  );
}

function EmptyState({ onRestore, disabled }: { onRestore: () => void; disabled: boolean }) {
  const steps = [
    'Import an SVG or image (or drop it anywhere on this page)',
    'Auto-digitize it into stitches, then fine-tune',
    'Export a .pes file for your machine',
  ];
  return (
    <div className="grid justify-items-center gap-4 rounded-lg border border-dashed px-6 py-10 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-accent text-primary">
        <Sparkles className="size-5" aria-hidden />
      </span>
      <div className="grid gap-1">
        <p className="text-sm font-medium">No designs yet</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Your designs will appear here, saved automatically as you work.
        </p>
      </div>
      <ol className="grid gap-1.5 text-left text-sm">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-2.5">
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
              {i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">
        Have a library backup?{' '}
        <button
          type="button"
          onClick={onRestore}
          disabled={disabled}
          className="font-medium text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none disabled:opacity-50"
        >
          Restore it
        </button>
      </p>
    </div>
  );
}
