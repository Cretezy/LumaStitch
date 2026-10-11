// SPDX-License-Identifier: GPL-3.0-or-later
/** Inspector: shape transform fields, then Fill and Outline sections generated from ParamDefs. */
import { useState } from 'react';
import { ChevronRight, Eye, EyeOff, Lock, LockOpen, MousePointerSquareDashed, RotateCcw } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tip } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { getStitchType, stitchTypesFor } from '@/engine/registry';
import type { ParamDef, ParamGroup } from '@/engine/params/types';
import { FABRIC_IDS, FABRIC_PRESETS } from '@/engine/params/fabric';
import { resolveParams } from '@/engine/params/resolve';
import { rotateScreen, scale, translate } from '@/geom/matrix';
import { hasClosedSubpath } from '@/model/factories';
import type {
  Design,
  ElementRole,
  FabricId,
  ParamValue,
  Shape,
  StitchElement,
  StitchType,
  TieMode,
  TrimMode,
} from '@/model/types';
import {
  assignNewThread,
  clearEntryExit,
  resetParam,
  setDesignProps,
  setElementEnabled,
  setElementProps,
  setElementType,
  setParams,
  setShapeProps,
  transformShapes,
  setArtwork,
  removeArtwork,
} from '@/store/commands';
import { reimportFromBackdrop } from '@/store/actions';
import { useDoc } from '@/store/documentStore';
import { usePlan } from '@/store/planStore';
import { useUi } from '@/store/uiStore';
import { selectionBBox } from '@/tools/selection';
import { cn, fmtInt } from '@/lib/utils';
import { ThreadPicker } from '@/components/threads/ThreadPicker';
import { FabricColorInput } from './FabricColorInput';
import { NumberField } from './NumberField';
import { ManualCommandSettings } from './ManualCommandSettings';
import { LiveSlider, ParamRow, type ParamState } from './ParamControls';

const GROUP_LABEL: Record<ParamGroup, string> = {
  basic: 'Basic',
  underlay: 'Underlay',
  compensation: 'Compensation',
  advanced: 'Advanced',
};

function Section({
  title,
  right,
  children,
  defaultOpen = true,
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b">
      <div className="flex items-center gap-1 px-3 py-1.5">
        <CollapsibleTrigger className="flex flex-1 items-center gap-1 text-left text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
          {title}
        </CollapsibleTrigger>
        {right}
      </div>
      <CollapsibleContent className="px-3 pb-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function ShapeSection({ design, shapes }: { design: Design; shapes: Shape[] }) {
  // Locked shapes are not transformed.
  const ids = shapes.filter((s) => !s.locked).map((s) => s.id);
  const allIds = shapes.map((s) => s.id);
  const b = selectionBBox(design, allIds);
  const single = shapes.length === 1 ? shapes[0] : null;
  const locked = ids.length === 0;
  const allHidden = shapes.every((s) => s.hidden);
  const allLocked = shapes.every((s) => s.locked);
  const [lock, setLock] = useState(true);
  if (!b) return null;
  const w = b.maxX - b.minX,
    h = b.maxY - b.minY;
  const setW = (nw: number) => {
    if (w <= 0) return;
    const sx = nw / w;
    transformShapes(ids, scale(sx, lock ? sx : 1, b.minX, b.minY), 'Resize');
  };
  const setH = (nh: number) => {
    if (h <= 0) return;
    const sy = nh / h;
    transformShapes(ids, scale(lock ? sy : 1, sy, b.minX, b.minY), 'Resize');
  };
  return (
    <Section
      title={single ? 'Shape' : `${shapes.length} shapes`}
      right={
        <div className="flex">
          <Tip label={allHidden ? 'Show' : 'Hide'}>
            <Button
              variant="ghost"
              size="iconSm"
              className="size-6"
              onClick={() => setShapeProps(allIds, { hidden: !allHidden }, allHidden ? 'Show' : 'Hide')}
              aria-label="Toggle visibility"
            >
              {allHidden ? <EyeOff /> : <Eye />}
            </Button>
          </Tip>
          <Tip label={allLocked ? 'Unlock' : 'Lock'}>
            <Button
              variant="ghost"
              size="iconSm"
              className="size-6"
              onClick={() => setShapeProps(allIds, { locked: !allLocked }, allLocked ? 'Unlock' : 'Lock')}
              aria-label="Toggle lock"
            >
              {allLocked ? <Lock /> : <LockOpen />}
            </Button>
          </Tip>
        </div>
      }
    >
      {single && (
        <Input
          key={`${single.id}:${single.name}`}
          defaultValue={single.name}
          aria-label="Shape name"
          className="mb-2 h-7 text-xs"
          onBlur={(e) =>
            e.target.value !== single.name && setShapeProps([single.id], { name: e.target.value }, 'Rename')
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            e.stopPropagation();
          }}
        />
      )}
      <div className="grid grid-cols-2 gap-1.5" inert={locked} style={locked ? { opacity: 0.5 } : undefined}>
        <NumberField
          label="X"
          unit="mm"
          value={b.minX}
          digits={2}
          onCommit={(v) => transformShapes(ids, translate(v - b.minX, 0), 'Move')}
        />
        <NumberField
          label="Y"
          unit="mm"
          value={b.minY}
          digits={2}
          onCommit={(v) => transformShapes(ids, translate(0, v - b.minY), 'Move')}
        />
        <NumberField label="W" unit="mm" value={w} min={0.1} digits={2} onCommit={setW} />
        <NumberField label="H" unit="mm" value={h} min={0.1} digits={2} onCommit={setH} />
        <NumberField
          label="∠"
          unit="°"
          value={0}
          digits={1}
          onCommit={(v) =>
            v && transformShapes(ids, rotateScreen(v, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2), 'Rotate')
          }
          ariaLabel="Rotate by"
        />
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Switch checked={lock} onCheckedChange={setLock} aria-label="Keep proportions" /> Keep proportions
        </label>
      </div>
    </Section>
  );
}

