import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';

export default function TestScreen() {
  return (
    <Screen style={styles.container}>
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
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 18,
  },
});