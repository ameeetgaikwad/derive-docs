import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docs = JSON.parse(readFileSync(join(root, "docs.json"), "utf8"));
const claims = JSON.parse(readFileSync(join(root, "claims.json"), "utf8"));

const expectedGroups = [
  ["Start Here", ["index", "investors/brief"]],
  ["The Thesis", ["thesis/category", "thesis/held-assets"]],
  ["Product", ["product/outcome-first", "product/market-loop"]],
  ["Platform", ["platform/business-model", "platform/market-engine"]],
  ["Proof & Path", ["progress/proof", "progress/roadmap"]],
];

const fail = (message) => {
  throw new Error(message);
};

const groups = docs.navigation?.groups;
if (!Array.isArray(groups)) fail("docs.json must use navigation.groups");

const actualGroups = groups.map(({ group, pages }) => [group, pages]);
if (JSON.stringify(actualGroups) !== JSON.stringify(expectedGroups)) {
  fail("conceptual navigation no longer matches the reviewed five-group contract");
}

const routes = expectedGroups.flatMap(([, pages]) => pages);
if (routes.length !== 10 || new Set(routes).size !== 10) {
  fail("the conceptual navigation must contain exactly ten unique pages");
}

const rawPages = new Map(
  routes.map((route) => [route, readFileSync(join(root, `${route}.mdx`), "utf8")]),
);

const expectedSources = [
  "PRODUCTION.md",
  "protocol/deployments/staging/markets/56.json",
  "docs-site/how-it-works.mdx",
  "docs-site/architecture.mdx",
  "docs-site/reference/fees.mdx",
  "apps/web/src/components/marketing/PublicLanding.tsx",
];

if (JSON.stringify(claims.allowedSources) !== JSON.stringify(expectedSources)) {
  fail("claims.json must preserve the reviewed source allowlist and precedence boundary");
}

if (JSON.stringify(Object.keys(claims.pageReviews)) !== JSON.stringify(routes)) {
  fail("claims.json must contain one ordered source review for every conceptual page");
}

for (const route of routes) {
  const review = claims.pageReviews[route];
  if (!Array.isArray(review.sources) || review.sources.length === 0) {
    fail(`${route}.mdx has no approved factual source`);
  }
  for (const source of review.sources) {
    if (!claims.allowedSources.includes(source)) {
      fail(`${route}.mdx cites a source outside the explicit allowlist: ${source}`);
    }
  }
  if (!Array.isArray(review.approvedClaims) || review.approvedClaims.length === 0) {
    fail(`${route}.mdx has no machine-reviewed claim markers`);
  }
  for (const approvedClaim of review.approvedClaims) {
    if (!rawPages.get(route).includes(approvedClaim)) {
      fail(`${route}.mdx no longer contains approved claim: ${approvedClaim}`);
    }
  }
}

const digestPages = (pages) => createHash("sha256")
  .update(routes.map((route) => `${route}\0${pages.get(route)}\0`).join(""))
  .digest("hex");

const reviewedDigest = digestPages(rawPages);
if (process.argv.includes("--print-digest")) {
  console.log(reviewedDigest);
  process.exit(0);
}

const assertReviewedPages = (pages) => {
  if (digestPages(pages) !== claims.reviewedContentSha256) {
    fail("conceptual MDX changed without updating its machine-readable claim review");
  }
};

assertReviewedPages(rawPages);

const unsupportedMutation = new Map(rawPages);
unsupportedMutation.set(
  "index",
  `${unsupportedMutation.get("index")}\n\nHedge already serves institutions worldwide.`,
);
let mutationRejected = false;
try {
  assertReviewedPages(unsupportedMutation);
} catch (error) {
  mutationRejected = error.message.includes("machine-readable claim review");
}
if (!mutationRejected) {
  fail("reviewed-content lock did not reject an unsupported factual sentence regression");
}

