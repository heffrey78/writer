import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { GITHUB_CLIENT_ID, GitHub, GitHubError, memoryStore, type TokenStore } from "./github.ts";
import type { Host } from "./ports.ts";

/**
 * The server's host on Node (D16): the CLI, the desktop app's server, the web dev server and the tests.
 * Its folders, its environment and its paths, and what only Node can reach: the OS keychain and the gh
 * CLI. The engine is given these (useNodePorts); it never imports this.
 */

/** The per-user platform config directory for Writer, or $WRITER_CONFIG_DIR. */
export function defaultConfigDir(): string {
  const env = process.env;
  if (env.WRITER_CONFIG_DIR) return resolve(env.WRITER_CONFIG_DIR);
  return platformConfigDir("writer");
}

/**
 * gh-writer's config directory, whose library.json lists the books to offer to import (#2):
 * $WRITER_GH_WRITER_CONFIG_DIR, else gh-writer's own. None when Writer's config is elsewhere
 * ($WRITER_CONFIG_DIR, as tests and experiments set it): that's a world of its own.
 */
export function ghWriterConfigDir(): string | undefined {
  const env = process.env;
  if (env.WRITER_GH_WRITER_CONFIG_DIR) return resolve(env.WRITER_GH_WRITER_CONFIG_DIR);
  if (env.WRITER_CONFIG_DIR) return undefined;
  return platformConfigDir("gh-writer");
}

function platformConfigDir(app: string): string {
  const env = process.env;
  if (process.platform === "win32") return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), app);
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", app);
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), app);
}

/**
 * A path as a person types it: a leading ~ is their home folder, as in a shell. Without this,
 * "~/writer/novel" would be a folder named "~" wherever Writer happened to start.
 */
export function expandHome(path: string): string {
  const p = path.trim();
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(homedir(), p.slice(2));
  return p;
}

/** A path as the author would type it: their home folder as ~. */
function tilde(path: string): string {
  const home = homedir();
  return path === home ? "~" : path.startsWith(home + sep) ? `~/${path.slice(home.length + 1).split(sep).join("/")}` : path;
}

/**
 * The templates in this checkout of Writer (or beside the server bundle: WRITER_TEMPLATES), a folder
 * each by the kind's key: templates/novel, the same files a "Use this template" repository gets, and
 * templates/journal.
 */
export function templatesDir(): string {
  return process.env.WRITER_TEMPLATES || fileURLToPath(new URL("../../../templates", import.meta.url));
}

export const nodeHost: Host = {
  env: () => process.env,
  configDir: defaultConfigDir,
  booksDir: () => join(homedir(), "writer"),
  ghWriterConfigDir,
  templates: templatesDir,
  absolute: (path) => resolve(expandHome(path)),
  shown: tilde,
};

const SERVICE = "writer";
const ACCOUNT = "github";

/** The OS keychain (macOS Keychain, Windows Credential Manager, the Secret Service on Linux). Never a plain-text file. */
export function keychainStore(): TokenStore {
  const entry = async () => {
    try {
      const { AsyncEntry } = await import("@napi-rs/keyring");
      return new AsyncEntry(SERVICE, ACCOUNT);
    } catch {
      throw noKeychain();
    }
  };
  const call = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch {
      throw noKeychain();
    }
  };
  return {
    get: async () => {
      const e = await entry();
      return (await call(() => e.getPassword())) ?? undefined;
    },
    set: async (token) => {
      const e = await entry();
      await call(() => e.setPassword(token));
    },
    delete: async () => {
      const e = await entry();
      await call(() => e.deletePassword());
    },
  };
}

const noKeychain = () =>
  new GitHubError(
    "NO_KEYCHAIN",
    "Writer keeps your GitHub sign-in in the system keychain, and couldn't reach it. On Linux, install and unlock a Secret Service keyring (GNOME Keyring or KWallet), then try again.",
  );

/** The token of the gh CLI's signed-in account, if there is one. */
export function ghToken(): Promise<string | undefined> {
  return new Promise((done) => {
    execFile("gh", ["auth", "token", "--hostname", "github.com"], { timeout: 10_000, env: { ...process.env, GH_PROMPT_DISABLED: "1" } }, (error, stdout) =>
      done(error ? undefined : stdout.trim() || undefined),
    );
  });
}

/** The GitHub connection from the environment: WRITER_GITHUB_CLIENT_ID, WRITER_GITHUB_URL, WRITER_GITHUB_API_URL, WRITER_TOKEN_STORE=memory; the token in the keychain, or the gh CLI's. */
export function githubFromEnv(env: NodeJS.ProcessEnv = process.env): GitHub {
  return new GitHub({
    clientId: env.WRITER_GITHUB_CLIENT_ID || GITHUB_CLIENT_ID,
    ...(env.WRITER_GITHUB_URL ? { webUrl: env.WRITER_GITHUB_URL } : {}),
    ...(env.WRITER_GITHUB_API_URL ? { apiUrl: env.WRITER_GITHUB_API_URL } : {}),
    store: env.WRITER_TOKEN_STORE === "memory" ? memoryStore() : keychainStore(),
    gh: ghToken,
  });
}
