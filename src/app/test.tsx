import { StyleSheet } from 'react-native';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';

export default function TestScreen() {
  return (
    <Screen>
      <ThemedText type="title" style={styles.title}>
        Hello World 👋
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.subtitle}>
        App installation working!
      </ThemedText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 32,
    marginBottom: 16,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    textAlign: 'center',
  },
});