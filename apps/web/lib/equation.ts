/*
 * An equation's body, made into something KaTeX will typeset.
 *
 * The parser keeps what is *inside* a display environment and records the environment
 * beside it, so `align` arrives as `a &= b \\ c &= d` with no `\begin{align}`. That is
 * the right thing to store and the wrong thing to typeset: a bare `&` is a parse error,
 * and 164 of the library's 524 equations — every multi-line one — rendered as the
 * error colour over their own source, under a heading that says "exact".
 *
 * So the multi-line environments are put back, as the inner forms KaTeX accepts
 * anywhere. Numbering is not restored: the label is shown beside the equation already.
 */

//: Environments whose rows align on `&`, and the KaTeX form that lays them out the
//: same way. `eqnarray` is three columns, right–centre–left, each in display style,
//: which is `darray{rcl}` exactly; `aligned` would pair the columns up wrongly.
const ALIGNED: Record<string, string> = {
  align: "aligned",
  "align*": "aligned",
  flalign: "aligned",
  "flalign*": "aligned",
  alignat: "aligned",
  "alignat*": "aligned",
  split: "aligned",
  gather: "gathered",
  "gather*": "gathered",
  multline: "gathered",
  "multline*": "gathered",
};

export function typesettable(latex: string, environment: string): string {
  if (environment === "eqnarray" || environment === "eqnarray*") {
    return `\\begin{darray}{rcl}${latex}\\end{darray}`;
  }
  const inner = ALIGNED[environment];
  return inner ? `\\begin{${inner}}${latex}\\end{${inner}}` : latex;
}
