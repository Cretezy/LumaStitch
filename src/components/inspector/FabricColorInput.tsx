// SPDX-License-Identifier: GPL-3.0-or-later
/** Swatch button that sets the design's fabric colour (canvas background and exports on fabric). */
import { Tip } from '@/components/ui/tooltip';
import { fabricColorOf, type Design } from '@/model/types';
import { setDesignProps } from '@/store/commands';
import { useDoc } from '@/store/documentStore';

/** Fabric colour swatch: opens the colour picker (one undo step per pick). */
export function FabricColorInput({ design }: { design: Pick<Design, 'fabricColor'> }) {
  const color = fabricColorOf(design);
  return (
    <Tip label="Fabric colour (canvas and exports)">
      <label className="relative size-8 shrink-0 cursor-pointer rounded-md border shadow-xs">
        <span className="absolute inset-1 rounded-[4px] border" style={{ background: color }} />
        <input
          type="color"
          aria-label="Fabric colour"
          defaultValue={color}
          key={color}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
          // React's onChange fires on every input event while the picker is dragged; commit once
          // on the native change event instead.
          ref={(el) => {
            if (!el || (el as any).__lsBound) return;
            (el as any).__lsBound = true;
            el.addEventListener('change', () => {
              if (el.value !== fabricColorOf(useDoc.getState().design))
                setDesignProps({ fabricColor: el.value }, 'Change fabric colour');
            });
          }}
        />
      </label>
    </Tip>
  );
}
