import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { assertSafeTestDatabaseEnvironment } from "@/server/db/test-database-safety";

assertSafeTestDatabaseEnvironment(process.env);

afterEach(cleanup);
