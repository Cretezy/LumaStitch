// SPDX-License-Identifier: GPL-3.0-or-later
/** zod schema for project files, plus forward migrations. */
import { z } from 'zod';
import { DEFAULT_SETTINGS } from './factories';
import { repairDesign } from './invariants';
import { CURRENT_SCHEMA_VERSION, type Design } from './types';

const vec2 = z.tuple([z.number(), z.number()]);
const node = z.object({
  p: vec2,
  command: z.enum(['jump', 'trim', 'stop']).optional(),
  in: vec2.optional(),
  out: vec2.optional(),
  smooth: z.boolean().optional(),
});
const subpath = z.object({ closed: z.boolean(), nodes: z.array(node) });
const pathGeom = z.object({ subpaths: z.array(subpath), fillRule: z.enum(['nonzero', 'evenodd']) });
const tie = z.enum(['auto', 'on', 'off']);
const element = z.object({
  id: z.string(),
  role: z.enum(['fill', 'outline']),
  type: z.enum([
    'tatami',
    'satinFill',
    'contour',
    'meander',
    'ripple',
    'guidedFill',
    'gradientFill',
    'patternFill',
    'crossStitch',
    'applique',
    'running',
    'triple',
    'satin',
    'zigzag',
    'motifRun',
    'blanket',
    'manual',
    'satinColumn',
  ]),
  threadId: z.string(),
  params: z.record(z.string(), z.union([z.number(), z.boolean(), z.string()])),
  entry: vec2.optional(),
  exit: vec2.optional(),
  guides: z.array(z.tuple([vec2, vec2])).optional(),
  railSplit: z.tuple([z.number(), z.number()]).optional(),
  tieIn: tie,
  tieOut: tie,
  trimAfter: z.enum(['auto', 'always', 'never']),
  userEdited: z.boolean().optional(),
});
export const shapeSchema = z.object({
  id: z.string(),
  name: z.string(),
  geom: pathGeom,
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  art: z.object({
    fill: z.string().optional(),
    stroke: z.string().optional(),
    strokeWidth: z.number().optional(),
  }),
  fill: element.nullable(),
  outline: element.nullable(),
});
export const threadSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  chart: z.string().optional(),
  code: z.string().optional(),
});
const matrix = z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]);
const traceSettings = z.object({
  colors: z.union([z.number(), z.literal('auto')]),
  palette: z.array(
    z.object({
      index: z.number(),
      mergeInto: z.number().optional(),
      color: z.string().optional(),
      skip: z.boolean().optional(),
    }),
  ),
  background: z.string(),
  detail: z.number(),
  smoothness: z.number(),
  lineArt: z.boolean(),
});
const artwork = z.union([
  z.object({ matrix, visible: z.boolean(), opacity: z.number(), kind: z.literal('svg'), svg: z.string() }),
  z.object({
    matrix,
    visible: z.boolean(),
    opacity: z.number(),
    kind: z.literal('image'),
    dataUrl: z.string(),
    pxWidth: z.number(),
    pxHeight: z.number(),
    trace: traceSettings,
  }),
]);

export const fabricProfileSchema = z.object({
  name: z.string().trim().min(1).max(100),
  baseFabric: z.enum(['woven', 'knit', 'pile', 'lightweight']),
  fillSpacing: z.number().min(0.15).max(2),
  satinSpacing: z.number().min(0.15).max(2),
  pullComp: z.number().min(0).max(2),
  fillUnderlay: z.enum(['none', 'edge', 'tatami', 'edgeTatami']),
  satinUnderlay: z.enum([
    'auto',
    'none',
    'center',
    'edge',
    'zigzag',
    'centerZigzag',
    'edgeZigzag',
    'centerEdge',
  ]),
  underlaySpacing: z.number().min(0.5).max(10),
  stabilizer: z.string().max(500),
  needle: z.string().max(100),
  thread: z.string().max(100),
  notes: z.string().max(4000),
});

