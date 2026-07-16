import { AxiError } from "axi-sdk-js";

import type { ParsedFlags } from "./types.ts";

interface FlagOptions {
  boolean?: string[];
  array?: string[];
}

export function parseFlags(args: string[], options: FlagOptions = {}): ParsedFlags {
  const parsed: ParsedFlags = { positionals: [] };
  const booleanFlags = new Set(options.boolean ?? []);
  const arrayFlags = new Set(options.array ?? []);

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") {
      parsed.positionals.push(...args.slice(index + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      parsed.positionals.push(arg);
      continue;
    }

    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    if (!name) throw usage("empty flag name");

    let value;
    if (booleanFlags.has(name)) {
      value = equals === -1 ? true : parseBoolean(arg.slice(equals + 1), name);
    } else if (equals !== -1) {
      value = arg.slice(equals + 1);
    } else {
      value = args[++index];
      if (value === undefined) throw usage(`--${name} requires a value`);
    }

    const previous = parsed[name];
    parsed[name] = arrayFlags.has(name)
      ? [...(Array.isArray(previous) ? previous : []), String(value)]
      : value;
  }
  return parsed;
}

export function usage(message: string, suggestions = ["Run `sentry-axi --help`"]) {
  return new AxiError(message, "VALIDATION_ERROR", suggestions);
}

function parseBoolean(value: string, flagName: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw usage(`--${flagName} must be true or false`);
}
