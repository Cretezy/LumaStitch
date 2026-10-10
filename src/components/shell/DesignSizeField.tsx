// SPDX-License-Identifier: GPL-3.0-or-later
/** Design size: W × H in mm with aspect lock. Resizing regenerates stitches so density stays correct (FR-1.8). */
import { useState } from 'react';
import { Link2, Link2Off } from 'lucide-react';
import { NumberField } from '@/components/inspector/NumberField';
import { Tip } from '@/components/ui/tooltip';
import { isEmptyBBox } from '@/geom/polygon';
import { designBBox, resizeDesign } from '@/store/commands';
import { useDoc } from '@/store/documentStore';

export function DesignSizeField() {
  const design = useDoc((s) => s.design);
  const [lock, setLock] = useState(true);
  const b = design ? designBBox(design) : null;
  const empty = !b || isEmptyBBox(b);
  const w = empty ? null : b!.maxX - b!.minX;
  const h = empty ? null : b!.maxY - b!.minY;
  return (
    <div className="flex items-center gap-1.5 border-b px-3 py-2">
      <Tip label="The size of the whole design. Changing it regenerates stitches at the new size, so density stays correct.">
        <span className="mr-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Design
        </span>
      </Tip>
      <NumberField
        label="W"
        unit="mm"
        value={w}
        min={1}
        max={2000}
        digits={1}
        disabled={empty}
        placeholder="–"
        onCommit={(v) => resizeDesign(v, undefined, lock)}
        className="w-24"
        ariaLabel="Design width"
      />
      <Tip label={lock ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}>
        <button
          type="button"
          aria-pressed={lock}
          aria-label="Lock aspect ratio"
          className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent"
          onClick={() => setLock(!lock)}
        >
          {lock ? <Link2 className="size-3.5" /> : <Link2Off className="size-3.5" />}
        </button>
      </Tip>
      <NumberField
        label="H"
        unit="mm"
        value={h}
        min={1}
        max={2000}
        digits={1}
        disabled={empty}
        placeholder="–"
        onCommit={(v) => resizeDesign(undefined, v, lock)}
        className="w-24"
        ariaLabel="Design height"
      />
    </div>
  );
}