export const multiHoopSchema = z
  .object({
    width: z.number().min(30).max(1000),
    height: z.number().min(30).max(1000),
    margin: z.number().min(1).max(20),
    overlap: z.number().min(6).max(100),
    joinSeams: z.boolean().optional(),
  })
  .refine(
    (v) => Math.min(v.width, v.height) - 2 * v.margin - v.overlap >= 10,
    'The field must leave at least 10 mm between hoop centers after margin and overlap.',
  );

export const designSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string(),
  fabric: z.enum(['woven', 'knit', 'pile', 'lightweight']),
  fabricProfile: fabricProfileSchema.optional(),
  multiHoop: multiHoopSchema.optional(),
  fabricColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  threadChart: z.string(),
  settings: z.object({
    trimThreshold: z.number(),
    minStitchLength: z.number(),
    maxStitchLength: z.number(),
    tieLength: z.number(),
    machineSpm: z.number(),
    trimSeconds: z.number(),
    colorChangeSeconds: z.number(),
    defaultTie: z.enum(['auto', 'always', 'never']),
    scaleStrokeWidths: z.boolean(),
  }),
  threads: z.record(z.string(), threadSchema),
  shapes: z.record(z.string(), shapeSchema),
  zOrder: z.array(z.string()),
  sequence: z.array(
    z.union([
      z.object({ kind: z.literal('element'), elementId: z.string() }),
      z.object({ kind: z.literal('stop'), id: z.string(), note: z.string().optional() }),
    ]),
  ),
  artwork: artwork.optional(),
  hoop: z
    .object({
      width: z.number().min(10).max(1000),
      height: z.number().min(10).max(1000),
      margin: z.number().min(0).max(20),
      shape: z.enum(['rectangle', 'ellipse']),
    })
    .optional(),
  lettering: z
    .record(
      z.string(),
      z.object({
        options: z.object({
          font: z.literal('geneva-simple'),
          text: z.string().max(1000),
          height: z.number().min(10).max(20),
          letterSpacing: z.number().min(-5).max(20),
          wordSpacing: z.number().min(0).max(30),
          lineSpacing: z.number().min(1).max(4),
          align: z.enum(['left', 'center', 'right']),
          arcAngle: z.number().min(-300).max(300),
          monogram: z.boolean(),
        }),
        shapeIds: z.array(z.string()),
        matrix,
      }),
    )
    .optional(),
});

export const PROJECT_FORMAT = 'lumastitch-project';

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  schemaVersion: number;
  app?: string;
  savedAt?: string;
  design: Design;
}

/** migrations[v] upgrades a raw design from version v to v + 1. */
const migrations: Record<number, (raw: any) => any> = {};

export function migrate(raw: any, fromVersion: number): any {
  let v = fromVersion;
  let d = raw;
  while (v < CURRENT_SCHEMA_VERSION) {
    const m = migrations[v];
    if (!m) throw new Error(`No migration from schema version ${v}`);
    d = m(d);
    v++;
  }
  return d;
}

/** Parses, migrates, validates and repairs a design from untrusted JSON. */
export function parseDesign(raw: unknown): Design {
  if (!raw || typeof raw !== 'object') throw new Error('Not a LumaStitch design');
  const r = raw as any;
  const version = typeof r.schemaVersion === 'number' ? r.schemaVersion : 1;
  if (version > CURRENT_SCHEMA_VERSION)
    throw new Error(`This design was made with a newer LumaStitch (schema ${version}).`);
  const migrated = migrate(r, version);
  migrated.settings = { ...DEFAULT_SETTINGS, ...(migrated.settings ?? {}) };
  const parsed = designSchema.parse(migrated) as Design;
  return repairDesign(structuredClone(parsed));
}

export function parseProjectFile(text: string): Design {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  if (json?.format !== PROJECT_FORMAT) throw new Error('Not a LumaStitch project file.');
  return parseDesign(json.design);
}

export function serializeProject(design: Design): string {
  const file: ProjectFile = {
    format: PROJECT_FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    app: 'LumaStitch',
    savedAt: new Date().toISOString(),
    design,
  };
  return JSON.stringify(file);
}
