/**
 * The bar above the table: the row-groups drop zone and the sidebar toggle.
 * Phase 3 adds the quick filter, density and export here — TODO(grid-phase-3).
 */

import { PanelRight } from 'lucide-react';
import type { TreasuryTable } from '../grid/useTreasuryTable';
import { GroupByDropZone } from './GroupByDropZone';
import { Button } from './ui/button';

export function GridToolbar({
  table,
  grouping,
  sidebarOpen,
  onToggleSidebar,
}: {
  table: TreasuryTable;
  grouping: string[];
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  return (
    <div data-slot="grid-toolbar" className="flex items-center gap-2 border-b border-border bg-card px-2 py-1.5">
      <GroupByDropZone table={table} grouping={grouping} />
      <Button
        variant={sidebarOpen ? 'secondary' : 'ghost'}
        size="xs"
        aria-pressed={sidebarOpen}
        aria-label={sidebarOpen ? 'Hide columns panel' : 'Show columns panel'}
        onClick={onToggleSidebar}
      >
        <PanelRight />
        Columns
      </Button>
    </div>
  );
}
