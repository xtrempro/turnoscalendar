process.env.TURNOPLUS_RULES_VARIANT = "test-mfa";

await import("./security-rules.test.mjs");
