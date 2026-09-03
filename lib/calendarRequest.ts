import type { LookupFunction } from "node:net";

export const CALENDAR_REQUEST_HEADERS = {
  accept: "text/calendar,text/plain;q=0.9,*/*;q=0.1",
  "accept-encoding": "identity",
  "accept-language": "en-US,en;q=0.9",
  "user-agent": "Mozilla/5.0 (compatible; UniversalDashboard/1.0; +https://github.com/ishan5820/Universal_db)",
} as const;

export function createPinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}
