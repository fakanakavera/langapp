import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { initDatabase } from '@/db/client';
import { Spacing } from '@/constants/theme';

type DatabaseContextValue = {
  ready: boolean;
  revision: number;
  refresh: () => void;
};

const DatabaseContext = createContext<DatabaseContextValue | null>(null);

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    initDatabase()
      .then(() => setReady(true))
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, []);

  const value = useMemo(
    () => ({
      ready,
      revision,
      refresh: () => setRevision((current) => current + 1),
    }),
    [ready, revision],
  );

  if (error) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText type="subtitle">Could not open the database</ThemedText>
        <ThemedText themeColor="textSecondary">{error}</ThemedText>
      </ThemedView>
    );
  }

  if (!ready) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
        <ThemedText themeColor="textSecondary">Preparing local data…</ThemedText>
      </ThemedView>
    );
  }

  return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>;
}

export function useDatabase(): DatabaseContextValue {
  const value = useContext(DatabaseContext);
  if (!value) {
    throw new Error('useDatabase must be used inside DatabaseProvider');
  }
  return value;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
});
