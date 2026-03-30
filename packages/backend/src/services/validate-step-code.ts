import * as acorn from "acorn";

export type ValidationResult =
  | { valid: true }
  | { valid: false; message: string; line?: number; column?: number };

/**
 * Validate that a step code snippet is syntactically valid JavaScript.
 *
 * Action code is wrapped as an async IIFE body; condition code is wrapped
 * as the test expression of an if-statement inside an async IIFE.
 * Line/column in the error are adjusted back to the user's original code.
 */
export function validateStepCode(
  code: string,
  nodeType: "action" | "condition",
): ValidationResult {
  const trimmed = code.trim();
  if (trimmed.length === 0) {
    return { valid: false, message: "Code must not be empty" };
  }

  let wrapper: string;
  let prefixLines: number;
  let prefixCols: number;

  if (nodeType === "condition") {
    wrapper = `(async () => { if (\n${trimmed}\n) {} })()`;
    prefixLines = 1;
    prefixCols = 0;
  } else {
    wrapper = `(async () => {\n${trimmed}\n})()`;
    prefixLines = 1;
    prefixCols = 0;
  }

  try {
    acorn.parse(wrapper, {
      ecmaVersion: 2022,
      sourceType: "module",
    });
    return { valid: true };
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      const acornErr = err as SyntaxError & { loc?: { line: number; column: number } };
      const rawMsg = acornErr.message.replace(/\s*\(\d+:\d+\)$/, "");

      let line: number | undefined;
      let column: number | undefined;

      if (acornErr.loc) {
        const adjustedLine = acornErr.loc.line - prefixLines;
        if (adjustedLine >= 1) {
          line = adjustedLine;
          column = acornErr.loc.column;
          if (adjustedLine === 1 && nodeType === "condition") {
            column = Math.max(0, acornErr.loc.column - prefixCols);
          }
        }
      }

      return { valid: false, message: rawMsg, line, column };
    }
    return { valid: false, message: "Unknown validation error" };
  }
}
