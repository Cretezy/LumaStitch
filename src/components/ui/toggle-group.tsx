import * as React from 'react';
import { ToggleGroup as TG } from 'radix-ui';
import { cn } from '@/lib/utils';

function ToggleGroup({ className, ...props }: React.ComponentProps<typeof TG.Root>) {
  return (
    <TG.Root
      className={cn('inline-flex items-center gap-0.5 rounded-md border bg-muted p-0.5', className)}
      {...props}
    />
  );
}
// Active state from aria-checked/aria-pressed, not data-state: a Tooltip trigger wrapping the item
// (asChild) overwrites data-state with its own open/closed.
function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof TG.Item>) {
  return (
    <TG.Item
      className={cn(
        "inline-flex h-7 items-center justify-center gap-1 rounded-[5px] px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none aria-checked:bg-background aria-checked:text-primary aria-checked:shadow-sm aria-checked:ring-1 aria-checked:ring-primary/40 aria-pressed:bg-background aria-pressed:text-primary aria-pressed:shadow-sm aria-pressed:ring-1 aria-pressed:ring-primary/40 dark:aria-checked:bg-primary/20 dark:aria-pressed:bg-primary/20 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
