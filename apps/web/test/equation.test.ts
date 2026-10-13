/*
 * Equations put back into an environment KaTeX can typeset.
 *
 * The failure this guards against is silent in every way but one: the equation still
 * appears, in the error colour, as its own source.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import katex from "katex";

import { typesettable } from "../lib/equation.ts";

const fails = (latex: string, environment: string) =>
  katex
    .renderToString(typesettable(latex, environment), {
      displayMode: true,
      throwOnError: false,
      strict: false,
    })
    .includes("katex-error");

test("an align body typesets once its environment is restored", () => {
  const body = "h_t &= \\tanh(W x_t) \\\\ y_t &= W h_t";
  assert.ok(fails(body, ""), "a bare & should not parse; if it does, this test is moot");
  assert.equal(fails(body, "align"), false);
  assert.equal(fails(body, "align*"), false);
  assert.equal(fails(body, "split"), false);
});

test("eqnarray keeps its three columns", () => {
  const body = "\\Delta w &=& p \\Delta w' - \\epsilon \\nabla \\\\ w &=& w + \\Delta w";
  assert.equal(fails(body, "eqnarray*"), false);
  assert.match(typesettable(body, "eqnarray"), /^\\begin\{darray\}\{rcl\}/);
});

test("a single-line equation is passed through untouched", () => {
  assert.equal(typesettable("E = mc^2", "equation"), "E = mc^2");
  assert.equal(typesettable("E = mc^2", "equation*"), "E = mc^2");
});
