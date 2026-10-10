// SPDX-License-Identifier: GPL-3.0-or-later
import type { ToolId } from '@/store/uiStore';
import { directTool } from './direct';
import { ellipseTool, penTool, rectTool } from './draw';
import { angleTool, entryExitTool, handTool, satinDirectionTool, zoomTool } from './misc';
import { selectTool } from './select';
import type { Tool } from './types';

export const TOOLS: Record<ToolId, Tool> = {
  select: selectTool,
  direct: directTool,
  pen: penTool,
  rect: rectTool,
  ellipse: ellipseTool,
  hand: handTool,
  zoom: zoomTool,
  angle: angleTool,
  entryExit: entryExitTool,
  satinDirection: satinDirectionTool,
};

export function getTool(id: ToolId): Tool {
  return TOOLS[id];
}
