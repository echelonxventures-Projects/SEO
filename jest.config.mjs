// Single source of truth for unit-test config (also used by `npm run test:unit`),
// so a bare `npx jest` behaves the same as the npm script.
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("./__tests__/jest.config.json", import.meta.url), "utf8"));
// the JSON's rootDir ("..") is relative to __tests__/; from here the root is this directory
export default { ...config, rootDir: "." };
