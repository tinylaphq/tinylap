// SPDX-FileCopyrightText: 2026 The TinyLap contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// No AI attribution (AGENTS.md): a pull request's commits, title and
// description name no AI tool, as author, committer, sign-off or trailer.
// An agent's sandbox may set its own git identity; commits made there must
// still be the person's own.
//
//   node tools/no-ai-attribution.js <base> <head>
//
// checks every commit in <base>..<head>, and PR_TITLE and PR_BODY from the
// environment when they are set. Exits 1 and names each finding.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** What marks a text as AI-attributed, each with what it means. @type {[RegExp, string][]} */
const MARKS = [
  [/noreply@anthropic\.com/i, 'an Anthropic address'],
  [/^\s*co-authored-by:.*\b(claude|anthropic|copilot|chatgpt|openai|gemini)\b/im, 'an AI co-author trailer'],
  [/^\s*signed-off-by:.*\b(claude|anthropic)\b/im, 'a sign-off by an AI identity'],
  // The footer line itself ("🤖 Generated with [Claude Code](…)"), not a sentence that mentions it.
  [/^\W*generated with \[?claude code\b/im, 'a "Generated with Claude Code" line'],
  [/claude\.ai\/code\/session/i, 'a link to a Claude Code session'],
];

/** The findings in one text. @param {string} where @param {string} text @returns {string[]} */
export function findings(where, text) {
  return MARKS.filter(([mark]) => mark.test(text)).map(([, what]) => `${where}: ${what}`);
}

/**
 * The findings in each commit: its author, committer and message.
 * @param {{ sha: string, author: string, committer: string, message: string }[]} commits
 */
export function commitFindings(commits) {
  return commits.flatMap(({ sha, author, committer, message }) => [
    ...findings(`${sha.slice(0, 7)} author`, author),
    ...findings(`${sha.slice(0, 7)} committer`, committer),
    ...findings(`${sha.slice(0, 7)} message`, message),
  ]);
}

/** The commits in base..head, read with git. @param {string} base @param {string} head */
function readCommits(base, head) {
  const SEP = '\u001e';
  const out = execFileSync('git', ['log', `--format=%H%x1f%an <%ae>%x1f%cn <%ce>%x1f%B${SEP}`, `${base}..${head}`], { encoding: 'utf8' });
  return out.split(SEP).map((s) => s.trim()).filter(Boolean).map((entry) => {
    const [sha, author, committer, message] = entry.split('\u001f');
    return { sha, author, committer, message };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [base, head] = process.argv.slice(2);
  if (!base || !head) {
    console.error('usage: node tools/no-ai-attribution.js <base> <head>');
    process.exit(2);
  }
  const found = [
    ...commitFindings(readCommits(base, head)),
    ...findings('pull request title', process.env.PR_TITLE ?? ''),
    ...findings('pull request description', process.env.PR_BODY ?? ''),
  ];
  for (const line of found) console.error(line);
  if (found.length) {
    console.error('\nNo AI attribution (AGENTS.md): commit as yourself, and leave AI trailers and lines out.');
    process.exit(1);
  }
  console.log('No AI attribution found.');
}
