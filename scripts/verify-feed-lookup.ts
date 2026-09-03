import assert from "node:assert/strict";
import { CALENDAR_REQUEST_HEADERS, createPinnedLookup } from "../lib/calendarRequest";

const lookup = createPinnedLookup("203.0.113.10", 4);

async function main() {
  assert.match(CALENDAR_REQUEST_HEADERS["user-agent"], /^Mozilla\/5\.0 .*UniversalDashboard/);
  assert.equal(CALENDAR_REQUEST_HEADERS["accept-encoding"], "identity");

  await new Promise<void>((resolve, reject) => {
    lookup("calendar.example", { all: true }, (error, addresses, family) => {
      if (error) return reject(error);
      assert.deepEqual(addresses, [{ address: "203.0.113.10", family: 4 }]);
      assert.equal(family, undefined);
      resolve();
    });
  });

  await new Promise<void>((resolve, reject) => {
    lookup("calendar.example", { all: false }, (error, address, family) => {
      if (error) return reject(error);
      assert.equal(address, "203.0.113.10");
      assert.equal(family, 4);
      resolve();
    });
  });

  console.log("PASS pinned calendar DNS lookup supports single- and multi-address Node modes.");
}

void main();
