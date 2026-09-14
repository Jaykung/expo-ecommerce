import assert from "node:assert/strict";
import test from "node:test";

test("ENV exposes all Stripe configuration values", async () => {
  const originalValues = {
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  };

  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_config";
  process.env.STRIPE_SECRET_KEY = "sk_test_config";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_config";

  try {
    const { ENV } = await import(`./env.js?test=${Date.now()}`);

    assert.equal(ENV.STRIPE_PUBLISHABLE_KEY, "pk_test_config");
    assert.equal(ENV.STRIPE_SECRET_KEY, "sk_test_config");
    assert.equal(ENV.STRIPE_WEBHOOK_SECRET, "whsec_test_config");
  } finally {
    for (const [name, value] of Object.entries(originalValues)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
