import assert from "node:assert/strict";
import test from "node:test";

test("email module can be imported without optional Resend credentials", async () => {
  const originalApiKey = process.env.RESEND_API_KEY;

  try {
    delete process.env.RESEND_API_KEY;

    const emailModule = await import("../lib/email");

    assert.equal(typeof emailModule.sendEmail, "function");
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = originalApiKey;
    }
  }
});
