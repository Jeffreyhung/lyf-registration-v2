// The email senders read compiled HTML templates (build output, gitignored).
// Compile them before the test run so the suite does not depend on `yarn build`
// having been run first.
const {compileEmailTemplates} = require("../../scripts/compileEmailTemplates");

module.exports = async () => {
  compileEmailTemplates();
};
