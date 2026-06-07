import { colorFor, detectPR, laneX, LAYOUT } from '@/src/lib/git-swimlanes';
import type { LaneModel } from '@/src/lib/git-swimlanes';

interface Offsets {
  top: number[];
  totalH: number;
  dotY: (i: number) => number;
}

interface GitGraphProps {
  model: LaneModel;
  offsets: Offsets;
  showLaneGuides?: boolean;
}

export function GitGraph({ model, offsets, showLaneGuides = true }: GitGraphProps) {
  return (
    <svg width={model.graphW} height={offsets.totalH} aria-hidden="true">
      {/* Lane guides */}
      {showLaneGuides &&
        Array.from({ length: model.nLanes }, (_, i) => (
          <line
            key={`guide-${i}`}
            x1={laneX(i)}
            y1={0}
            x2={laneX(i)}
            y2={offsets.totalH}
            style={{ stroke: colorFor(model.laneNames[i]) }}
            strokeWidth={2}
            opacity={0.07}
          />
        ))}

      {/* Edges (rendered before nodes so nodes sit on top) */}
      {model.commits.map((c) => {
        const r = model.rowOf[c.hash];
        const cx = laneX(model.laneOf[c.hash]);
        const cy = offsets.dotY(r);
        return c.parents.map((ph, pi) => {
          const pr = model.rowOf[ph];
          if (pr === undefined) return null; // parent outside loaded window
          const px = laneX(model.laneOf[ph]);
          const py = offsets.dotY(pr);
          const color =
            pi === 0
              ? colorFor(model.branchOf[c.hash])
              : colorFor(model.branchOf[ph]);
          if (cx === px) {
            return (
              <line
                key={`edge-${c.hash}-${pi}`}
                x1={cx}
                y1={cy}
                x2={px}
                y2={py}
                fill="none"
                strokeWidth={2}
                style={{ stroke: color }}
              />
            );
          }
          const my = (cy + py) / 2;
          return (
            <path
              key={`edge-${c.hash}-${pi}`}
              d={`M ${cx} ${cy} C ${cx} ${my}, ${px} ${my}, ${px} ${py}`}
              fill="none"
              strokeWidth={2}
              style={{ stroke: color }}
            />
          );
        });
      })}

      {/* Nodes */}
      {model.commits.map((c) => {
        const r = model.rowOf[c.hash];
        const cx = laneX(model.laneOf[c.hash]);
        const cy = offsets.dotY(r);
        const color = colorFor(model.branchOf[c.hash]);
        const isMerge = c.parents.length >= 2;
        const pr = detectPR(c.subject);
        return (
          <g key={`node-${c.hash}`}>
            {pr && (
              <circle
                cx={cx}
                cy={cy}
                r={11}
                fill="none"
                stroke="#7b93ff"
                strokeWidth={1.5}
              />
            )}
            {isMerge ? (
              <>
                <circle cx={cx} cy={cy} r={LAYOUT.mergeR} style={{ fill: color }} />
                <circle
                  cx={cx}
                  cy={cy}
                  r={LAYOUT.mergeR - 3}
                  fill="var(--color-surface-2)"
                />
              </>
            ) : (
              <circle cx={cx} cy={cy} r={LAYOUT.dotR} style={{ fill: color }} />
            )}
          </g>
        );
      })}
    </svg>
  );
}
