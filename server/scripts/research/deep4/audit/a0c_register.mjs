// deep4/audit/a0c_register.mjs — registers the diagnostic of the post-unlock design-panel rebuild (item 5) before computing it.
import { phaseA, register } from "./common.mjs";
phaseA();
const n = register({ id: "audit4.ctl.preUnlock.design", family: "audit4.diag.rebuild (item 5: lead's post-unlock rebuild of the design panel)", familySize: 1, preRegistered: false, posthoc: true, segment: "design",
  statement: "Design primary purchases minus controls rebuilt with the PRE-unlock exclusion (only filings accepted < 2026-06-15 visible) > 0; compared with the post-unlock controls the agents used.",
  rationale: "The lead's rebuild let the design control-pool exclusion see confirmation-period filings (34,785 -> 34,602 control rows).", test: "V.matchedDiff issuer bootstrap B=1000" });
console.log("registered", n);
