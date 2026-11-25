import { describe, expect, it } from "vitest";
import { alignMathLines, convertFractions, hasMath, mathAsPlain, splitMath } from "./math";
import { compareAnswer } from "./answer";

describe("splitMath", () => {
  it("zwykły tekst bez zmian, także z ukośnikiem", () => {
    expect(splitMath("i/lub 3/4")).toEqual([{ type: "text", value: "i/lub 3/4" }]);
    expect(hasMath("kosztuje 5 $ a tamto 6 $")).toBe(false);
    expect(hasMath("od $5 do $6")).toBe(false);
  });
  it("wzory w tekście i w osobnej linii", () => {
    expect(splitMath("Ile to $1/2 + 1/4$?")).toEqual([
      { type: "text", value: "Ile to " },
      { type: "math", value: "1/2 + 1/4", display: false },
      { type: "text", value: "?" },
    ]);
    expect(splitMath("$$x^2$$")).toEqual([{ type: "math", value: "x^2", display: true }]);
  });
  it("\\$ to zwykły dolar", () => {
    expect(splitMath("\\$5")).toEqual([{ type: "text", value: "$5" }]);
  });
  it("mathAsPlain usuwa znaczniki", () => {
    expect(mathAsPlain("Wynik: $3/4$")).toBe("Wynik: 3/4");
  });
});

describe("convertFractions", () => {
  it.each([
    ["a/b", "\\frac{a}{b}"],
    ["1/2 + 1/4", "\\frac{1}{2} + \\frac{1}{4}"],
    ["a / b", "\\frac{a}{b}"],
    ["(a+b)/(c-d)", "\\frac{a+b}{c-d}"],
    ["{a+b}/2", "\\frac{a+b}{2}"],
    ["x^2/2", "\\frac{x^2}{2}"],
    ["2x/3", "\\frac{2x}{3}"],
    ["a/b/c", "\\frac{\\frac{a}{b}}{c}"],
    ["\\sqrt{2}/2", "\\frac{\\sqrt{2}}{2}"],
    ["\\pi/4", "\\frac{\\pi}{4}"],
    ["f(x)/2", "\\frac{f(x)}{2}"],
    ["\\sqrt{1/2}", "\\sqrt{\\frac{1}{2}}"],
    ["((a+b)/2)^2", "(\\frac{a+b}{2})^2"],
    ["\\frac{a}{b}", "\\frac{a}{b}"],
    ["x = -b/(2a)", "x = -\\frac{b}{2a}"],
    ["a{/}b", "a{/}b"],
    ["0,5/2", "\\frac{0,5}{2}"],
  ])("%s", (inp, out) => {
    expect(convertFractions(inp)).toBe(out);
  });
});

describe("odpowiedź wpisywana", () => {
  it("1/2 pasuje do $1/2$", () => {
    expect(compareAnswer("1/2", "$1/2$")).toBe("exact");
  });
});

describe("alignMathLines", () => {
  it("łączy linie obliczeń i wyrównuje =", () => {
    expect(alignMathLines("Rozwiązanie:\n$a/b = c$\n$= d$")).toBe(
      "Rozwiązanie:\n$$\\begin{aligned}a/b &= c\\\\[0.6em]&= d\\end{aligned}$$",
    );
  });
  it("pojedynczy wzór i zwykły tekst bez zmian", () => {
    expect(alignMathLines("Wynik: $1/2$\n$x$\ni/lub")).toBe("Wynik: $1/2$\n$x$\ni/lub");
  });
  it("= w nawiasach nie jest punktem wyrównania", () => {
    expect(alignMathLines("${a=b}+c = d$\n$= e$")).toContain("{a=b}+c &= d");
  });
});
