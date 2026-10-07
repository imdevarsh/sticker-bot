import { db } from "./client";
import { sql } from "./index";
import { securityDDL } from "./security-ddl";

for (const statement of securityDDL) await db.execute(sql.raw(statement));
console.log("Security schema upgrade completed.");
