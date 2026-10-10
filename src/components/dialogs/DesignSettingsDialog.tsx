// SPDX-License-Identifier: GPL-3.0-or-later
/** Design settings (FR-8.1, SPEC §8.8). */
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
import { NumberField } from '@/components/inspector/NumberField';
import { FABRIC_IDS, FABRIC_PRESETS } from '@/engine/params/fabric';
import { DEFAULT_SETTINGS } from '@/model/factories';
import type { DesignSettings, FabricId } from '@/model/types';
import { setDesignProps, setDesignSettings } from '@/store/commands';
import { useDoc } from '@/store/documentStore';
import { listCharts } from '@/threads/charts';
import type { DialogProps } from '../DialogHost';

const FIELDS: {
  key: keyof DesignSettings;
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  digits: number;
  help: string;
}[] = [
  {
    key: 'trimThreshold',
    label: 'Trim threshold',
    unit: 'mm',
    min: 0.5,
    max: 50,
    step: 0.5,
    digits: 1,
    help: 'Same-colour moves shorter than this are stitched; longer ones are trimmed and jumped.',
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
    help: 'Length of the tiny lock stitches at starts and ends.',
  },
  {
    key: 'machineSpm',
    label: 'Machine speed',
    unit: 'spm',
    min: 100,
    max: 1500,
    step: 50,
    digits: 0,
    help: 'Stitches per minute, for time estimates and 1× simulation.',
  },
  {
    key: 'trimSeconds',
    label: 'Trim time',
    unit: 's',
    min: 0,
    max: 60,
    step: 1,
    digits: 0,
    help: 'For time estimates.',
  },
  {
    key: 'colorChangeSeconds',
    label: 'Colour change time',
    unit: 's',
    min: 0,
    max: 300,
    step: 5,
    digits: 0,
    help: 'For time estimates.',
  },
];

export default function DesignSettingsDialog({ open, onClose }: DialogProps) {
  const design = useDoc((s) => s.design);
  if (!design) return null;
  const s = design.settings;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Design settings</DialogTitle>
          <DialogDescription>Changes apply immediately and can be undone.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[10rem_1fr] items-center gap-x-3 gap-y-2.5 text-sm">
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
          <Label>Fabric</Label>
          <Select
            value={design.fabric}
            onValueChange={(v) => setDesignProps({ fabric: v as FabricId }, 'Change fabric')}
          >
            <SelectTrigger>
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
          <Label>Thread chart</Label>
          <Select
            value={design.threadChart}
            onValueChange={(v) => setDesignProps({ threadChart: v }, 'Change thread chart')}
          >
            <SelectTrigger>
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
          {FIELDS.map((f) => (
            <div key={f.key} className="contents">
              <Label title={f.help}>{f.label}</Label>
              <div className="flex items-center gap-2">
                <NumberField
                  value={s[f.key] as number}
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  digits={f.digits}
                  unit={f.unit}
                  className="w-28"
                  onCommit={(v) =>
                    setDesignSettings(
                      { [f.key]: v } as Partial<DesignSettings>,
                      `Set ${f.label.toLowerCase()}`,
                    )
                  }
                  ariaLabel={f.label}
                />
                <span className="text-[11px] leading-tight text-muted-foreground">{f.help}</span>
              </div>
            </div>
          ))}
          <Label>Default ties</Label>
          <Select
            value={s.defaultTie}
            onValueChange={(v) => setDesignSettings({ defaultTie: v as DesignSettings['defaultTie'] })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto (next to trims, colour changes, stops)</SelectItem>
              <SelectItem value="always">Always tie every element</SelectItem>
              <SelectItem value="never">Never (unless set on an element)</SelectItem>
            </SelectContent>
          </Select>
          <Label>Scale stroke widths</Label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={s.scaleStrokeWidths}
              onCheckedChange={(c) => setDesignSettings({ scaleStrokeWidths: c })}
            />
            Satin and stroke widths scale when shapes are resized
          </label>
        </div>
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
