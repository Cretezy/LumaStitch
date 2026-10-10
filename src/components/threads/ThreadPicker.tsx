// SPDX-License-Identifier: GPL-3.0-or-later
/** Thread swatch + popover: design threads, any colour, or a brand chart thread (search by name/code). */
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { Id, Thread } from '@/model/types';
import { getChart, listCharts, searchChart, type ThreadChart } from '@/threads/charts';
import { isDark } from '@/threads/color';
import { useDoc } from '@/store/documentStore';
import { getPref, setPref } from '@/library/library';
import { loadMyThreads, type MyThreads } from '@/library/myThreads';

export function Swatch({
  color,
  className,
  title,
}: {
  color: string | null;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-block size-4 shrink-0 rounded-sm border border-black/15 shadow-inner',
        !color && 'bg-[repeating-linear-gradient(45deg,#ddd_0_3px,#fff_3px_6px)]',
        className,
      )}
      style={color ? { background: color } : undefined}
    />
  );
}

export function threadLabel(t: Thread): string {
  return t.code ? `${t.code} ${t.name}` : t.name;
}

export interface ThreadChoice {
  threadId?: Id;
  thread?: Omit<Thread, 'id'>;
}

export function ThreadPicker({
  value,
  onPick,
  trigger,
  align = 'start',
}: {
  value: Id | null;
  onPick: (c: ThreadChoice) => void;
  trigger?: React.ReactNode;
  align?: 'start' | 'end' | 'center';
}) {
  const threads = useDoc((s) => s.design?.threads ?? {});
  const current = value ? threads[value] : null;
  const [open, setOpen] = useState(false);
  const [chartId, setChartId] = useState<string>('brother-embroidery');
  const [chart, setChart] = useState<ThreadChart | null>(null);
  const [q, setQ] = useState('');
  const [mine, setMine] = useState<MyThreads | null>(null);
  const charts = useMemo(() => listCharts(), []);

  useEffect(() => {
    if (!open) return;
    void getPref<string>('lastChart').then((c) => c && setChartId(c));
    void loadMyThreads()
      .then(setMine)
      .catch(() => setMine(null));
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    getChart(chartId)
      .then((c) => alive && setChart(c))
      .catch(() => alive && setChart(null));
    return () => {
      alive = false;
    };
  }, [chartId, open]);

  const results = useMemo(
    () => (chart ? (q ? searchChart(chart, q, 200) : chart.threads.slice(0, 200)) : []),
    [chart, q],
  );
  const pick = (c: ThreadChoice) => {
    onPick(c);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border px-1.5 text-xs shadow-xs hover:bg-accent"
            aria-label="Choose thread"
          >
            <Swatch color={current?.color ?? null} />
            <span className="truncate">{current ? threadLabel(current) : 'Mixed'}</span>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-80 p-2">
        <Tabs defaultValue="design">
          <TabsList className="w-full">
            <TabsTrigger value="design">Design</TabsTrigger>
            <TabsTrigger value="chart">Charts</TabsTrigger>
            <TabsTrigger value="mine">My threads</TabsTrigger>
          </TabsList>
          <TabsContent value="design" className="space-y-2">
            <div className="grid max-h-48 grid-cols-1 gap-0.5 overflow-y-auto">
              {Object.values(threads).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pick({ threadId: t.id })}
                  className={cn(
                    'flex items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-accent',
                    t.id === value && 'bg-accent',
                  )}
                >
                  <Swatch color={t.color} />
                  <span className="truncate">{threadLabel(t)}</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">{t.color}</span>
                </button>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed px-2 py-1.5 text-xs hover:bg-accent">
              <input
                type="color"
                className="size-5 cursor-pointer rounded border-0 bg-transparent p-0"
                defaultValue={current?.color ?? '#000000'}
                onChange={(e) => {
                  const c = e.target.value;
                  pick({ thread: { name: c.toUpperCase(), color: c } });
                }}
              />
              Any colour…
            </label>
          </TabsContent>
          <TabsContent value="chart" className="space-y-2">
            <Select
              value={chartId}
              onValueChange={(v) => {
                setChartId(v);
                void setPref('lastChart', v);
              }}
            >
              <SelectTrigger size="sm" className="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {charts.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">
                    {c.name} <span className="text-muted-foreground">({c.count})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="absolute top-2 left-2 size-3.5 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name or code"
                className="h-7 pl-7 text-xs"
              />
            </div>
            <div className="grid max-h-56 grid-cols-6 gap-1 overflow-y-auto p-0.5">
              {results.map((t, i) => (
                <button
                  key={`${t.code}-${i}`}
                  type="button"
                  title={`${t.code} ${t.name}`}
                  onClick={() =>
                    pick({ thread: { name: t.name, color: t.color, code: t.code, chart: chart?.id } })
                  }
                  className="flex h-10 flex-col items-center justify-end rounded border text-[9px] leading-tight hover:ring-2 hover:ring-ring"
                  style={{ background: t.color, color: isDark(t.color) ? '#fff' : '#000' }}
                >
                  <span className="w-full truncate px-0.5">{t.code}</span>
                </button>
              ))}
              {!results.length && (
                <p className="col-span-6 py-4 text-center text-xs text-muted-foreground">No threads found.</p>
              )}
            </div>
          </TabsContent>
          <TabsContent value="mine">
            {mine?.threads.length ? (
              <div className="grid max-h-60 grid-cols-6 gap-1 overflow-y-auto p-0.5">
                {mine.threads.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    title={`${t.code ?? ''} ${t.name}`}
                    onClick={() =>
                      pick({ thread: { name: t.name, color: t.color, code: t.code, chart: t.chart } })
                    }
                    className="h-9 rounded border hover:ring-2 hover:ring-ring"
                    style={{ background: t.color }}
                  />
                ))}
              </div>
            ) : (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No spools yet. Add the threads you own under Stitch → My threads.
              </p>
            )}
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
