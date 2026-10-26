import { useState } from 'react';
import {
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

import { useTheme } from '@/hooks/use-theme';

type SliderProps = {
  /** 0–100 */
  value: number;
  onChange: (value: number) => void;
  step?: number;
};

/**
 * Dependency-free slider (tap or drag): no native modules, so it works
 * in Expo Go as well as dev builds and web.
 */
export function Slider({ value, onChange, step = 5 }: SliderProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const clamped = Math.min(100, Math.max(0, Math.round(value)));

  function setFromEvent(event: GestureResponderEvent) {
    if (!width) return;
    const x = event.nativeEvent.locationX ?? 0;
    const ratio = Math.min(1, Math.max(0, x / width));
    onChange(Math.min(100, Math.max(0, Math.round((ratio * 100) / step) * step)));
  }

  function onLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  return (
    <View
      onStartShouldSetResponder={() => true}
      onResponderGrant={setFromEvent}
      onResponderMove={setFromEvent}
      onResponderTerminationRequest={() => false}
      onLayout={onLayout}
      style={styles.hit}
      accessibilityRole="adjustable"
      accessibilityValue={{ min: 0, max: 100, now: clamped }}>
      <View style={[styles.bar, { backgroundColor: theme.backgroundElement }]}>
        <View style={[styles.fill, { backgroundColor: theme.tint, width: `${clamped}%` }]} />
      </View>
      <View style={[styles.knob, { borderColor: theme.tint, left: `${clamped}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  hit: {
    height: 40,
    justifyContent: 'center',
    width: '100%',
  },
  bar: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: {
    height: 8,
    borderRadius: 4,
  },
  knob: {
    position: 'absolute',
    top: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    marginLeft: -12,
    backgroundColor: '#ffffff',
    borderWidth: 3,
  },
});
