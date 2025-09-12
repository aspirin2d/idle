import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

const client = new PGlite(process.env.PG_DATA ?? "./pg_data");
export default drizzle({ client });
