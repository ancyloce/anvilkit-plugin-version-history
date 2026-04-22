import { describe, expect, it } from "vitest";

import { runAdapterContract } from "../testing/run-adapter-contract.js";

import { inMemoryAdapter } from "./in-memory.js";

runAdapterContract(() => inMemoryAdapter(), { describe, expect, it });
