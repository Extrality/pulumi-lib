import { promises as fs } from "node:fs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const GITHUB_TOKEN = (() => {
  if (process.env.GITHUB_TOKEN !== undefined) {
    return process.env.GITHUB_TOKEN;
  }
  try {
    const cmd = spawnSync("gh", ["auth", "token"]);
    return cmd.stdout.toString().trim();
  } catch (e) {
    console.warn(`Could not get a github auth token: ${e}`);
  }
  return undefined;
})();

export class CachedRemoteFile {
  constructor(
    private readonly uniqueRef: string,
    private readonly url: string,
    public readonly name: string,
  ) {}

  async path() {
    const cachedPath = `.cache/${this.name}-${this.uniqueRef}`;
    const isAccessible = !(await fs.access(cachedPath).catch((_) => true));
    if (isAccessible) {
      return cachedPath;
    }
    const contents = await (await fetch(this.url)).text();
    await fs.mkdir(".cache", { recursive: true });
    await fs.writeFile(cachedPath, contents);
    return cachedPath;
  }

  async fetch() {
    const path = await this.path();
    return await fs.readFile(path, { encoding: "utf-8" });
  }
}

interface GithubRepoTreeResponse {
  sha: string;
  url: string;
  tree: Array<{
    path: string;
    mode: string;
    type: string;
    sha: string;
    size?: number;
    url: string;
  }>;
  truncated: boolean;
}

/**
 * @param gitRef a git reference: <https://git-scm.com/book/en/v2/Git-Internals-Git-References> eg heads/main
 *
 * Uses the github API, which is rate-limited !
 */
export async function githubRepoTree(
  repo: string,
  ref: string,
): Promise<GithubRepoTreeResponse> {
  let headers: any;
  if (GITHUB_TOKEN) {
    headers = { authorization: `Bearer ${GITHUB_TOKEN}` };
  }
  const listFilesUrl = `https://api.github.com/repos/${repo}/git/trees/${ref}?recursive=1`;
  const resp = await fetch(listFilesUrl, { headers });
  const respBody = await resp.text();
  assert(resp.ok, `Request to github failed: ${respBody}`);
  return JSON.parse(respBody);
}

/**
 * @param gitRef a git reference: <https://git-scm.com/book/en/v2/Git-Internals-Git-References> eg heads/main
 *
 * Uses the github API, which is rate-limited !
 */
export async function getFilesFromGithubFolder(
  repo: string,
  subdir: string,
  gitRef: string,
): Promise<Array<CachedRemoteFile>> {
  let headers: any;
  if (GITHUB_TOKEN) {
    headers = { authorization: `Bearer ${GITHUB_TOKEN}` };
  }
  const listFilesUrl = `https://api.github.com/repos/${repo}/contents/${subdir}?ref=${gitRef}`;
  const resp = await fetch(listFilesUrl, { headers });
  const respText = await resp.text();
  assert(resp.ok, `Request to github failed: ${respText}`);
  const dir = <any[]>JSON.parse(respText);
  if (!Array.isArray(dir) || dir.length <= 1) {
    throw new Error(
      `Retrived a single file, use 'getFileFromGithub' instead: ${repo} ${subdir}`,
    );
  }
  const files = dir.map(
    (file) => new CachedRemoteFile(file.sha, file.download_url, file.name),
  );
  return files;
}

interface GetFileFromGithubArgs {
  repo: string;
  path: string;
  ref: {
    tag?: string;
    // branch?: string; // cache key issue
    commit?: string;
  };
}

export function getFileFromGithub(args: GetFileFromGithubArgs) {
  const fileSafeRepo = args.repo.replaceAll(/[^a-zA-Z0-9]/g, "-");
  const baseUrl = `https://raw.githubusercontent.com/${args.repo}`;
  let url: any;
  let uniqueRef: any;
  if (args.ref.tag) {
    url = `${baseUrl}/refs/tags/${args.ref.tag}/${args.path}`;
    const safeTag = args.ref.tag.replaceAll(/[^a-zA-Z0-9]/g, "-");
    uniqueRef = `tag-${fileSafeRepo}-${safeTag}`;
  } else if (args.ref.commit) {
    url = `${baseUrl}/${args.ref.commit}/${args.path}`;
    uniqueRef = `${fileSafeRepo}-${args.ref.commit}`;
  } else {
    throw new Error("No ref provided");
  }
  const name = args.path.split("/").pop() ?? "unknown";

  return new CachedRemoteFile(uniqueRef, url, name);
}
