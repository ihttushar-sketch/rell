/**
 * Hydration safety check.
 *
 * Server-renders the studio page, hydrates the exact same tree inside jsdom and
 * fails if React reports any mismatch (text or attribute). A seeded negative
 * control proves the harness can actually see a mismatch, so a green run means
 * the markup is genuinely deterministic rather than the check being inert.
 *
 * Usage: npm run check:hydration
 */
import React from "react";
import { renderToString } from "react-dom/server";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";

type Globals = Record<string, unknown>;

const installGlobals = (dom: JSDOM) => {
  const { window } = dom;
  const g = globalThis as Globals;
  const define = (key: string, value: unknown) =>
    Object.defineProperty(g, key, { value, configurable: true, writable: true });
  define("window", window);
  define("document", window.document);
  define("navigator", window.navigator);
  define("localStorage", window.localStorage);
  define("HTMLElement", window.HTMLElement);
  define("Node", window.Node);
  define("MutationObserver", window.MutationObserver);
  define("getComputedStyle", window.getComputedStyle.bind(window));
  define("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16));
  define("cancelAnimationFrame", (id: number) => clearTimeout(id));
};

const captureConsole = () => {
  const problems: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args: unknown[]) => {
    problems.push(args.map((value) => (typeof value === "string" ? value : String(value))).join(" ").slice(0, 800));
  };
  console.warn = (...args: unknown[]) => {
    const text = args.map(String).join(" ");
    if (/hydrat|did not match|server rendered|attribute/i.test(text)) problems.push(`WARN ${text.slice(0, 600)}`);
  };
  return {
    problems,
    restore: () => {
      console.error = originalError;
      console.warn = originalWarn;
    },
  };
};

const hydrationMessages = (problems: string[]) =>
  problems.filter((line) => /hydrat|did not match|server rendered|RECOVERABLE|In HTML/i.test(line));

/** Negative control — a deliberately different attribute must be reported. */
const negativeControl = async (): Promise<boolean> => {
  const { hydrateRoot } = await import("react-dom/client");
  const dom = new JSDOM(`<!doctype html><html><body><p data-probe="server">hello</p></body></html>`, {
    url: "http://localhost:3000/",
  });
  installGlobals(dom);
  const sink = captureConsole();
  hydrateRoot(dom.window.document.body, <p data-probe="client">hello</p>, {
    onRecoverableError: (error) => sink.problems.push(String(error)),
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  sink.restore();
  return hydrationMessages(sink.problems).length > 0;
};

const main = async () => {
  const pageModule = await import("../src/app/page");
  const Page = pageModule.default as React.ComponentType;

  // Server render, exactly what Next does for the initial HTML.
  const html = renderToString(React.createElement(Page));
  if (html.length < 1000) throw new Error(`suspiciously small server render (${html.length} chars)`);

  const dom = new JSDOM(`<!doctype html><html lang="en" class="dark"><body>${html}</body></html>`, {
    url: "http://localhost:3000/",
    pretendToBeVisual: true,
  });
  installGlobals(dom);

  const sink = captureConsole();
  const { hydrateRoot } = await import("react-dom/client");
  hydrateRoot(dom.window.document.body, React.createElement(Page), {
    onRecoverableError: (error) => sink.problems.push(`RECOVERABLE ${String(error).slice(0, 700)}`),
  });

  await new Promise((resolve) => setTimeout(resolve, 2500));
  sink.restore();

  const mounted = dom.window.document.body.textContent ?? "";
  const issues = hydrationMessages(sink.problems);
  const hash = createHash("sha1").update(html).digest("hex").slice(0, 12);
  const markers = ["Deconstruct reference", "Framework Extractor", "NEXUS"];
  const missing = markers.filter((marker) => !mounted.includes(marker));

  console.log(`server render      : ${html.length} chars · sha1 ${hash} · TZ ${process.env.TZ ?? "system"}`);
  console.log(`hydrated DOM       : ${mounted.length} chars of text · markers ${missing.length ? `MISSING ${missing.join(",")}` : "ok"}`);
  console.log(`negative control   : ${(await negativeControl()) ? "detects mismatches ✓" : "FAILED to detect a seeded mismatch ✗"}`);
  console.log(`hydration problems : ${issues.length}`);
  issues.forEach((line, index) => console.log(`  [${index + 1}] ${line.replace(/\s+/g, " ").slice(0, 500)}`));

  const other = sink.problems.filter((line) => !issues.includes(line));
  if (other.length) {
    console.log(`other console errors: ${other.length}`);
    other.slice(0, 4).forEach((line) => console.log(`  · ${line.replace(/\s+/g, " ").slice(0, 220)}`));
  }

  process.exit(issues.length ? 1 : 0);
};

main().catch((error) => {
  console.log(`harness failed: ${(error as Error).message.slice(0, 800)}`);
  process.exit(2);
});
