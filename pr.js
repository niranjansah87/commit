import dotenv from "dotenv";
dotenv.config();



import jsonfile from "jsonfile";
import moment from "moment";
import simpleGit from "simple-git";
import random from "random";
import { Octokit } from "@octokit/rest";
import path from "path";
import fs from "fs";

const DATA_PATH = "./data.json";
const BASE_BRANCH = process.env.BASE_BRANCH || "main";
const git = simpleGit();
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

/** Parse owner/repo from git remote "origin" */
async function getRepoInfo() {
  const remotes = await git.getRemotes(true);
  const origin = remotes.find(r => r.name === "origin");
  if (!origin) throw new Error('No "origin" remote found');
  const url = origin.refs.push || origin.refs.fetch;

  console.log("Repository URL:", url); // Add this line for debugging

  // Extract owner/repo from URL
  let m =
    url.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/) ||
    url.match(/github\.com\/(.+?)\/(.+?)(?:\.git)?$/);
  if (!m) throw new Error(`Cannot parse GitHub owner/repo from ${url}`);
  const [, owner, repo] = m;

  console.log("Owner:", owner); // Debugging
  console.log("Repo:", repo); // Debugging
  return { owner, repo };
}


/** Ensure repo is clean and on latest base */
async function prepareBase() {
  await git.fetch();
  await git.checkout(BASE_BRANCH);
  await git.pull("origin", BASE_BRANCH);
}

/** Write something to data.json so each commit changes content */
function writeCommitPayload(dateISO, seq) {
  const payload = {
    date: dateISO,
    sequence: seq,
    note: "Automated commit for per-PR workflow"
  };
  jsonfile.writeFileSync(DATA_PATH, payload, { spaces: 2 });
}

/** Create a single-commit branch and open a PR */
async function commitAndPR({ dateISO, titleSuffix, body }) {
  const { owner, repo } = await getRepoInfo();

  // Unique branch per commit
  const ts = moment(dateISO).utc().format("YYYYMMDD-HHmmss");
  const branch = `commit-${ts}-${Math.floor(Math.random() * 1e6)}`;

  // Make sure base is current, branch off it
  await prepareBase();
  await git.checkoutBranch(branch, BASE_BRANCH);

  // Write file change
  writeCommitPayload(dateISO, titleSuffix);

  // Stage & commit with author/committer dates aligned
  const prevCommitterDate = process.env.GIT_COMMITTER_DATE;
  process.env.GIT_COMMITTER_DATE = dateISO; // align committer date with author date

  await git.add([DATA_PATH]);
  await git.commit(`chore: commit on ${dateISO}`, undefined, { "--date": dateISO });

  // restore env
  if (prevCommitterDate === undefined) {
    delete process.env.GIT_COMMITTER_DATE;
  } else {
    process.env.GIT_COMMITTER_DATE = prevCommitterDate;
  }

  // Push branch
  await git.push("origin", branch);

  // Create PR
  const prTitle = `chore: PR for commit ${titleSuffix}`;
  const pr = await octokit.pulls.create({
    owner,
    repo,
    title: prTitle,
    head: branch,
    base: BASE_BRANCH,
    body: body || `Automated PR for commit at ${dateISO}.`
  });

  return { branch, prNumber: pr.data.number, prUrl: pr.data.html_url };
}

/** Merge all created PRs */
async function mergePRs(prs) {
  const { owner, repo } = await getRepoInfo();
  for (let pr of prs) {
    console.log(`Merging PR #${pr.prNumber}...`);
    await octokit.pulls.merge({
      owner,
      repo,
      pull_number: pr.prNumber,
      merge_method: "merge", // you can change to 'squash' or 'rebase' if needed
    });
    console.log(`PR #${pr.prNumber} merged successfully.`);
  }
}

/** Generate one commit+PR at a randomized time within a given day */
async function oneCommitPRForDay(dayMoment, seq) {
  // Random hour/min/sec in the day
  const hour = random.int(0, 23);
  const minute = random.int(0, 59);
  const second = random.int(0, 59);

  const dateISO = moment(dayMoment).hour(hour).minute(minute).second(second).toISOString();

  return await commitAndPR({
    dateISO,
    titleSuffix: `${moment(dateISO).format("YYYY-MM-DD HH:mm:ss")}`,
    body: `This PR corresponds to a single automated commit on ${dateISO}.`
  });
}

/** Create N commits and N PRs across a date range (inclusive) */
async function run() {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is not set. Provide a token with 'repo' permissions.");
  }

  // Configure your range here
  const startDate = moment("2023-01-01");
  const endDate   = moment("2025-04-24");

  const days = endDate.diff(startDate, "days") + 1;

  const results = [];

  for (let d = 0; d < days; d++) {
    const day = moment(startDate).add(d, "days");
    // Random commits per day between 5 and 10 (each -> its own PR)
    const numCommits = random.int(5, 10);

    for (let i = 1; i <= numCommits; i++) {
      // Each loop: new branch, one commit, one PR
      const res = await oneCommitPRForDay(day, i);
      results.push(res);
      // Optional: small delay to avoid API abuse / race
      await new Promise(r => setTimeout(r, random.int(200, 800)));
    }
  }

  // After all PRs are created, merge them
  console.log("Done! Created PRs, now merging them...");
  await mergePRs(results);

  // Summary
  console.log("All PRs have been merged.");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
