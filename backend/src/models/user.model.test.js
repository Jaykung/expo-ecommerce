import assert from "node:assert/strict";
import test from "node:test";

import { User } from "./user.model.js";

test("new users default to having no Stripe customer ID", async () => {
  const user = new User({
    clerkId: "clerk_unit_test",
    email: "shopper@example.com",
    name: "Test Shopper",
  });

  assert.equal(user.stripeCustomerId, "");
  await assert.doesNotReject(user.validate());
});
