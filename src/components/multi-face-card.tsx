import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { UiButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import type { DueCard, FaceResponse } from '@/db/types';
import { speakRussian, stopSpeech } from '@/lib/speech';
export type MultiFaceCardProps = {
  card: DueCard;
  hint: string;
  onComplete: (history: FaceResponse[]) => void;
};

const FACE_CONTENT = {
  1: { label: 'Word', showTranslation: false },
  2: { label: 'Hint', showTranslation: false },
  3: { label: 'Meaning', showTranslation: true },
} as const;

type Face1Response = 'know' | 'dont_know';
type Face2Response = 'know' | 'dont_know';
type Face3Response = 'no_idea' | 'vague_idea' | 'knew_confirm';

export function MultiFaceCard({
  card,
  hint,
  onComplete,
}: MultiFaceCardProps) {
  // Every card always starts at face 1. `key={card.id}` in the parent
  // remounts on card change; this render-time reset is belt-and-braces for
  // uses without a key (useState initializers alone would keep stale face).
  const [shownCardId, setShownCardId] = React.useState(card.id);
  const [currentFace, setCurrentFace] = React.useState<1 | 2 | 3>(1);
  const [faceHistory, setFaceHistory] = React.useState<FaceResponse[]>([]);

  if (shownCardId !== card.id) {
    setShownCardId(card.id);
    setCurrentFace(1);
    setFaceHistory([]);
  }

  // Time-to-answer: stamped when each face is shown, so the history
  // records how long the user thought before pressing a button.
  const faceShownAt = React.useRef<number>(0);
  React.useEffect(() => {
    faceShownAt.current = Date.now();
  }, [currentFace, card.id]);

  // Read the word (face 1) and the phrase (face 2) out loud. Stops any
  // ongoing speech when the face changes or the card unmounts.
  React.useEffect(() => {
    if (currentFace === 1) {
      void speakRussian(card.front);
    } else if (currentFace === 2) {
      void speakRussian(hint);
    }
    return () => {
      stopSpeech();
    };
  }, [card.id, card.front, currentFace, hint]);

  function handleFace1Response(response: Face1Response) {
    const newResponse: FaceResponse = {
      face: 1,
      response,
      duration_ms: Date.now() - faceShownAt.current,
    };
    const newHistory = [...faceHistory, newResponse];
    setFaceHistory(newHistory);
    if (response === 'know') {
      onComplete(newHistory);
    } else {
      setCurrentFace(2);
    }
  }

  function handleFace2Response(response: Face2Response) {
    const newResponse: FaceResponse = {
      face: 2,
      response,
      duration_ms: Date.now() - faceShownAt.current,
    };
    const newHistory = [...faceHistory, newResponse];
    setFaceHistory(newHistory);
    if (response === 'know') {
      onComplete(newHistory);
    } else {
      setCurrentFace(3);
    }
  }

  function handleFace3Response(response: Face3Response) {
    const newResponse: FaceResponse = {
      face: 3,
      response,
      duration_ms: Date.now() - faceShownAt.current,
    };
    const newHistory = [...faceHistory, newResponse];
    setFaceHistory(newHistory);
    onComplete(newHistory);
  }

  function renderFace1() {
    return (
      <View style={styles.faceContainer} key="face1">
        <View style={styles.content}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.faceLabel}>
            {FACE_CONTENT[1].label}
          </ThemedText>
          <ThemedText type="title" style={styles.wordText}>
            {card.front}
          </ThemedText>
        </View>
        <View style={styles.buttonRow}>
          <UiButton
            label="Know"
            variant="primary"
            onPress={() => handleFace1Response('know')}
            style={styles.button}
          />
          <UiButton
            label="Don't Know"
            variant="secondary"
            onPress={() => handleFace1Response('dont_know')}
            style={styles.button}
          />
        </View>
      </View>
    );
  }

  function renderFace2() {
    return (
      <View style={styles.faceContainer} key="face2">
        <View style={styles.content}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.faceLabel}>
            {FACE_CONTENT[2].label}
          </ThemedText>
          <ThemedText type="subtitle" style={styles.phraseText}>
            {hint}
          </ThemedText>
        </View>
        <View style={styles.buttonRow}>
          <UiButton
            label="Know"
            variant="primary"
            onPress={() => handleFace2Response('know')}
            style={styles.button}
          />
          <UiButton
            label="Don't Know"
            variant="secondary"
            onPress={() => handleFace2Response('dont_know')}
            style={styles.button}
          />
        </View>
      </View>
    );
  }

  function renderFace3() {
    return (
      <View style={styles.faceContainer} key="face3">
        <View style={styles.content}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.faceLabel}>
            {FACE_CONTENT[3].label}
          </ThemedText>
          <ThemedText type="subtitle" style={styles.wordText}>
            {card.front}
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.meaningText}>
            {card.back}
          </ThemedText>
        </View>
        <View style={styles.buttonRow}>
          <UiButton
            label="Knew, confirmed"
            variant="primary"
            onPress={() => handleFace3Response('knew_confirm')}
            style={styles.button}
          />
          <UiButton
            label="Vague idea"
            variant="secondary"
            onPress={() => handleFace3Response('vague_idea')}
            style={styles.button}
          />
          <UiButton
            label="Had no idea"
            variant="secondary"
            onPress={() => handleFace3Response('no_idea')}
            style={styles.button}
          />
        </View>
      </View>
    );
  }

  const renderFace = () => {
    switch (currentFace) {
      case 1:
        return renderFace1();
      case 2:
        return renderFace2();
      case 3:
        return renderFace3();
      default:
        return null;
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.face}>
        {renderFace()}
      </View>
      <View style={styles.progressBar}>
        {[1, 2, 3].map((f) => (
          <View
            key={f}
            style={[
              styles.progressSegment,
              f <= currentFace && styles.progressSegmentActive,
            ]}
          />
        ))}
      </View>
      {currentFace !== 3 && (
        <View style={styles.listenRow}>
          <UiButton
            label="Listen"
            variant="secondary"
            onPress={() => void speakRussian(currentFace === 2 ? hint : card.front)}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    padding: Spacing.four,
    borderRadius: 16,
    minHeight: 440,
  },
  face: {
    width: '100%',
    flexGrow: 1,
  },
  faceContainer: {
    width: '100%',
    flex: 1,
    minHeight: 380,
    justifyContent: 'flex-start',
    alignItems: 'center',
    gap: Spacing.three,
  },
  content: {
    width: '100%',
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.three,
  },
  faceLabel: {
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  wordText: {
    fontSize: 36,
    textAlign: 'center',
  },
  phraseText: {
    fontSize: 22,
    textAlign: 'center',
    lineHeight: 32,
    marginBottom: Spacing.half,
    // Reserve two lines so 1-line and 2-line hints occupy the same space
    // and the buttons below never shift.
    minHeight: 64,
  },
  meaningText: {
    fontSize: 22,
    textAlign: 'center',
    lineHeight: 32,
    marginTop: Spacing.half,
    // Same two-line reserve as the phrase, for the same reason.
    minHeight: 64,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    justifyContent: 'center',
    alignItems: 'stretch',
    marginTop: 'auto',
    paddingTop: Spacing.three,
    width: '100%',
  },
  button: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
  },
  progressBar: {
    flexDirection: 'row',
    gap: Spacing.half,
    marginTop: Spacing.three,
    justifyContent: 'center',
  },
  progressSegment: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ddd',
  },
  progressSegmentActive: {
    backgroundColor: '#208AEF',
  },
  listenRow: {
    width: '100%',
    alignItems: 'flex-end',
    marginTop: Spacing.two,
  },
});