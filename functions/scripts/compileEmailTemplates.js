#!/usr/bin/env node
/**
 * Compiles src/emailTemplates/*.mjml to .html next to the sources.
 *
 * The functions used to compile the MJML at cold start, which meant shipping
 * mjml (and its ~130 MB of transitive requires) to production and paying for
 * the compile on every new instance. The HTML is now build output: this script
 * runs from `yarn build` (before copy-files puts the .html in lib/) and from
 * jest's globalSetup, and src/registrationUtils/emailTemplates.ts reads the
 * result on first use. Mustache placeholders survive the compile untouched.
 *
 * `minify: true` matches what the runtime used to pass; mjml-core prints a
 * deprecation notice for it (the option moved to the CLI) but still honours it.
 */
const fs = require("fs");
const path = require("path");

const TEMPLATE_DIR = path.resolve(__dirname, "..", "src", "emailTemplates");

/**
 * @returns {string[]} the .html files written
 */
function compileEmailTemplates() {
  // Required lazily so merely loading this module (jest globalSetup) is cheap.
  const mjml2html = require("mjml");
  const written = [];
  for (const file of fs.readdirSync(TEMPLATE_DIR)) {
    if (!file.endsWith(".mjml")) continue;
    const source = path.join(TEMPLATE_DIR, file);
    const {html, errors} = mjml2html(fs.readFileSync(source, "utf8"), {
      minify: true,
      filePath: source,
    });
    if (errors.length > 0) {
      const details = errors.map((e) => `  ${e.formattedMessage ?? e.message}`).join("\n");
      throw new Error(`MJML errors in ${file}:\n${details}`);
    }
    const target = source.replace(/\.mjml$/, ".html");
    fs.writeFileSync(target, html);
    written.push(target);
  }
  return written;
}

module.exports = {compileEmailTemplates, TEMPLATE_DIR};

if (require.main === module) {
  const written = compileEmailTemplates();
  for (const file of written) console.log(`compiled ${path.relative(process.cwd(), file)}`);
}
