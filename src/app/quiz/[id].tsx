import { useLocalSearchParams } from 'expo-router';

import QuizScreen from '@/components/quiz-screen';

/** Multiple-choice quiz over a single deck's due cards. The deck id comes
 *  from the route param; opening this from inside a deck passes that deck. */
export default function QuizRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <QuizScreen deckId={id} />;
}
