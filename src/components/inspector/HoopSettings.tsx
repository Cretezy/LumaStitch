// SPDX-License-Identifier: GPL-3.0-or-later
import { useDoc } from '@/store/documentStore';
import { setDesignProps } from '@/store/commands';
import type { Hoop } from '@/model/types';
import { Switch } from '@/components/ui/switch';
import { NumberField } from './NumberField';

export function HoopSettings() {
  const hoop = useDoc((s) => s.design?.hoop);
  const update = (patch: Partial<Hoop>) =>
    setDesignProps({ hoop: { ...hoop!, ...patch } }, 'Change sewing field');
  return (
    <div className="grid gap-2 rounded-md border p-3">
      <label className="flex items-center justify-between gap-3 text-sm">
        Check hoop sewing field
        <Switch
          checked={!!hoop}
          onCheckedChange={(checked) =>
            setDesignProps(
              { hoop: checked ? { width: 100, height: 100, margin: 2, shape: 'rectangle' } : null },
              'Set sewing field',
            )
          }
        />
      </label>
      {hoop && (
        <div className="grid grid-cols-4 gap-2">
          {(['width', 'height', 'margin'] as const).map((key) => (
            <label key={key} className="grid gap-1 text-xs">
              {key === 'width' ? 'Field width' : key === 'height' ? 'Field height' : 'Safety margin'}
              <NumberField
                ariaLabel={`Hoop ${key}`}
                value={hoop[key]}
                min={key === 'margin' ? 0 : 10}
                max={key === 'margin' ? 20 : 1000}
                step={1}
                digits={1}
                unit="mm"
                onCommit={(v) => update({ [key]: v })}
              />
            </label>
          ))}
          <label className="grid gap-1 text-xs">
            Field shape
            <select
              aria-label="Hoop shape"
              className="rounded border bg-background p-1"
              value={hoop.shape}
              onChange={(e) => update({ shape: e.target.value as Hoop['shape'] })}
            >
              <option value="rectangle">Rectangle</option>
              <option value="ellipse">Ellipse</option>
            </select>
          </label>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Use the machine's usable sewing field, not the outer hoop size. The overlay centers on the stitches;
        exports keep their existing coordinates. This setting adds fit warnings and does not select a machine
        hoop.
      </p>
    </div>
  );
}
