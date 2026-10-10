import * as React from 'react';
import { ContextMenu as CM } from 'radix-ui';
import { cn } from '@/lib/utils';

const ContextMenu = CM.Root;
const ContextMenuTrigger = CM.Trigger;
function ContextMenuContent({ className, ...props }: React.ComponentProps<typeof CM.Content>) {
  return (
    <CM.Portal>
      <CM.Content
        className={cn(
          'z-50 min-w-[11rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
          className,
        )}
        {...props}
      />
    </CM.Portal>
  );
}
function ContextMenuItem({ className, ...props }: React.ComponentProps<typeof CM.Item>) {
  return (
    <CM.Item
      className={cn(
        'relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
function ContextMenuSeparator({ className, ...props }: React.ComponentProps<typeof CM.Separator>) {
  return <CM.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

export { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger };
