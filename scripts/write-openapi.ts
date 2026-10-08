import { writeFileSync } from "node:fs";
import { openapi } from "../src/server/openapi";

writeFileSync("docs/openapi.json", JSON.stringify(openapi, null, 2) + "\n");
console.log("wrote docs/openapi.json");
