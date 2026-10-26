import { Pressable, StyleSheet, ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type UiButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  style?: ViewStyle;
};

export function UiButton({ label, onPress, variant = 'primary', disabled, style }: UiButtonProps) {
  const theme = useTheme();
  const backgroundColor = variant === 'primary' ? theme.tint : theme.backgroundElement;
  const color = variant === 'primary' ? '#ffffff' : theme.text;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}>
      <ThemedText style={[styles.label, { color }]}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.two + 2,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontWeight: 600,
    textAlign: 'center',
  },
});
