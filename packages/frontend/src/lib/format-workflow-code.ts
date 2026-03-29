import * as babelPlugin from "prettier/plugins/babel";
import * as estreePlugin from "prettier/plugins/estree";
import * as prettier from "prettier/standalone";

const plugins = [babelPlugin, estreePlugin];

/**
 * Pretty-print LLM-generated workflow JS (often a single JSON-escaped line) for display.
 */
export async function formatWorkflowCode(source: string): Promise<string> {
  const trimmed = source.trim();
  if (!trimmed) return "";
  try {
    return (
      await prettier.format(trimmed, {
        parser: "babel",
        plugins,
      })
    ).trimEnd();
  } catch {
    return source;
  }
}
