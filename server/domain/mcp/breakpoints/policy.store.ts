import type { DatabaseHandle } from '@/server/db/database';
import type { BreakpointPolicy, CategoryMode, ToolCategory } from './breakpoints.types';

interface Row {
  category: ToolCategory;
  mode: CategoryMode;
}

export class BreakpointPolicyStore {
  constructor(private readonly db: DatabaseHandle) {}

  read(): BreakpointPolicy {
    const rows = this.db
      .prepare('SELECT category, mode FROM breakpoint_policy')
      .all() as Row[];
    const out: BreakpointPolicy = { safe: 'auto', dangerous: 'gate', external: 'gate' };
    for (const r of rows) out[r.category] = r.mode;
    return out;
  }

  setCategory(category: ToolCategory, mode: CategoryMode): void {
    this.db
      .prepare('UPDATE breakpoint_policy SET mode = ? WHERE category = ?')
      .run(mode, category);
  }
}
