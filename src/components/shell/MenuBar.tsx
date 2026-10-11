// SPDX-License-Identifier: GPL-3.0-or-later
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from '@/components/ui/menubar';
import { fitDesign, fitSelection, zoomActual } from '@/canvas/CanvasView';
import { MOD } from '@/lib/utils';
import * as A from '@/store/actions';
import { arrange, insertStop, moveElements, selectedElementIds, setElementEnabled } from '@/store/commands';
import { useDoc } from '@/store/documentStore';
import { useUi, type ViewMode } from '@/store/uiStore';
import { detachLettering, selectedLetteringId } from '@/store/commands/lettering';
import { sim } from '@/simulator/controller';

export function MenuBar() {
  const ui = useUi();
  const canUndo = useDoc((s) => s.past.length > 0);
  const canRedo = useDoc((s) => s.future.length > 0);
  const undoLabel = useDoc((s) => s.past[s.past.length - 1]?.label);
  const redoLabel = useDoc((s) => s.future[s.future.length - 1]?.label);
  const hasArtworkImage = useDoc((s) => s.design?.artwork?.kind === 'image');
  const sel = ui.selection.shapeIds;
  const has = sel.length > 0;
  const two = sel.length > 1;
  const sim_ = ui.sim.active;
  const v = ui.view;

  return (
    <Menubar className="border-none bg-transparent shadow-none">
      <MenubarMenu>
        <MenubarTrigger>File</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onSelect={() => ui.openDialog('newDesign')}>
            New design… <MenubarShortcut>{MOD}N</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={() => void A.openFile()}>
            Open… <MenubarShortcut>{MOD}O</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={() => void A.goHome()}>Project library</MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={() => void A.importFile()}>
            Import SVG or image… <MenubarShortcut>{MOD}I</MenubarShortcut>
          </MenubarItem>
          <MenubarItem
            disabled={!hasArtworkImage}
            onSelect={() => ui.openDialog('imageImport', { retrace: true })}
          >
            Re-trace image…
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={() => void A.saveProject(false)}>
            Save project file <MenubarShortcut>{MOD}S</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={() => void A.saveProject(true)}>
            Save project as… <MenubarShortcut>{MOD}⇧S</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={() => ui.openDialog('export')}>
            Export machine file… <MenubarShortcut>{MOD}E</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={() => ui.openDialog('export', { format: 'png' })}>
            Export PNG preview…
          </MenubarItem>
          <MenubarItem onSelect={() => ui.openDialog('export', { format: 'svg' })}>
            Export SVG geometry…
          </MenubarItem>
          <MenubarItem onSelect={() => ui.openDialog('export', { format: 'pdf' })}>
            Export worksheet (PDF)…
          </MenubarItem>
          <MenubarItem onSelect={() => ui.openDialog('export', { format: 'video' })}>
            Export stitch-out video…
          </MenubarItem>
          <MenubarItem onSelect={() => void A.openFile()}>Open machine stitches…</MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={() => ui.openDialog('designSettings')}>Design settings…</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Edit</MenubarTrigger>
        <MenubarContent>
          <MenubarItem disabled={!canUndo || sim_} onSelect={() => useDoc.getState().undo()}>
            Undo {undoLabel ? <span className="text-muted-foreground">{undoLabel}</span> : null}{' '}
            <MenubarShortcut>{MOD}Z</MenubarShortcut>
          </MenubarItem>
          <MenubarItem disabled={!canRedo || sim_} onSelect={() => useDoc.getState().redo()}>
            Redo {redoLabel ? <span className="text-muted-foreground">{redoLabel}</span> : null}{' '}
            <MenubarShortcut>{MOD}⇧Z</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem disabled={!has} onSelect={() => void A.cutSelection()}>
            Cut <MenubarShortcut>{MOD}X</MenubarShortcut>
          </MenubarItem>
          <MenubarItem disabled={!has} onSelect={() => void A.copySelection()}>
            Copy <MenubarShortcut>{MOD}C</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={() => void A.paste()}>
            Paste <MenubarShortcut>{MOD}V</MenubarShortcut>
          </MenubarItem>
          <MenubarItem disabled={!has} onSelect={() => A.duplicate()}>
            Duplicate <MenubarShortcut>{MOD}D</MenubarShortcut>
          </MenubarItem>
          <MenubarItem disabled={!has} onSelect={() => A.deleteSelection()}>
            Delete <MenubarShortcut>⌫</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={() => A.selectAll()}>
            Select all <MenubarShortcut>{MOD}A</MenubarShortcut>
          </MenubarItem>
          <MenubarItem disabled={!has} onSelect={() => ui.clearSelection()}>
            Deselect <MenubarShortcut>Esc</MenubarShortcut>
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Object</MenubarTrigger>
        <MenubarContent>
          <MenubarItem disabled={sim_} onSelect={() => ui.openDialog('lettering')}>
            Add lettering…
          </MenubarItem>
          <MenubarItem
            disabled={sim_ || !selectedLetteringId()}
            onSelect={() => ui.openDialog('lettering', { groupId: selectedLetteringId() })}
          >
            Edit lettering…
          </MenubarItem>
          <MenubarItem
            disabled={sim_ || !selectedLetteringId()}
            onSelect={() => {
              const id = selectedLetteringId();
              if (id) detachLettering(id);
            }}
          >
            Detach lettering
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem disabled={!has} onSelect={() => A.flip('h')}>
            Flip horizontal
          </MenubarItem>
          <MenubarItem disabled={!has} onSelect={() => A.flip('v')}>
            Flip vertical
          </MenubarItem>
          <MenubarItem disabled={!has} onSelect={() => A.rotateSelection(90)}>
            Rotate 90° left
          </MenubarItem>
          <MenubarItem disabled={!has} onSelect={() => A.rotateSelection(-90)}>
            Rotate 90° right
          </MenubarItem>
          <MenubarSeparator />
          <MenubarSub>
            <MenubarSubTrigger disabled={!has}>Arrange</MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarItem onSelect={() => arrange(sel, 'front')}>Bring to front</MenubarItem>
              <MenubarItem onSelect={() => arrange(sel, 'forward')}>Bring forward</MenubarItem>
              <MenubarItem onSelect={() => arrange(sel, 'backward')}>Send backward</MenubarItem>
              <MenubarItem onSelect={() => arrange(sel, 'back')}>Send to back</MenubarItem>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSub>
            <MenubarSubTrigger disabled={!two}>Align & distribute</MenubarSubTrigger>
            <MenubarSubContent>
              <MenubarItem onSelect={() => A.align('left')}>Align left</MenubarItem>
              <MenubarItem onSelect={() => A.align('hcenter')}>Align centres horizontally</MenubarItem>
              <MenubarItem onSelect={() => A.align('right')}>Align right</MenubarItem>
              <MenubarSeparator />
              <MenubarItem onSelect={() => A.align('top')}>Align top</MenubarItem>
              <MenubarItem onSelect={() => A.align('vcenter')}>Align centres vertically</MenubarItem>
              <MenubarItem onSelect={() => A.align('bottom')}>Align bottom</MenubarItem>
              <MenubarSeparator />
              <MenubarItem disabled={sel.length < 3} onSelect={() => A.distribute('h')}>
                Distribute horizontally
              </MenubarItem>
              <MenubarItem disabled={sel.length < 3} onSelect={() => A.distribute('v')}>
                Distribute vertically
              </MenubarItem>
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSeparator />
          <MenubarItem disabled={!has} onSelect={() => A.toggleHidden()}>
            Hide / show <MenubarShortcut>{MOD}⇧H</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={() => A.showAll()}>Show all</MenubarItem>
          <MenubarItem disabled={!has} onSelect={() => A.toggleLocked()}>
            Lock / unlock <MenubarShortcut>{MOD}⇧L</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={() => A.unlockAll()}>Unlock all</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Path</MenubarTrigger>
        <MenubarContent>
          <MenubarItem disabled={!two} onSelect={() => A.booleanOp('unite')}>
            Unite
          </MenubarItem>
          <MenubarItem disabled={!two} onSelect={() => A.booleanOp('subtract')}>
            Subtract (front from back)
          </MenubarItem>
          <MenubarItem disabled={!two} onSelect={() => A.booleanOp('intersect')}>
            Intersect
          </MenubarItem>
          <MenubarItem disabled={!two} onSelect={() => A.booleanOp('exclude')}>
            Exclude
          </MenubarItem>
          <MenubarItem disabled={!two} onSelect={() => A.booleanOp('divide')}>
            Divide
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem disabled={!two} onSelect={() => A.combineSelection()}>
            Combine
          </MenubarItem>
          <MenubarItem disabled={!has} onSelect={() => A.breakApart()}>
            Break apart
          </MenubarItem>
          <MenubarItem disabled={!has} onSelect={() => A.reversePaths()}>
            Reverse direction
          </MenubarItem>
          <MenubarSub>
            <MenubarSubTrigger disabled={!has}>Offset path</MenubarSubTrigger>
            <MenubarSubContent>
              {[-1, -0.5, -0.2, 0.2, 0.5, 1].map((d) => (
                <MenubarItem key={d} onSelect={() => A.offsetPaths(d)}>
                  {d > 0 ? `Outset ${d} mm` : `Inset ${-d} mm`}
                </MenubarItem>
              ))}
            </MenubarSubContent>
          </MenubarSub>
          <MenubarItem disabled={!has} onSelect={() => A.simplifyPaths(0.1)}>
            Simplify
          </MenubarItem>
          <MenubarItem disabled={!has} onSelect={() => A.outlineStroke()}>
            Outline stroke (stroke → shape)
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem disabled={!has} onSelect={() => A.joinSelectedEndpoints()}>
            Join endpoints
          </MenubarItem>
          <MenubarItem disabled={!has} onSelect={() => A.closeOrOpenPath(true)}>
            Close path
          </MenubarItem>
          <MenubarItem disabled={!has} onSelect={() => A.closeOrOpenPath(false)}>
            Open path
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Stitch</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onSelect={() => ui.openDialog('autoDigitize')}>
            Auto-digitize… <MenubarShortcut>{MOD}⇧A</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={() => void A.optimizeSequence()}>Optimize sewing order</MenubarItem>
          <MenubarSeparator />
          <MenubarItem disabled={!has} onSelect={() => A.copyStitchSettings()}>
            Copy stitch settings
          </MenubarItem>
          <MenubarItem disabled={!has} onSelect={() => A.pasteStitchSettings()}>
            Paste stitch settings
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem disabled={!has} onSelect={() => setElementEnabled(sel, 'fill', true)}>
            Add fill
          </MenubarItem>
          <MenubarItem disabled={!has} onSelect={() => setElementEnabled(sel, 'outline', true)}>
            Add outline
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem disabled={!has} onSelect={() => moveElements(selectedElementIds(), 'up')}>
            Sew earlier <MenubarShortcut>{MOD}[</MenubarShortcut>
          </MenubarItem>
          <MenubarItem disabled={!has} onSelect={() => moveElements(selectedElementIds(), 'down')}>
            Sew later <MenubarShortcut>{MOD}]</MenubarShortcut>
          </MenubarItem>
          <MenubarItem
            onSelect={() => {
              const d = useDoc.getState().design;
              if (!d) return;
              const ids = selectedElementIds(d);
              let idx = d.sequence.length;
              if (ids.length) {
                const last = Math.max(
                  ...ids.map((id) => d.sequence.findIndex((e) => e.kind === 'element' && e.elementId === id)),
                );
                if (last >= 0) idx = last + 1;
              }
              insertStop(idx);
              ui.set({ sidebarTab: 'sequence' });
            }}
          >
            Insert stop after selection
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={() => ui.openDialog('myThreads')}>My threads…</MenubarItem>
          <MenubarItem onSelect={() => ui.openDialog('designSettings')}>Design settings…</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>View</MenubarTrigger>
        <MenubarContent>
          <MenubarRadioGroup value={ui.viewMode} onValueChange={(m) => ui.set({ viewMode: m as ViewMode })}>
            <MenubarRadioItem value="artwork">
              Artwork <MenubarShortcut>1</MenubarShortcut>
            </MenubarRadioItem>
            <MenubarRadioItem value="stitches">
              Stitches <MenubarShortcut>2</MenubarShortcut>
            </MenubarRadioItem>
            <MenubarRadioItem value="realistic">
              Realistic <MenubarShortcut>3</MenubarShortcut>
            </MenubarRadioItem>
          </MenubarRadioGroup>
          <MenubarSeparator />
          <MenubarCheckboxItem checked={v.jumps} onCheckedChange={(c) => ui.setView({ jumps: !!c })}>
            Jumps and trims
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            checked={v.needlePoints}
            onCheckedChange={(c) => ui.setView({ needlePoints: !!c })}
          >
            Needle points
          </MenubarCheckboxItem>
          <MenubarCheckboxItem checked={v.underlay} onCheckedChange={(c) => ui.setView({ underlay: !!c })}>
            Highlight underlay
          </MenubarCheckboxItem>
          <MenubarCheckboxItem checked={v.density} onCheckedChange={(c) => ui.setView({ density: !!c })}>
            Needle density map
          </MenubarCheckboxItem>
          <MenubarCheckboxItem checked={v.grid} onCheckedChange={(c) => ui.setView({ grid: !!c })}>
            Grid
          </MenubarCheckboxItem>
          <MenubarCheckboxItem checked={v.rulers} onCheckedChange={(c) => ui.setView({ rulers: !!c })}>
            Rulers
          </MenubarCheckboxItem>
          <MenubarCheckboxItem
            checked={v.dimensions}
            onCheckedChange={(c) => ui.setView({ dimensions: !!c })}
          >
            Design dimensions
          </MenubarCheckboxItem>
          <MenubarCheckboxItem checked={v.backdrop} onCheckedChange={(c) => ui.setView({ backdrop: !!c })}>
            Artwork backdrop
          </MenubarCheckboxItem>
          <MenubarCheckboxItem checked={v.snap} onCheckedChange={(c) => ui.setView({ snap: !!c })}>
            Snap to grid and nodes
          </MenubarCheckboxItem>
          <MenubarSeparator />
          <MenubarItem onSelect={() => fitDesign()}>
            Fit design <MenubarShortcut>{MOD}0</MenubarShortcut>
          </MenubarItem>
          <MenubarItem disabled={!has} onSelect={() => fitSelection()}>
            Fit selection <MenubarShortcut>{MOD}2</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={() => zoomActual()}>
            Actual size (100%) <MenubarShortcut>{MOD}1</MenubarShortcut>
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onSelect={() => A.toggleSimulate()}>
            {sim_ ? 'Stop simulation' : 'Simulate stitch-out'} <MenubarShortcut>R</MenubarShortcut>
          </MenubarItem>
          <MenubarCheckboxItem
            checked={ui.sim.stopAtColorChange}
            onCheckedChange={(c) => ui.setSim({ stopAtColorChange: !!c })}
          >
            Pause at colour changes
          </MenubarCheckboxItem>
          <MenubarItem disabled={!sim_} onSelect={() => sim.seek(0)}>
            Rewind simulation
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Help</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onSelect={() => ui.openDialog('shortcuts')}>
            Keyboard shortcuts <MenubarShortcut>?</MenubarShortcut>
          </MenubarItem>
          <MenubarItem onSelect={() => ui.openDialog('about')}>About LumaStitch</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  );
}
