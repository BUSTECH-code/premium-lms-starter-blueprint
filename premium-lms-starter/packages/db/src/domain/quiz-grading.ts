/**
 * Pure auto-grader for objective quiz questions — Phase 3 (approved Q3
 * pass80_unlimited_best). Correct answers stay server-side; nothing returned
 * by this module contains an answer key.
 *
 * Supported objective kinds: single_choice, multiple_choice, true_false.
 * Assignments / subjective questions are deliberately out of scope (O-11 open).
 */

export type QuizQuestionKind = 'single_choice' | 'multiple_choice' | 'true_false';

export interface QuizChoice {
  id: string;
  text: string;
  /** Server-only. Never serialised to the browser. */
  isCorrect: boolean;
}

export interface GradableQuestion {
  id: string;
  kind: QuizQuestionKind;
  prompt: string;
  points: number;
  choices: QuizChoice[];
}

export interface PublicQuizChoice {
  id: string;
  text: string;
}

export interface PublicQuizQuestion {
  id: string;
  kind: QuizQuestionKind;
  prompt: string;
  points: number;
  choices: PublicQuizChoice[];
}

export type QuizAnswers = Record<string, string[]>;

export interface QuestionGrade {
  questionId: string;
  correct: boolean;
  earnedPoints: number;
  possiblePoints: number;
}

export interface QuizGrade {
  pointsEarned: number;
  pointsPossible: number;
  scorePercent: number;
  passed: boolean;
  perQuestion: QuestionGrade[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normaliseSelections(
  question: GradableQuestion,
  submitted: string[] | undefined,
): string[] {
  const validIds = new Set(question.choices.map((choice) => choice.id));
  const unique = new Set(
    (submitted ?? []).filter(
      (value): value is string => typeof value === 'string' && validIds.has(value),
    ),
  );
  return [...unique].sort();
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Strip the answer key before any question data leaves the server. */
export function toPublicQuestions(questions: readonly GradableQuestion[]): PublicQuizQuestion[] {
  return questions.map((question) => ({
    id: question.id,
    kind: question.kind,
    prompt: question.prompt,
    points: question.points,
    choices: question.choices.map((choice) => ({ id: choice.id, text: choice.text })),
  }));
}

/**
 * Deterministic, stable representation of a submission. Unknown question ids,
 * unknown choice ids and duplicate selections are dropped so retry/conflict
 * detection compares the learner's real choices, not incidental JSON ordering.
 */
export function canonicalAnswers(
  questions: readonly GradableQuestion[],
  answers: QuizAnswers,
): QuizAnswers {
  const canonical: QuizAnswers = {};
  for (const question of [...questions].sort((a, b) => a.id.localeCompare(b.id))) {
    const selections = normaliseSelections(question, answers[question.id]);
    if (selections.length > 0) canonical[question.id] = selections;
  }
  return canonical;
}

export function gradeObjectiveQuiz(
  questions: readonly GradableQuestion[],
  answers: QuizAnswers,
  passingScorePercent: number,
): QuizGrade {
  if (questions.length === 0) {
    throw new Error('Cannot grade a quiz with no questions');
  }
  if (!Number.isInteger(passingScorePercent) || passingScorePercent < 1 || passingScorePercent > 100) {
    throw new Error('Invalid passing score');
  }

  const perQuestion: QuestionGrade[] = [];
  let pointsEarned = 0;
  let pointsPossible = 0;

  for (const question of questions) {
    if (question.points < 1) throw new Error('Question points must be positive');
    const correctIds = question.choices
      .filter((choice) => choice.isCorrect)
      .map((choice) => choice.id)
      .sort();
    if (correctIds.length === 0) throw new Error('Question has no correct choice');
    const submitted = normaliseSelections(question, answers[question.id]);

    let correct = false;
    if (question.kind === 'multiple_choice') {
      correct = submitted.length > 0 && sameSet(submitted, correctIds);
    } else {
      // single_choice and true_false require exactly that one correct option.
      correct = submitted.length === 1 && submitted[0] === correctIds[0];
    }

    const earned = correct ? question.points : 0;
    pointsEarned += earned;
    pointsPossible += question.points;
    perQuestion.push({
      questionId: question.id,
      correct,
      earnedPoints: earned,
      possiblePoints: question.points,
    });
  }

  const scorePercent = round2((pointsEarned / pointsPossible) * 100);
  return {
    pointsEarned: round2(pointsEarned),
    pointsPossible: round2(pointsPossible),
    scorePercent,
    passed: scorePercent >= passingScorePercent,
    perQuestion,
  };
}