const narrativeContract = [
  ["thesis/category", "Outcome-driven markets for held assets"],
  ["thesis/held-assets", "The held-asset problem"],
  ["product/outcome-first", "BTC covered call"],
  ["product/market-loop", "1. Collateralize"],
  ["product/market-loop", "2. Quote and accept"],
  ["product/market-loop", "3. Settle on-chain"],
  ["platform/business-model", "transaction-linked protocol fee"],
  ["platform/market-engine", "reusable market engine"],
  ["progress/proof", "PRE-LAUNCH"],
  ["progress/roadmap", "Milestones, not calendar promises"],
];

for (const [route, phrase] of narrativeContract) {
  if (!rawPages.get(route).includes(phrase)) {
    fail(`${route}.mdx is missing required narrative beat: ${phrase}`);
  }
}

const marketLoop = rawPages.get("product/market-loop");
const stepPositions = [
  "1. Collateralize",
  "2. Quote and accept",
  "3. Settle on-chain",
].map((step) => marketLoop.indexOf(step));
if (!(stepPositions[0] < stepPositions[1] && stepPositions[1] < stepPositions[2])) {
  fail("market-loop steps must remain in collateralize, quote and accept, settle on-chain order");
}

const forbidden = [
  ["code fence", /```/],
  ["hexadecimal address", /\b0x[a-f\d]{8,}\b/i],
  ["CLI command", /^\s*(pnpm|npm|yarn|mint|git|forge|curl)\b/im],
  ["API path", /\/api(?:\/|\b)/i],
  ["ABI or EIP reference", /\b(?:ABI|EIP-?\d+)\b/i],
  ["unsupported traction metric", /\b\d+(?:\.\d+)?\s*(?:users|customers|partners|volume|revenue|arr|tam|sam|som|million|billion)\b/i],
  ["unsupported relationship claim", /\b(?:partnered with|customers include|strategic partner)\b/i],
  ["unsupported fundraising claim", /\b(?:raised|raising)\s+(?:\$|usd|usdt|\d)/i],
  ["production availability claim", /\b(?:live in production|production-ready|production is live|mainnet live)\b/i],
];

for (const [route, body] of rawPages) {
  for (const [label, pattern] of forbidden) {
    if (pattern.test(body)) fail(`${route}.mdx contains ${label}`);
  }
}

const brief = rawPages.get("investors/brief");
const briefBody = brief
  .replace(/^---[\s\S]*?---\s*/, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
  .replace(/[#*_`>|-]/g, " ");
const briefWords = briefBody.match(/[\p{L}\p{N}][\p{L}\p{N}’']*/gu) ?? [];
if (briefWords.length < 450 || briefWords.length > 650) {
  fail(`investor brief must contain 450–650 prose words; found ${briefWords.length}`);
}

for (const heading of [
  "## The thesis",
  "## The wedge",
  "## The mechanism",
  "## The business model",
  "## Proof and status",
  "## The next milestone",
  "Before external circulation",
]) {
  if (!brief.includes(heading)) fail(`investor brief is missing: ${heading}`);
}

for (const factCategory of [
  "founder and team track record",
  "measured user and maker traction",
  "named customers or partners",
  "market-sizing method and sources",
  "fundraising amount and terms",
  "use of funds",
  "ownership and cap-table facts",
  "approved financial projections",
]) {
  if (!brief.includes(factCategory)) {
    fail(`investor brief verification checklist is missing: ${factCategory}`);
  }
}

const proof = rawPages.get("progress/proof");
const disclosures = [...proof.matchAll(/<Warning>([\s\S]*?)<\/Warning>/g)];
if (disclosures.length !== 1) fail("current-status page must contain one Warning disclosure");

const disclosure = disclosures[0][1];
for (const phrase of [
  "PRE-LAUNCH",
  "isolated, capped staging",
  "BTC",
  "Gold",
  "S&P 500",
  "NVIDIA",
  "staging-manifest markets",
  "Production deposits and unrestricted production trading remain gated",
  "Stale RWA sources fail closed",
]) {
  if (!disclosure.includes(phrase)) fail(`current-status disclosure is missing: ${phrase}`);
}

console.log(
  `content audit passed: ${routes.length} pages, ${briefWords.length} brief words, ${reviewedDigest.slice(0, 12)} reviewed digest`,
);
