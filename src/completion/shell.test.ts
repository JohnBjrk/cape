import { describe, it, expect } from "bun:test";
import {
  generateCompletionScript,
  completionInstallPath,
  postInstallMessage,
  detectShell,
  type Shell,
} from "./shell.ts";

const shells: Shell[] = ["bash", "zsh", "fish"];

describe("generateCompletionScript", () => {
  for (const shell of shells) {
    it(`${shell}: contains the CLI name`, () => {
      const script = generateCompletionScript("mycli", shell);
      expect(script).toContain("mycli");
    });

    it(`${shell}: invokes the __complete subcommand`, () => {
      const script = generateCompletionScript("mycli", shell);
      expect(script).toContain("__complete");
    });

    it(`${shell}: passes cword to the binary`, () => {
      const script = generateCompletionScript("mycli", shell);
      expect(script).toContain("cword");
    });
  }

  it("bash: registers with the 'complete' builtin", () => {
    const script = generateCompletionScript("mycli", "bash");
    expect(script).toContain("complete -");
    expect(script).toContain("mycli");
  });

  it("zsh: uses compdef", () => {
    const script = generateCompletionScript("mycli", "zsh");
    expect(script).toContain("compdef");
    expect(script).toContain("mycli");
  });

  it("fish: uses complete -c", () => {
    const script = generateCompletionScript("mycli", "fish");
    expect(script).toContain("complete -c mycli");
  });

  it("sanitizes hyphens in CLI names to underscores for function names", () => {
    const bash = generateCompletionScript("my-cli", "bash");
    // function name should use underscore, not hyphen
    expect(bash).toContain("_my_cli_completions");
    expect(bash).not.toContain("_my-cli_completions");

    const zsh = generateCompletionScript("my-cli", "zsh");
    expect(zsh).toContain("_my_cli_completions");

    const fish = generateCompletionScript("my-cli", "fish");
    expect(fish).toContain("__my_cli_complete");
  });

  it("CLI name still appears literally for the actual binary invocation", () => {
    // The actual binary name (with hyphens) must be used when calling the binary
    const bash = generateCompletionScript("my-cli", "bash");
    expect(bash).toContain("my-cli __complete");

    const zsh = generateCompletionScript("my-cli", "zsh");
    expect(zsh).toContain("my-cli __complete");

    const fish = generateCompletionScript("my-cli", "fish");
    expect(fish).toContain("my-cli __complete");
  });
});

describe("completionInstallPath", () => {
  it("bash: path ends with the CLI name (no underscore prefix)", () => {
    const path = completionInstallPath("mycli", "bash");
    expect(path.endsWith("/mycli")).toBe(true);
    expect(path).toContain("bash-completion");
  });

  it("zsh: path ends with _<name>", () => {
    const path = completionInstallPath("mycli", "zsh");
    expect(path.endsWith("/_mycli")).toBe(true);
    expect(path).toContain("completions");
  });

  it("fish: path ends with <name>.fish", () => {
    const path = completionInstallPath("mycli", "fish");
    expect(path.endsWith("/mycli.fish")).toBe(true);
    expect(path).toContain("fish");
  });
});

describe("postInstallMessage", () => {
  it("bash: mentions ~/.bashrc", () => {
    const msg = postInstallMessage("mycli", "bash", "/some/path");
    expect(msg).toContain(".bashrc");
  });

  it("zsh: mentions fpath and compinit", () => {
    const msg = postInstallMessage("mycli", "zsh", "/some/path");
    expect(msg).toContain("fpath");
    expect(msg).toContain("compinit");
  });

  it("fish: mentions that fish loads completions automatically", () => {
    const msg = postInstallMessage("mycli", "fish", "/some/path");
    expect(msg.toLowerCase()).toContain("fish");
    // fish is automatic — should NOT tell user to manually source anything
    expect(msg).not.toContain(".fishrc");
  });

  it("includes the installed path in all shells", () => {
    for (const shell of shells) {
      const msg = postInstallMessage("mycli", shell, "/my/install/path");
      expect(msg).toContain("/my/install/path");
    }
  });
});

describe("detectShell", () => {
  it("returns zsh for /bin/zsh", () => {
    process.env["SHELL"] = "/bin/zsh";
    expect(detectShell()).toBe("zsh");
  });

  it("returns bash for /usr/local/bin/bash", () => {
    process.env["SHELL"] = "/usr/local/bin/bash";
    expect(detectShell()).toBe("bash");
  });

  it("returns fish for /usr/bin/fish", () => {
    process.env["SHELL"] = "/usr/bin/fish";
    expect(detectShell()).toBe("fish");
  });

  it("returns undefined for unknown shells", () => {
    process.env["SHELL"] = "/usr/bin/tcsh";
    expect(detectShell()).toBeUndefined();
  });

  it("returns undefined when SHELL is not set", () => {
    delete process.env["SHELL"];
    expect(detectShell()).toBeUndefined();
  });
});
