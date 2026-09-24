import assert from "node:assert/strict";
import { test } from "node:test";

import { readArxivId } from "../lib/arxiv.ts";

test("a bare identifier passes through", () => {
  assert.equal(readArxivId("1706.03762"), "1706.03762");
  assert.equal(readArxivId("  1706.03762  "), "1706.03762");
  assert.equal(readArxivId("2301.00001"), "2301.00001");
});

test("both suffix lengths, because arXiv changed in 2015", () => {
  // Five digits after the dot is the current form; four is what everything before
  // 1501 has, and word2vec (1301.3781) is in the library — so refusing four digits
  // would refuse papers this site already analyses.
  assert.equal(readArxivId("1910.10683"), "1910.10683");
  assert.equal(readArxivId("1301.3781"), "1301.3781");
  assert.equal(readArxivId("1706.3762"), "1706.3762");
});

test("the URLs people actually paste", () => {
  for (const url of [
    "https://arxiv.org/abs/1706.03762",
    "http://arxiv.org/abs/1706.03762",
    "arxiv.org/abs/1706.03762",
    "https://arxiv.org/abs/1706.03762v7",
    "https://arxiv.org/pdf/1706.03762",
    "https://arxiv.org/pdf/1706.03762v7.pdf",
    "https://arxiv.org/abs/1706.03762/",
    "https://www.arxiv.org/abs/1706.03762",
  ]) {
    assert.equal(readArxivId(url), "1706.03762", url);
  }
});

test("the version is dropped, because the parser reads what arXiv serves now", () => {
  assert.equal(readArxivId("1706.03762v7"), "1706.03762");
  assert.equal(readArxivId("arXiv:1706.03762v12"), "1706.03762");
});

test("the arXiv: prefix, in any case", () => {
  assert.equal(readArxivId("arXiv:1706.03762"), "1706.03762");
  assert.equal(readArxivId("ARXIV:1706.03762"), "1706.03762");
});

test("pre-2007 identifiers", () => {
  assert.equal(readArxivId("cs.CL/0701001"), "cs.CL/0701001");
  assert.equal(readArxivId("math/0309136"), "math/0309136");
  assert.equal(readArxivId("https://arxiv.org/abs/hep-th/9901001"), "hep-th/9901001");
});

test("anything that is not an identifier is refused", () => {
  // Each of these would otherwise become a URL this service fetches.
  for (const junk of [
    "",
    "   ",
    "hello",
    "1706",
    "17060.3762",
    "https://example.com/abs/1706.03762",
    "../../etc/passwd",
    "1706.03762; DROP TABLE",
    "<script>alert(1)</script>",
  ]) {
    assert.equal(readArxivId(junk), "", JSON.stringify(junk));
  }
});

test("a DOI or a title is not an arXiv id", () => {
  assert.equal(readArxivId("10.1000/182"), "");
  assert.equal(readArxivId("Attention Is All You Need"), "");
});
