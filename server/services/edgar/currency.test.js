// Form 4 price currency — real footnote wordings seen in SEC filings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { currencyOf } from "./currency.js";
import { annotatePriceChecks } from "./priceAnomalies.js";

const fn = (text) => ({ footnotes: [{ id: "F1", text }] });

test("USD by default; converted foreign prices are USD; unconverted foreign prices are unverified", () => {
  assert.deepEqual(currencyOf({}), { code: "USD", basis: "form4" });
  for (const text of [
    "For purposes of this Form 4, a conversion rate of BRL 5.0380 for each USD 1.00 was used.",
    "The reported shares were purchased for Australian dollars at a price of AUD 3.79 per share. The purchase price is reported in U.S. dollars and reflects the conversion from AUD to USD at an exchange rate of 0.7034 USD per 1.00 AUD.",
    "This transaction was conducted in Canadian Dollars. The per share sale price of $0.09 Canadian Dollars was converted into U.S. Dollars at the conversion rate of CAD$1.00 to USD$0.7031.",
    "The price reported in column 4 is a convenience conversion of the 53.95 BRL per share into U.S. dollars based on the Central Bank of Brazil exchange rate.",
    "The underlying transaction was denominated in South African rand (\"ZAR\"). For the purposes of this table, the price reported in United States dollars has been converted from ZAR.",
  ]) assert.equal(currencyOf(fn(text)).basis, "converted_to_usd", text.slice(0, 50));
  const u = currencyOf(fn("EXERCISE PRICE REPRESENTS A PER ORDINARY SHARE SALE PRICE OF MXN$68.1875"));
  assert.deepEqual([u.code, u.basis], [null, "unverified"]);
  assert.equal(currencyOf(fn("Held by Apax X EUR LP and Apax X USD LP (collectively, the Apax X Fund).")).basis, "form4", "a currency inside a fund name is not a price statement");
});

test("unverified currency excludes the value everywhere (price-check anomaly), keeps the row", () => {
  const [row] = annotatePriceChecks([{ id: "r1", price: 3.65, shares: 100, value: 365, issuerCik: "1", securityTitle: "Ordinary", transactionDate: "2026-10-20", ...fn("SALE PRICE OF MXN$68.1875 per ordinary share") }]);
  assert.equal(row.priceCheck.status, "anomaly");
  assert.equal(row.priceCheck.reasons[0].rule, "currency_unverified");
  assert.deepEqual(row.currency, { code: null, basis: "unverified" });
  const [ok] = annotatePriceChecks([{ id: "r2", price: 10, shares: 100, value: 1000, issuerCik: "1", securityTitle: "Common", transactionDate: "2026-10-20" }]);
  assert.deepEqual([ok.priceCheck.status, ok.currency.code], ["ok", "USD"]);
});
