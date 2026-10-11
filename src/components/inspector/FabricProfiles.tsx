// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDoc } from '@/store/documentStore';
import { setDesignProps } from '@/store/commands';
import type { FabricProfile } from '@/model/types';
import { fabricProfileSchema } from '@/model/schema';
import {
  loadProfiles,
  mergeProfiles,
  profileFileSchema,
  saveProfiles,
  starterProfile,
} from '@/fabric/profiles';
import { saveFile } from '@/io/project/files';
import { NumberField } from './NumberField';

export function FabricProfiles() {
  const design = useDoc((s) => s.design)!;
  const [profiles, setProfiles] = useState<FabricProfile[]>([]);
  const [draft, setDraft] = useState(() =>
    structuredClone(design.fabricProfile ?? starterProfile(design.fabric)),
  );
  const [error, setError] = useState('');
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void loadProfiles()
      .then(setProfiles)
      .catch((e) => setError(String(e)));
  }, []);
  const change = (key: keyof FabricProfile, value: string | number) =>
    setDraft((d) => ({ ...d, [key]: value }));
  async function apply(save: boolean) {
    try {
      const profile = fabricProfileSchema.parse(draft);
      if (save) {
        const next = mergeProfiles(profiles, [profile]);
        await saveProfiles(next);
        setProfiles(next);
      }
      setDesignProps({ fabricProfile: profile }, 'Apply fabric profile');
      setError('');
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <details className="rounded border p-3 text-xs">
      <summary className="cursor-pointer font-medium">
        Custom fabric profiles{design.fabricProfile ? ` · ${design.fabricProfile.name}` : ''}
      </summary>
      <div className="mt-3 grid gap-3">
        <p className="text-muted-foreground">
          Profiles supply defaults for tatami, pattern, guided fill, satin and appliqué. Individual stitch
          overrides stay in effect. Record your fabric, thread, needle and stabilizer after sewing the
          calibration sampler.
        </p>
        <label className="grid gap-1">
          Saved profile
          <select
            aria-label="Saved fabric profile"
            className="rounded border bg-background p-2"
            value=""
            onChange={(e) => {
              const p = profiles.find((p) => p.name === e.target.value);
              if (p) setDraft(structuredClone(p));
            }}
          >
            <option value="">Choose a saved profile…</option>
            {profiles.map((p) => (
              <option key={p.name}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          Base fabric
          <select
            aria-label="Profile base fabric"
            className="rounded border bg-background p-2"
            value={draft.baseFabric}
            onChange={(e) => change('baseFabric', e.target.value)}
          >
            {['woven', 'knit', 'pile', 'lightweight'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          Profile name
          <Input
            aria-label="Profile name"
            value={draft.name}
            maxLength={100}
            onChange={(e) => change('name', e.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ['fillSpacing', 'Profile fill spacing', 0.15, 2],
              ['satinSpacing', 'Profile satin spacing', 0.15, 2],
              ['pullComp', 'Profile pull compensation', 0, 2],
              ['underlaySpacing', 'Profile underlay spacing', 0.5, 10],
            ] as const
          ).map(([key, label, min, max]) => (
            <label className="grid gap-1" key={key}>
              {label}
              <NumberField
                value={draft[key]}
                min={min}
                max={max}
                step={0.05}
                digits={2}
                unit="mm"
                ariaLabel={label}
                onCommit={(v) => change(key, v)}
              />
            </label>
          ))}
        </div>
        {(['fillUnderlay', 'satinUnderlay'] as const).map((key) => (
          <label className="grid gap-1" key={key}>
            {key === 'fillUnderlay' ? 'Fill underlay' : 'Satin underlay'}
            <select
              className="rounded border bg-background p-2"
              aria-label={`Profile ${key}`}
              value={draft[key]}
              onChange={(e) => change(key, e.target.value)}
            >
              {(key === 'fillUnderlay'
                ? ['none', 'edge', 'tatami', 'edgeTatami']
                : ['auto', 'none', 'center', 'edge', 'zigzag', 'centerZigzag', 'edgeZigzag', 'centerEdge']
              ).map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        ))}
        {(['stabilizer', 'needle', 'thread', 'notes'] as const).map((key) => (
          <label className="grid gap-1 capitalize" key={key}>
            {key}
            <Input
              aria-label={`Profile ${key}`}
              value={draft[key]}
              maxLength={key === 'notes' ? 4000 : key === 'stabilizer' ? 500 : 100}
              onChange={(e) => change(key, e.target.value)}
            />
          </label>
        ))}
        <p className="text-muted-foreground">
          Base: {draft.baseFabric}. The profile is embedded in the project. Library copies remain in this
          browser; download JSON to share or back them up.
        </p>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void apply(false)}>
            Apply profile
          </Button>
          <Button size="sm" variant="outline" onClick={() => void apply(true)}>
            Save and apply profile
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDesignProps({ fabricProfile: null }, 'Remove fabric profile');
              setDraft(starterProfile(design.fabric));
            }}
          >
            Use starter defaults
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              try {
                const parsed = fabricProfileSchema.parse(draft);
                void saveFile(
                  new Blob([JSON.stringify({ version: 1, profiles: [parsed] }, null, 2)], {
                    type: 'application/json',
                  }),
                  'fabric-profile.json',
                  { description: 'Fabric profile', accept: { 'application/json': ['.json'] } },
                ).catch((e) => setError(String(e)));
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            Download profile JSON
          </Button>
          <Button size="sm" variant="outline" onClick={() => file.current?.click()}>
            Import profile JSON
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!profiles.some((p) => p.name === draft.name)}
            onClick={() => {
              void (async () => {
                try {
                  const next = profiles.filter((p) => p.name !== draft.name);
                  await saveProfiles(next);
                  setProfiles(next);
                  setError('');
                } catch (e) {
                  setError(String(e));
                }
              })();
            }}
          >
            Delete library copy
          </Button>
        </div>
        <input
          ref={file}
          type="file"
          accept=".json"
          aria-label="Import fabric profiles"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            void (async () => {
              try {
                if (f.size > 1_000_000) throw new Error('Profile files are limited to 1 MB.');
                const incoming = profileFileSchema.parse(JSON.parse(await f.text())).profiles;
                const next = mergeProfiles(profiles, incoming);
                await saveProfiles(next);
                setProfiles(next);
                if (incoming[0]) setDraft(incoming[0]);
                setError('');
              } catch (e) {
                setError(String(e));
              }
            })();
          }}
        />
      </div>
    </details>
  );
}
