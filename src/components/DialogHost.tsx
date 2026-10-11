// SPDX-License-Identifier: GPL-3.0-or-later
/** Renders the open dialog (uiStore.dialog). Each dialog is a lazily loaded component. */
import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { useUi, type DialogId } from '@/store/uiStore';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  data: any;
}

const DIALOGS: Record<Exclude<DialogId, null>, LazyExoticComponent<ComponentType<DialogProps>>> = {
  lettering: lazy(() => import('./dialogs/LetteringDialog')),
  import: lazy(() => import('./dialogs/ImportDialog')),
  imageImport: lazy(() => import('./dialogs/ImageImportDialog')),
  autoDigitize: lazy(() => import('./dialogs/AutoDigitizeDialog')),
  export: lazy(() => import('./dialogs/ExportDialog')),
  designSettings: lazy(() => import('./dialogs/DesignSettingsDialog')),
  shortcuts: lazy(() => import('./dialogs/ShortcutsDialog')),
  myThreads: lazy(() => import('./dialogs/MyThreadsDialog')),
  newDesign: lazy(() => import('./dialogs/NewDesignDialog')),
  about: lazy(() => import('./dialogs/AboutDialog')),
};

export function DialogHost() {
  const dialog = useUi((s) => s.dialog);
  const data = useUi((s) => s.dialogData);
  const close = useUi((s) => s.closeDialog);
  if (!dialog) return null;
  const C = DIALOGS[dialog];
  return (
    <Suspense fallback={null}>
      <C open onClose={close} data={data} />
    </Suspense>
  );
}
