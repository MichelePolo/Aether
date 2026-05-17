import { StatusDot } from '@/src/components/ui/StatusDot';

export function ConnectionFooter() {
  return (
    <div className="flex items-center justify-between">
      <span>LATENCY: —</span>
      <div className="flex items-center gap-2">
        <StatusDot status="online" label="Server" />
        <span>ONLINE</span>
      </div>
    </div>
  );
}
