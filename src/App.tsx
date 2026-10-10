// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppShell } from '@/components/shell/AppShell';
import { HomeScreen } from '@/components/home/HomeScreen';
import { DialogHost } from '@/components/DialogHost';
import { Toaster } from '@/components/shell/Toaster';
import { useUi } from '@/store/uiStore';
import { startPlanSync } from '@/store/planStore';
import { startAutosave } from '@/io/project/autosave';
import { getPref, requestPersistentStorage } from '@/library/library';
import { handleFile, openDesignById } from '@/store/actions';
import { installKeymap } from '@/lib/keymap';

export function App() {
  const screen = useUi((s) => s.screen);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    startPlanSync();
    startAutosave();
    const uninstall = installKeymap();
    void requestPersistentStorage();
    // Restore the design that was open last, unless the installed app was launched with files.
    (async () => {
      const launchQueue = (window as any).launchQueue;
      let launchedWithFiles = false;
      if (launchQueue?.setConsumer) {
        launchQueue.setConsumer(async (params: { files?: { getFile(): Promise<File> }[] }) => {
          for (const handle of params.files ?? []) {
            launchedWithFiles = true;
            setReady(true);
            await handleFile(await handle.getFile(), { intoCurrent: false });
          }
        });
      }
      const last = await getPref<string>('lastOpenId');
      if (last && !launchedWithFiles) await openDesignById(last);
      setReady(true);
    })();
    return uninstall;
  }, []);

  return (
    <TooltipProvider>
      {ready ? (
        screen === 'editor' ? (
          <AppShell />
        ) : (
          <HomeScreen />
        )
      ) : (
        <div className="grid h-full place-items-center text-muted-foreground">Loading…</div>
      )}
      <DialogHost />
      <Toaster />
    </TooltipProvider>
  );
}
