import type { ComponentType, SVGProps } from 'react';

export type CommandGroup = 'sessions' | 'profiles' | 'ui' | 'context';

export interface Command {
  id: string;
  group: CommandGroup;
  label: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  shortcut?: string;
  run: () => void | Promise<void>;
}
