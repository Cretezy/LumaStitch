// SPDX-License-Identifier: GPL-3.0-or-later
/** Design settings (FR-8.1, SPEC §8.8). */
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { FabricColorInput } from '@/components/inspector/FabricColorInput';
import { NumberField } from '@/components/inspector/NumberField';
import { FABRIC_IDS, FABRIC_PRESETS } from '@/engine/params/fabric';
import { DEFAULT_SETTINGS } from '@/model/factories';
import type { DesignSettings, FabricId } from '@/model/types';
import { setDesignProps, setDesignSettings } from '@/store/commands';
import { useDoc } from '@/store/documentStore';
import { listCharts } from '@/threads/charts';
import type { DialogProps } from '../DialogHost';

interface Field {
  key: keyof DesignSettings;
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  digits: number;
  help: string;
}

const STITCH_FIELDS: Field[] = [
  {
    key: 'trimThreshold',
    label: 'Trim threshold',
    unit: 'mm',
    min: 0.5,
    max: 50,
    step: 0.5,
    digits: 1,
    help: 'Shorter same-colour moves are stitched; longer ones are trimmed.',
  },
  {
    key: 'minStitchLength',
    label: 'Minimum stitch',
    unit: 'mm',
    min: 0,
    max: 2,
    step: 0.05,
    digits: 2,
    help: 'Shorter stitches are merged (tie stitches are exempt).',
  },
  {
    key: 'maxStitchLength',
    label: 'Maximum stitch',
    unit: 'mm',
    min: 3,
    max: 12.7,
    step: 0.1,
    digits: 1,
    help: 'Longer stitches are split.',
  },
  {
    key: 'tieLength',
    label: 'Tie stitch length',
    unit: 'mm',
    min: 0.3,
    max: 2,
    step: 0.05,
    digits: 2,
    help: 'The tiny lock stitches at starts and ends.',
  },
];

const TIME_FIELDS: Field[] = [
  {
    key: 'machineSpm',
    label: 'Machine speed',
    unit: 'spm',
    min: 100,
    max: 1500,
    step: 50,
    digits: 0,
    help: 'Stitches per minute; also the 1× simulator speed.',
  },
  {
    key: 'trimSeconds',
    label: 'Trim time',
    unit: 's',
    min: 0,
    max: 60,
    step: 1,
    digits: 0,
    help: 'Per trim.',
  },
  {
    key: 'colorChangeSeconds',
    label: 'Colour change time',
    unit: 's',
    min: 0,
    max: 300,
    step: 5,
    digits: 0,
    help: 'Per colour change or stop.',
  },
];

function NumberSetting({ f, value }: { f: Field; value: number }) {
  const id = `ds-${f.key}`;
  return (
    <div className="grid min-w-0 content-start gap-1">
      <Label htmlFor={id}>{f.label}</Label>
      <NumberField
        id={id}
        value={value}
        min={f.min}
        max={f.max}
        step={f.step}
        digits={f.digits}
        unit={f.unit}
        className="h-8"
        onCommit={(v) =>
          setDesignSettings({ [f.key]: v } as Partial<DesignSettings>, `Set ${f.label.toLowerCase()}`)
        }
        ariaLabel={f.label}
      />
      <p className="text-[11px] leading-snug text-muted-foreground">{f.help}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

export default function DesignSettingsDialog({ open, onClose }: DialogProps) {
  const design = useDoc((s) => s.design);
  if (!design) return null;
  const s = design.settings;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Design settings</DialogTitle>
          <DialogDescription>Changes apply immediately and can be undone.</DialogDescription>
        </DialogHeader>
        <Section title="Design">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid min-w-0 content-start gap-1">
              <Label htmlFor="ds-name">Name</Label>
              <Input
                id="ds-name"
                defaultValue={design.name}
                onBlur={(e) =>
                  e.target.value.trim() &&
                  e.target.value !== design.name &&
                  setDesignProps({ name: e.target.value.trim() }, 'Rename design')
                }
              />
            </div>
            <div className="grid min-w-0 content-start gap-1">
              <Label htmlFor="ds-fabric">Fabric</Label>
              <div className="flex min-w-0 items-center gap-2">
                <FabricColorInput design={design} />
                <Select
                  value={design.fabric}
                  onValueChange={(v) => setDesignProps({ fabric: v as FabricId }, 'Change fabric')}
                >
                  <SelectTrigger
                    id="ds-fabric"
                    className="w-full min-w-0 *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FABRIC_IDS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {FABRIC_PRESETS[f].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid min-w-0 content-start gap-1">
              <Label htmlFor="ds-chart">Thread chart</Label>
              <Select
                value={design.threadChart}
                onValueChange={(v) => setDesignProps({ threadChart: v }, 'Change thread chart')}
              >
                <SelectTrigger
                  id="ds-chart"
                  className="w-full min-w-0 *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="exact">Exact colours (no chart)</SelectItem>
                  {listCharts().map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Section>
        <Section title="Stitching">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {STITCH_FIELDS.map((f) => (
              <NumberSetting key={f.key} f={f} value={s[f.key] as number} />
            ))}
          </div>
          <div className="grid gap-3">
            <div className="grid min-w-0 content-start gap-1 sm:max-w-[calc(50%-0.375rem)]">
              <Label htmlFor="ds-ties">Default ties</Label>
              <Select
                value={s.defaultTie}
                onValueChange={(v) => setDesignSettings({ defaultTie: v as DesignSettings['defaultTie'] })}
              >
                <SelectTrigger
                  id="ds-ties"
                  className="w-full min-w-0 *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (next to trims, colour changes, stops)</SelectItem>
                  <SelectItem value="always">Always tie every element</SelectItem>
                  <SelectItem value="never">Never (unless set on an element)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-md border px-3 py-2.5 text-sm">
              <span>
                Scale stroke widths
                <span className="block text-[11px] leading-snug text-muted-foreground">
                  Satin and stroke widths change when shapes are resized.
                </span>
              </span>
              <Switch
                checked={s.scaleStrokeWidths}
                onCheckedChange={(c) => setDesignSettings({ scaleStrokeWidths: c })}
                aria-label="Scale stroke widths"
              />
            </label>
          </div>
        </Section>
        <Section title="Time estimates">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {TIME_FIELDS.map((f) => (
              <NumberSetting key={f.key} f={f} value={s[f.key] as number} />
            ))}
          </div>
        </Section>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setDesignSettings({ ...DEFAULT_SETTINGS }, 'Reset design settings')}
          >
            Reset to defaults
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
