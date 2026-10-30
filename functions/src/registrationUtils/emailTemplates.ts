import {readFileSync} from "fs";
import {resolve} from "path";

/** The MJML sources in src/emailTemplates, by file name without extension. */
export type EmailTemplateName =
  | "registrationTemplate"
  | "waitlistTemplate"
  | "offWaitlistTemplate";

const cache = new Map<EmailTemplateName, string>();

/**
 * Returns the compiled HTML (with Mustache placeholders) for an email
 * template, reading it from disk on first use and caching it for the life of
 * the instance.
 *
 * The HTML is produced from the .mjml source by scripts/compileEmailTemplates.js
 * (`yarn build:templates`, run by `yarn build` and by jest's globalSetup), so
 * mjml is a build-time dependency only and nothing is compiled at cold start.
 * Loading lazily also keeps importing the senders side-effect free.
 */
export function loadEmailTemplate(name: EmailTemplateName): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  const file = resolve(__dirname, "..", "emailTemplates", `${name}.html`);
  let html: string;
  try {
    html = readFileSync(file, "utf8");
  } catch (e) {
    throw new Error(
      `Compiled email template ${file} is missing (run \`yarn build:templates\`)`,
      {cause: e}
    );
  }
  cache.set(name, html);
  return html;
}
