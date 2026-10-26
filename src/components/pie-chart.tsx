import { Circle, Path, Svg } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';

export type PieChartSegment = {
  label: string;
  value: number;
  color: string;
};

const SIZE = 168;
const CENTER = SIZE / 2;
const RADIUS = 76;

function pointAt(angle: number): { x: number; y: number } {
  const radians = (angle * Math.PI) / 180;
  return {
    x: CENTER + RADIUS * Math.cos(radians),
    y: CENTER + RADIUS * Math.sin(radians),
  };
}

function createSlices(
  segments: PieChartSegment[],
  total: number,
): { key: string; path: string; color: string }[] {
  let startAngle = -90;
  const slices: { key: string; path: string; color: string }[] = [];
  for (const segment of segments) {
    if (segment.value <= 0) continue;
    const fraction = segment.value / total;
    const endAngle = startAngle + fraction * 360;
    const start = pointAt(startAngle);
    const end = pointAt(endAngle);
    const path =
      fraction >= 0.99999
        ? `M ${CENTER} ${CENTER - RADIUS} A ${RADIUS} ${RADIUS} 0 1 1 ${CENTER} ${CENTER + RADIUS} A ${RADIUS} ${RADIUS} 0 1 1 ${CENTER} ${CENTER - RADIUS} Z`
        : `M ${CENTER} ${CENTER} L ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${fraction > 0.5 ? 1 : 0} 1 ${end.x} ${end.y} Z`;
    slices.push({ key: segment.label, path, color: segment.color });
    startAngle = endAngle;
  }
  return slices;
}

export function PieChart({ segments }: { segments: PieChartSegment[] }) {
  const theme = useTheme();
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total === 0) {
    return (
      <Svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        accessibilityLabel="No words to chart">
        <Circle cx={CENTER} cy={CENTER} r={RADIUS} fill={theme.backgroundSelected} />
      </Svg>
    );
  }

  const slices = createSlices(segments, total);
  return (
    <Svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      accessibilityLabel={segments
        .filter((segment) => segment.value > 0)
        .map((segment) => `${segment.label}: ${segment.value}`)
        .join(', ')}>
      {slices.map((slice) => (
        <Path key={slice.key} d={slice.path} fill={slice.color} />
      ))}
    </Svg>
  );
}
