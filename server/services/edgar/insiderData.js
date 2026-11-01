// server/services/edgar/insiderData.js
// Single source for economic transactions: price-checked, then de-duplicated.
// Used by the dashboard API and the alert engine so both see the same data.
import { getTransactions } from "./insiderIngest.js";
import { annotatePriceChecks } from "./priceAnomalies.js";
import { groupTransactions } from "./transactionGroups.js";

export function getCheckedRows() {
  return annotatePriceChecks(getTransactions());
}

export function getEconomicTransactions() {
  return groupTransactions(getCheckedRows());
}
