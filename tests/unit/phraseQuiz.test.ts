import { describe, expect, it } from "vitest";
import {
  QUIZ_CHOICES,
  QUIZ_QUESTIONS,
  cryptoRandomIndex,
  newQuizAttempt,
  pickQuizWord,
  resumeQuiz,
  type RandomIndex,
} from "../../src/application/phraseQuiz.js";

const WORDS =
  "abandon ability able about above absent absorb abstract absurd abuse access accident".split(" ");

/** A repeatable stand-in for the random source. */
function seeded(seed = 1): RandomIndex {
  let state = seed;
  return (bound) => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state % bound;
  };
}

const answerOf = (quiz: { positions: number[]; step: number }) => WORDS[quiz.positions[quiz.step]];
const wrongOf = (quiz: {
  choices: string[];
  disabled: string[];
  positions: number[];
  step: number;
}) => quiz.choices.find((word) => word !== answerOf(quiz) && !quiz.disabled.includes(word))!;

describe("the phrase quiz", () => {
  it("asks three distinct positions in ascending order, with four distinct choices including the answer", () => {
    const quiz = newQuizAttempt(WORDS, seeded());
    expect(quiz.positions).toHaveLength(QUIZ_QUESTIONS);
    expect(new Set(quiz.positions).size).toBe(QUIZ_QUESTIONS);
    expect([...quiz.positions].sort((a, b) => a - b)).toEqual(quiz.positions);
    expect(quiz.choices).toHaveLength(QUIZ_CHOICES);
    expect(new Set(quiz.choices).size).toBe(QUIZ_CHOICES);
    expect(quiz.choices).toContain(answerOf(quiz));
    expect(quiz.choices.every((word) => WORDS.includes(word))).toBe(true);
  });

  it("advances on a correct pick and passes on the third", () => {
    const random = seeded(3);
    let quiz = newQuizAttempt(WORDS, random);
    const outcomes = [];
    for (let step = 0; step < QUIZ_QUESTIONS; step += 1) {
      const result = pickQuizWord(quiz, answerOf(quiz), WORDS, random);
      outcomes.push(result.outcome);
      quiz = result.quiz;
    }
    expect(outcomes).toEqual(["correct", "correct", "passed"]);
    expect(quiz.passed).toBe(true);
  });

  it("keeps the question on a wrong pick, disables that choice and names the position, never the word", () => {
    const random = seeded(5);
    const quiz = newQuizAttempt(WORDS, random);
    const wrong = wrongOf(quiz);
    const { quiz: next, outcome } = pickQuizWord(quiz, wrong, WORDS, random);
    expect(outcome).toBe("wrong");
    expect(next.step).toBe(0);
    expect(next.positions).toEqual(quiz.positions);
    expect(next.disabled).toEqual([wrong]);
    expect(next.hint).toBe(quiz.positions[0] + 1);
  });

  it("counts misses across the attempt and restarts on the third with new positions", () => {
    const random = seeded(7);
    let quiz = newQuizAttempt(WORDS, random);
    quiz = pickQuizWord(quiz, wrongOf(quiz), WORDS, random).quiz;
    quiz = pickQuizWord(quiz, answerOf(quiz), WORDS, random).quiz;
    quiz = pickQuizWord(quiz, wrongOf(quiz), WORDS, random).quiz;
    const before = quiz.positions;
    const { quiz: restarted, outcome } = pickQuizWord(quiz, wrongOf(quiz), WORDS, random);
    expect(outcome).toBe("restarted");
    expect(restarted).toMatchObject({ step: 0, misses: 0, disabled: [], restarted: true });
    expect(restarted.positions).not.toEqual(before);
    expect(resumeQuiz(restarted).restarted).toBe(false);
  });

  it("offers a repeated word once", () => {
    const repeated = [...WORDS.slice(0, 11), "abandon"];
    for (let seed = 1; seed < 40; seed += 1) {
      const quiz = newQuizAttempt(repeated, seeded(seed));
      expect(new Set(quiz.choices).size).toBe(quiz.choices.length);
    }
  });

  it("draws uniform indexes inside the bound from WebCrypto", () => {
    const seen = new Set<number>();
    for (let draw = 0; draw < 200; draw += 1) {
      const index = cryptoRandomIndex(4);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(4);
      seen.add(index);
    }
    expect(seen.size).toBe(4);
    expect(cryptoRandomIndex(1)).toBe(0);
  });
});