function mergeState(els: StitchElement[], fabric: FabricId, key: string, design: Design): ParamState {
  let value: ParamValue | null | undefined;
  let overridden = false;
  for (const el of els) {
    const eff = resolveParams(el, fabric);
    let v = eff[key];
    // Satin width 'auto' resolves to the stroke width.
    if (key === 'width' && v === 'auto' && el.type === 'satin') {
      const s = Object.values(design.shapes).find((x) => x.outline?.id === el.id);
      v = s?.art.strokeWidth ?? 2;
    }
    if (key in el.params) overridden = true;
    if (value === undefined) value = v;
    else if (value !== v) value = null;
  }
  return { value: value ?? null, overridden };
}

function ElementSection({ design, role, shapes }: { design: Design; role: ElementRole; shapes: Shape[] }) {
  const sel = useUi((s) => s.selection);
  const plan = usePlan((s) => s.plan);
  const ids = shapes.map((s) => s.id);
  const allEls = shapes.map((s) => (role === 'fill' ? s.fill : s.outline)).filter(Boolean) as StitchElement[];
  // An explicit element selection narrows the target.
  const els = sel.elementIds.length ? allEls.filter((e) => sel.elementIds.includes(e.id)) : allEls;
  const canHave = role === 'outline' || shapes.some((s) => hasClosedSubpath(s.geom));
  const enabled = allEls.length > 0;
  const types = [...new Set(els.map((e) => e.type))];
  const type = types.length === 1 ? types[0] : null;
  const def = type ? getStitchType(type) : null;
  const threadIds = [...new Set(els.map((e) => e.threadId))];
  const elIds = els.map((e) => e.id);
  const stitches = plan
    ? els.reduce((n, el) => {
        const r = plan.elementRanges.find((x) => x.elementId === el.id);
        if (!r) return n;
        let c = 0;
        for (let i = r.start; i < r.end; i++) if (!(plan.flags[i] & 31)) c++;
        return n + c;
      }, 0)
    : 0;
  const [groupsOpen, setGroupsOpen] = useState<Record<string, boolean>>({ basic: true });
  if (!canHave) return null;
  const title = role === 'fill' ? 'Fill' : 'Outline';
  const one = <T,>(vals: T[]): T | null => (new Set(vals).size === 1 ? vals[0] : null);
  const tieIn = one(els.map((e) => e.tieIn));
  const tieOut = one(els.map((e) => e.tieOut));
  const trim = one(els.map((e) => e.trimAfter));
  const groups = def
    ? (['basic', 'underlay', 'compensation', 'advanced'] as ParamGroup[])
        .map((g) => ({ g, defs: def.params.filter((p) => p.group === g && !p.hidden) }))
        .filter((x) => x.defs.length)
    : [];
  const effectiveFirst = els[0] ? resolveParams(els[0], design.fabric) : {};
  const visible = (p: ParamDef) => !p.visibleIf || p.visibleIf(effectiveFirst);

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          {title}
          {def && <span className="font-normal tracking-normal normal-case">· {def.label}</span>}
          {enabled && stitches > 0 && (
            <span className="font-normal tracking-normal text-muted-foreground/70 normal-case">
              {fmtInt(stitches)} st
            </span>
          )}
        </span>
      }
      right={
        <Switch
          checked={enabled}
          onCheckedChange={(c) => setElementEnabled(ids, role, c)}
          aria-label={`${title} enabled`}
        />
      }
    >
      {!enabled ? (
        <p className="text-xs text-muted-foreground">
          No {title.toLowerCase()} stitches. Turn it on to add one.
        </p>
      ) : (
        <div className="space-y-1.5">
          <div className="grid grid-cols-[1fr_1fr] gap-1.5">
            <Select value={type ?? undefined} onValueChange={(v) => setElementType(elIds, v as StitchType)}>
              <SelectTrigger size="sm" className="text-xs" aria-label={`${title} stitch type`}>
                <SelectValue placeholder="Mixed" />
              </SelectTrigger>
              <SelectContent>
                {stitchTypesFor(role).map((t) => (
                  <SelectItem key={t.id} value={t.id} className="text-xs">
                    <div>
                      <div>{t.label}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ThreadPicker
              value={threadIds.length === 1 ? threadIds[0] : null}
              onPick={(c) =>
                c.threadId
                  ? setElementProps(elIds, { threadId: c.threadId }, 'Set thread')
                  : c.thread && assignNewThread(elIds, c.thread)
              }
            />
          </div>
          {def && <p className="text-[11px] leading-snug text-muted-foreground">{def.description}</p>}
          {groups.map(({ g, defs }) => {
            const rows = defs
              .filter(visible)
              .map((p) => (
                <ParamRow
                  key={p.key}
                  def={p}
                  state={mergeState(els, design.fabric, p.key, design)}
                  onChange={(v) => setParams(elIds, { [p.key]: v }, `Set ${p.label.toLowerCase()}`)}
                  onReset={() => resetParam(elIds, p.key)}
                />
              ));
            if (g === 'basic') return <div key={g}>{rows}</div>;
            const open = groupsOpen[g] ?? false;
            return (
              <Collapsible key={g} open={open} onOpenChange={(o) => setGroupsOpen({ ...groupsOpen, [g]: o })}>
                <CollapsibleTrigger className="mt-1 flex w-full items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
                  <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
                  {GROUP_LABEL[g]}
                </CollapsibleTrigger>
                <CollapsibleContent>{rows}</CollapsibleContent>
              </Collapsible>
            );
          })}
          <Collapsible
            open={groupsOpen.conn ?? false}
            onOpenChange={(o) => setGroupsOpen({ ...groupsOpen, conn: o })}
          >
            <CollapsibleTrigger className="mt-1 flex w-full items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
              <ChevronRight className={cn('size-3 transition-transform', groupsOpen.conn && 'rotate-90')} />
              Connections
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-1.5 pt-1">
              {(
                [
                  [
                    'Tie-in',
                    'tieIn',
                    tieIn,
                    ['auto', 'on', 'off'],
                    'Tiny lock stitches at the start. Auto: after a trim, colour change, stop or at the start of the design.',
                  ],
                  [
                    'Tie-off',
                    'tieOut',
                    tieOut,
                    ['auto', 'on', 'off'],
                    'Tiny lock stitches at the end. Auto: before a trim, colour change, stop or the end of the design.',
                  ],
                  [
                    'Trim after',
                    'trimAfter',
                    trim,
                    ['auto', 'always', 'never'],
                    'Auto trims when the move to the next element is longer than the trim threshold.',
                  ],
                ] as const
              ).map(([label, key, val, opts, help]) => (
                <div key={key} className="grid grid-cols-[1fr_7rem] items-center gap-2">
                  <Tip label={help}>
                    <span className="cursor-help text-xs underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">
                      {label}
                    </span>
                  </Tip>
                  <Select
                    value={val ?? undefined}
                    onValueChange={(v) =>
                      setElementProps(elIds, { [key]: v as TieMode & TrimMode }, `Set ${label.toLowerCase()}`)
                    }
                  >
                    <SelectTrigger size="sm" className="text-xs" aria-label={label}>
                      <SelectValue placeholder="Mixed" />
                    </SelectTrigger>
                    <SelectContent>
                      {opts.map((o) => (
                        <SelectItem key={o} value={o} className="text-xs capitalize">
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs">Start / end point</span>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => useUi.getState().setTool('entryExit')}
                  >
                    Place…
                  </Button>
                  <Tip label="Reset to automatic">
                    <Button
                      variant="ghost"
                      size="iconSm"
                      className="size-6"
                      disabled={!els.some((e) => e.entry || e.exit)}
                      onClick={() => clearEntryExit(elIds, 'both')}
                      aria-label="Reset start and end points"
                    >
                      <RotateCcw />
                    </Button>
                  </Tip>
                </div>
              </div>
              {type === 'satinFill' && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs">
                    Direction lines {els[0]?.guides?.length ? `(${els[0].guides.length})` : ''}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => useUi.getState().setTool('satinDirection')}
                    >
                      Edit…
                    </Button>
                    <Button
                      variant="ghost"
                      size="iconSm"
                      className="size-6"
                      disabled={!els.some((e) => e.guides?.length || e.railSplit)}
                      onClick={() =>
                        setElementProps(
                          elIds,
                          { guides: undefined, railSplit: undefined },
                          'Reset satin direction',
                        )
                      }
                      aria-label="Reset direction lines"
                    >
                      <RotateCcw />
                    </Button>
                  </div>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}
    </Section>
  );
}

function BackdropControls({ design }: { design: Design }) {
  const art = design.artwork!;
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Artwork backdrop</span>
        <Switch
          checked={art.visible}
          onCheckedChange={(c) => setArtwork({ visible: c })}
          aria-label="Show artwork backdrop"
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-14 text-[11px] text-muted-foreground">Opacity</span>
        <LiveSlider
          value={art.opacity}
          min={0.05}
          max={1}
          step={0.05}
          onCommit={(v) => setArtwork({ opacity: v })}
          label="Backdrop opacity"
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        The original {art.kind === 'svg' ? 'SVG' : 'image'} as a locked reference layer.{' '}
        {art.kind === 'image'
          ? 'Re-trace it with different settings at any time.'
          : 'Re-import replaces every shape with a fresh import of it, auto-digitized.'}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {art.kind === 'image' ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => useUi.getState().openDialog('imageImport', { retrace: true })}
          >
            Re-trace image…
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => void reimportFromBackdrop()}>
            Re-import shapes
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => removeArtwork()}>
          Remove
        </Button>
      </div>
    </div>
  );
}

function DesignPanel({ design }: { design: Design }) {
  const plan = usePlan((s) => s.plan);
  return (
    <div className="space-y-4 p-3">
      <div className="space-y-1.5">
        <label className="text-xs font-medium" htmlFor="design-name">
          Design name
        </label>
        <Input
          id="design-name"
          key={design.name}
          defaultValue={design.name}
          className="h-8"
          onBlur={(e) =>
            e.target.value.trim() &&
            e.target.value !== design.name &&
            setDesignProps({ name: e.target.value.trim() }, 'Rename design')
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            e.stopPropagation();
          }}
        />
        <p className="text-[11px] text-muted-foreground">
          Also the machine label in the .pes file (8 characters or fewer display best).
        </p>
      </div>
      <div className="space-y-1.5">
        <span className="text-xs font-medium">Fabric</span>
        <div className="flex items-center gap-2">
          <FabricColorInput design={design} />
          <Select
            value={design.fabric}
            onValueChange={(v) => setDesignProps({ fabric: v as FabricId }, 'Change fabric')}
          >
            <SelectTrigger className="min-w-0 flex-1 text-xs" aria-label="Fabric">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FABRIC_IDS.map((f) => (
                <SelectItem key={f} value={f} className="text-xs">
                  {FABRIC_PRESETS[f].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {FABRIC_PRESETS[design.fabric].description} {FABRIC_PRESETS[design.fabric].stabilizer}. Settings you
          have not overridden follow the fabric.
        </p>
      </div>
      {design.artwork && <BackdropControls design={design} />}
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        <MousePointerSquareDashed className="mb-1 size-4" />
        Select a shape on the canvas (or in the Sequence tab) to edit its fill and outline stitches.
        {plan && plan.stats.stitches === 0 && Object.keys(design.shapes).length === 0 && (
          <p className="mt-2">Start by importing an SVG or image.</p>
        )}
      </div>
    </div>
  );
}

export function Inspector() {
  const design = useDoc((s) => s.design);
  const sel = useUi((s) => s.selection);
  if (!design) return null;
  const shapes = sel.shapeIds.map((id) => design.shapes[id]).filter(Boolean);
  if (!shapes.length) return <DesignPanel design={design} />;
  return (
    <div>
      <ManualCommandSettings />
      <ShapeSection design={design} shapes={shapes} />
      <ElementSection design={design} role="fill" shapes={shapes} />
      <ElementSection design={design} role="outline" shapes={shapes} />
    </div>
  );
}
