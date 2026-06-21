// Currency formatting — pure. Shared by the client and tests.
// Matches the original `fmt` in app.js: en-US grouping, always 2 decimals.
export function fmt(n: number | string): string {
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}
