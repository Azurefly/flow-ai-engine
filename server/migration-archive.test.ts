import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const attributes = readFileSync(new URL("../.gitattributes", import.meta.url), "utf8");
const canonicalSql = "CREATE TABLE example (id int PRIMARY KEY);\n--> statement-breakpoint\nCREATE INDEX example_id ON example(id);\n";

describe("migration SQL archive reproducibility", () => {
  it.each([
    ["true", "LF"], ["true", "CRLF"], ["false", "LF"], ["false", "CRLF"],
  ] as const)("preserves canonical migration bytes with autocrlf=%s and %s input", (autocrlf, inputEol) => {
    const temporaryRoot = realpathSync(tmpdir());
    const directory = mkdtempSync(path.join(temporaryRoot, "flow-migration-archive-"));
    const git = (...args: string[]) => execFileSync("git", [
      "-c", `core.autocrlf=${autocrlf}`, "-c", "commit.gpgsign=false",
      "-c", "user.name=Flow archive regression", "-c", "user.email=archive-test@example.invalid",
      "-C", directory, ...args,
    ], { stdio: ["pipe", "pipe", "pipe"] });
    try {
      git("init", "--quiet");
      writeFileSync(path.join(directory, ".gitattributes"), attributes, "utf8");
      mkdirSync(path.join(directory, "drizzle"));
      writeFileSync(path.join(directory, "drizzle", "0000_fixture.sql"), inputEol === "CRLF" ? canonicalSql.replace(/\n/g, "\r\n") : canonicalSql, "utf8");
      git("add", ".gitattributes", "drizzle/0000_fixture.sql");
      git("commit", "--quiet", "-m", "Archive fixture");

      // Exercise the real release boundary; do not infer archive bytes from the worktree.
      const archive = git("archive", "--format=tar", "HEAD", "drizzle/0000_fixture.sql");
      const sql = execFileSync("tar", ["-xOf", "-", "drizzle/0000_fixture.sql"], {
        input: archive, stdio: ["pipe", "pipe", "pipe"],
      });
      expect(sql.equals(Buffer.from(canonicalSql, "utf8"))).toBe(true);
    } finally {
      const resolved = realpathSync(directory);
      if (path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith("flow-migration-archive-")) {
        throw new Error("Unexpected temporary repository path; refusing cleanup");
      }
      rmSync(resolved, { recursive: true, force: true });
    }
  });
});
