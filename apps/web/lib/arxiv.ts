/*
 * The arXiv identifier out of whatever somebody pasted.
 *
 * People paste the URL they are looking at, and that is four or five different URLs
 * depending on whether they were reading the abstract, the PDF, or a link somebody
 * sent them. Refusing all but the bare identifier would be technically defensible and
 * would fail the first person who tried it.
 *
 * This mirrors `read_id` in api/ingest.py. Both exist because the browser should not
 * navigate to a page that is certain to fail, and the function cannot trust the
 * browser — so the same rule is written twice, and the tests beside this file pin the
 * cases that matter to both.
 */

//: arXiv's modern form (1706.03762), and the pre-2007 one (cs.CL/0701001).
//:
//: Four digits after the dot as well as five: that is the pre-2015 form, and the
//: library's own word2vec entry is 1301.3781, so a five-only rule would refuse
//: papers this site already analyses.
const NEW_STYLE = /^\d{4}\.\d{4,5}$/;
const OLD_STYLE = /^[a-z-]+(\.[A-Z]{2})?\/\d{7}$/;

/**
 * Whether a string is an arXiv identifier, for the routes that turn one into a
 * database key or a URL.
 *
 * Exported so there is one definition rather than a copy per route. There were five,
 * they had already drifted — the marks route accepted only the modern shape — and the
 * failure that produces is a paper you can read and then cannot highlight.
 */
export function isArxivId(text: string): boolean {
  return NEW_STYLE.test(text) || OLD_STYLE.test(text);
}

/** The id, or an empty string if that was not one. */
export function readArxivId(raw: string): string {
  let text = (raw ?? "").trim();
  if (!text) return "";

  const fromUrl = text.match(
    /arxiv\.org\/(?:abs|pdf|format)\/([A-Za-z0-9./-]+?)(?:v\d+)?(?:\.pdf)?\/?(?:[?#].*)?$/i,
  );
  if (fromUrl) text = fromUrl[1];

  text = text.replace(/^arxiv:/i, "").trim();
  // The version is dropped. The parser reads whatever arXiv currently serves, so
  // keeping a version in the key would promise something it did not honour.
  text = text.replace(/v\d+$/, "");

  return NEW_STYLE.test(text) || OLD_STYLE.test(text) ? text : "";
}
