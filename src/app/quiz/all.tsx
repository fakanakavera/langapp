import QuizScreen from '@/components/quiz-screen';

/** Global multiple-choice quiz: drills the quiz-due cards of ALL decks
 *  together, drawing distractors from every deck's entries. Still only the
 *  words that would appear if you opened multiple choice from inside a
 *  deck — just pooled across decks so you can roll through everything you
 *  know and clear it out faster. */
export default function GlobalQuizRoute() {
  return <QuizScreen />;
}
