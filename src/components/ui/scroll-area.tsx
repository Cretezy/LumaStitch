import * as React from 'react';
import { ScrollArea as SA } from 'radix-ui';
import { cn } from '@/lib/utils';

function ScrollArea({
  className,
  children,
  viewportRef,
  ...props
}: React.ComponentProps<typeof SA.Root> & { viewportRef?: React.Ref<HTMLDivElement> }) {
  return (
    <SA.Root className={cn('relative overflow-hidden', className)} {...props}>
      <SA.Viewport ref={viewportRef} className="size-full rounded-[inherit] [&>div]:!block">
        {children}
      </SA.Viewport>
      <SA.Scrollbar
        orientation="vertical"
        className="flex h-full w-2 touch-none border-l border-l-transparent p-px select-none"
      >
        <SA.Thumb className="relative flex-1 rounded-full bg-border" />
      </SA.Scrollbar>
      <SA.Corner />
    </SA.Root>
  );
}

export { ScrollArea };
