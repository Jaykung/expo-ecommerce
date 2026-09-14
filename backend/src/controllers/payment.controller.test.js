import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, beforeEach, describe, test } from "node:test";

const originalConsoleError = console.error;
const originalConsoleLog = console.log;

const moduleSources = {
  stripe: `
    export default class Stripe {
      constructor(secretKey) {
        globalThis.__paymentControllerMocks.stripeSecretKey = secretKey;
        this.customers = {
          retrieve: (...args) => globalThis.__paymentControllerMocks.retrieveCustomer(...args),
          create: (...args) => globalThis.__paymentControllerMocks.createCustomer(...args),
        };
        this.paymentIntents = {
          create: (...args) => globalThis.__paymentControllerMocks.createPaymentIntent(...args),
        };
        this.webhooks = {
          constructEvent: (...args) => globalThis.__paymentControllerMocks.constructEvent(...args),
        };
      }
    }
  `,
  "../config/env.js": `
    export const ENV = {
      STRIPE_SECRET_KEY: "sk_test_unit",
      STRIPE_WEBHOOK_SECRET: "whsec_test_unit",
    };
  `,
  "../models/product.model.js": `
    export const Product = {
      findById: (...args) => globalThis.__paymentControllerMocks.findProduct(...args),
      findByIdAndUpdate: (...args) => globalThis.__paymentControllerMocks.updateProduct(...args),
    };
  `,
  "../models/user.model.js": `
    export const User = {
      findByIdAndUpdate: (...args) => globalThis.__paymentControllerMocks.updateUser(...args),
    };
  `,
  "../models/order.model.js": `
    export const Order = {
      findOne: (...args) => globalThis.__paymentControllerMocks.findOrder(...args),
      create: (...args) => globalThis.__paymentControllerMocks.createOrder(...args),
    };
  `,
};

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const source = moduleSources[specifier];
    if (source) {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(source)}`,
      };
    }
    return nextResolve(specifier, context);
  },
});

const calls = {};

function resetMocks() {
  Object.assign(calls, {
    createCustomer: [],
    createOrder: [],
    createPaymentIntent: [],
    findOrder: [],
    findProduct: [],
    retrieveCustomer: [],
    updateProduct: [],
    updateUser: [],
  });

  globalThis.__paymentControllerMocks = {
    constructEvent: () => ({ type: "unhandled.event", data: { object: {} } }),
    createCustomer: async (...args) => {
      calls.createCustomer.push(args);
      return { id: "cus_created" };
    },
    createOrder: async (...args) => {
      calls.createOrder.push(args);
      return { _id: "order_1" };
    },
    createPaymentIntent: async (...args) => {
      calls.createPaymentIntent.push(args);
      return { client_secret: "pi_secret" };
    },
    findOrder: async (...args) => {
      calls.findOrder.push(args);
      return null;
    },
    findProduct: async (...args) => {
      calls.findProduct.push(args);
      return null;
    },
    retrieveCustomer: async (...args) => {
      calls.retrieveCustomer.push(args);
      return { id: args[0] };
    },
    updateProduct: async (...args) => {
      calls.updateProduct.push(args);
    },
    updateUser: async (...args) => {
      calls.updateUser.push(args);
    },
  };
}

function createResponse() {
  return {
    body: undefined,
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

function createUser(overrides = {}) {
  return {
    _id: { toString: () => "user_1" },
    clerkId: "clerk_1",
    email: "shopper@example.com",
    name: "Test Shopper",
    stripeCustomerId: "",
    ...overrides,
  };
}

resetMocks();
const { createPaymentIntent, handleWebhook } = await import("./payment.controller.js?unit-test");

beforeEach(() => {
  resetMocks();
  console.error = () => {};
  console.log = () => {};
});

after(() => {
  console.error = originalConsoleError;
  console.log = originalConsoleLog;
  delete globalThis.__paymentControllerMocks;
  hooks.deregister();
});

describe("createPaymentIntent", () => {
  test("rejects both missing and empty carts without contacting Stripe", async (t) => {
    for (const cartItems of [undefined, []]) {
      await t.test(cartItems ? "empty cart" : "missing cart", async () => {
        const res = createResponse();

        await createPaymentIntent({ body: { cartItems }, user: createUser() }, res);

        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { error: "Cart is empty" });
        assert.equal(calls.findProduct.length, 0);
        assert.equal(calls.createPaymentIntent.length, 0);
      });
    }
  });

  test("returns 404 when a cart product no longer exists", async () => {
    const res = createResponse();
    const cartItems = [{ product: { _id: "missing", name: "Retired item" }, quantity: 1 }];

    await createPaymentIntent({ body: { cartItems }, user: createUser() }, res);

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: "Product Retired item not found" });
    assert.deepEqual(calls.findProduct, [["missing"]]);
    assert.equal(calls.createPaymentIntent.length, 0);
  });

  test("rejects a quantity greater than current stock", async () => {
    globalThis.__paymentControllerMocks.findProduct = async () => ({
      _id: { toString: () => "product_1" },
      images: ["image.jpg"],
      name: "Limited item",
      price: 25,
      stock: 2,
    });
    const res = createResponse();
    const cartItems = [{ product: { _id: "product_1", name: "Stale client name" }, quantity: 3 }];

    await createPaymentIntent({ body: { cartItems }, user: createUser() }, res);

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: "Insufficient stock for Limited item" });
    assert.equal(calls.createPaymentIntent.length, 0);
  });

  test("rejects an order when its calculated total is negative", async () => {
    globalThis.__paymentControllerMocks.findProduct = async () => ({
      _id: { toString: () => "product_1" },
      images: ["image.jpg"],
      name: "Product",
      price: 100,
      stock: 5,
    });
    const res = createResponse();
    const cartItems = [{ product: { _id: "product_1" }, quantity: -1 }];

    await createPaymentIntent({ body: { cartItems }, user: createUser() }, res);

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: "Invalid order total" });
    assert.equal(calls.createPaymentIntent.length, 0);
  });

  test("uses server-side product data and an existing Stripe customer", async () => {
    const products = {
      product_1: {
        _id: { toString: () => "product_1" },
        images: ["one.jpg", "ignored.jpg"],
        name: "Authoritative one",
        price: 19.99,
        stock: 5,
      },
      product_2: {
        _id: { toString: () => "product_2" },
        images: ["two.jpg"],
        name: "Authoritative two",
        price: 3.5,
        stock: 10,
      },
    };
    globalThis.__paymentControllerMocks.findProduct = async (id) => {
      calls.findProduct.push([id]);
      return products[id];
    };
    const user = createUser({ stripeCustomerId: "cus_existing" });
    const shippingAddress = { city: "Austin", zipCode: "78701" };
    const cartItems = [
      { product: { _id: "product_1", name: "Client one", price: 0.01 }, quantity: 2 },
      { product: { _id: "product_2", name: "Client two", price: 999 }, quantity: 3 },
    ];
    const res = createResponse();

    await createPaymentIntent({ body: { cartItems, shippingAddress }, user }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { clientSecret: "pi_secret" });
    assert.deepEqual(calls.retrieveCustomer, [["cus_existing"]]);
    assert.equal(calls.createCustomer.length, 0);
    assert.equal(calls.updateUser.length, 0);
    assert.equal(calls.createPaymentIntent.length, 1);

    const intent = calls.createPaymentIntent[0][0];
    assert.equal(intent.amount, 6452);
    assert.equal(intent.currency, "usd");
    assert.equal(intent.customer, "cus_existing");
    assert.deepEqual(intent.automatic_payment_methods, { enabled: true });
    assert.equal(intent.metadata.clerkId, "clerk_1");
    assert.equal(intent.metadata.userId, "user_1");
    assert.equal(intent.metadata.totalPrice, "64.52");
    assert.deepEqual(JSON.parse(intent.metadata.shippingAddress), shippingAddress);
    assert.deepEqual(JSON.parse(intent.metadata.orderItems), [
      {
        product: "product_1",
        name: "Authoritative one",
        price: 19.99,
        quantity: 2,
        image: "one.jpg",
      },
      {
        product: "product_2",
        name: "Authoritative two",
        price: 3.5,
        quantity: 3,
        image: "two.jpg",
      },
    ]);
  });

  test("creates and persists a Stripe customer for a first-time buyer", async () => {
    globalThis.__paymentControllerMocks.findProduct = async () => ({
      _id: { toString: () => "product_1" },
      images: ["image.jpg"],
      name: "Product",
      price: 10,
      stock: 5,
    });
    const user = createUser();
    const res = createResponse();

    await createPaymentIntent({
      body: {
        cartItems: [{ product: { _id: "product_1" }, quantity: 1 }],
        shippingAddress: { city: "Seattle" },
      },
      user,
    }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls.createCustomer, [[{
      email: "shopper@example.com",
      name: "Test Shopper",
      metadata: { clerkId: "clerk_1", userId: "user_1" },
    }]]);
    assert.deepEqual(calls.updateUser, [[user._id, { stripeCustomerId: "cus_created" }]]);
    assert.equal(calls.createPaymentIntent[0][0].customer, "cus_created");
  });

  test("returns a stable 500 response when a dependency fails", async () => {
    globalThis.__paymentControllerMocks.findProduct = async () => {
      throw new Error("database unavailable");
    };
    const res = createResponse();

    await createPaymentIntent({
      body: { cartItems: [{ product: { _id: "product_1" }, quantity: 1 }] },
      user: createUser(),
    }, res);

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { error: "Failed to create payment intent" });
    assert.equal(calls.createPaymentIntent.length, 0);
  });
});

describe("handleWebhook", () => {
  test("rejects an invalid signature before performing any database work", async () => {
    globalThis.__paymentControllerMocks.constructEvent = () => {
      throw new Error("No signatures found");
    };
    const rawBody = Buffer.from("raw webhook body");
    const res = createResponse();

    await handleWebhook({
      body: rawBody,
      headers: { "stripe-signature": "bad_signature" },
    }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body, "Webhook Error: No signatures found");
    assert.equal(calls.findOrder.length, 0);
    assert.equal(calls.createOrder.length, 0);
    assert.equal(calls.updateProduct.length, 0);
  });

  test("acknowledges unrelated Stripe events without creating an order", async () => {
    const receivedArguments = [];
    globalThis.__paymentControllerMocks.constructEvent = (...args) => {
      receivedArguments.push(args);
      return { type: "payment_intent.payment_failed", data: { object: {} } };
    };
    const rawBody = Buffer.from("raw webhook body");
    const res = createResponse();

    await handleWebhook({
      body: rawBody,
      headers: { "stripe-signature": "valid_signature" },
    }, res);

    assert.deepEqual(receivedArguments, [[rawBody, "valid_signature", "whsec_test_unit"]]);
    assert.deepEqual(res.body, { received: true });
    assert.equal(calls.findOrder.length, 0);
    assert.equal(calls.createOrder.length, 0);
  });

  test("treats repeated successful-payment webhooks as idempotent", async () => {
    globalThis.__paymentControllerMocks.constructEvent = () => ({
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_duplicate", metadata: {} } },
    });
    globalThis.__paymentControllerMocks.findOrder = async (...args) => {
      calls.findOrder.push(args);
      return { _id: "existing_order" };
    };
    const res = createResponse();

    await handleWebhook({ body: Buffer.from("event"), headers: {} }, res);

    assert.deepEqual(calls.findOrder, [[{ "paymentResult.id": "pi_duplicate" }]]);
    assert.equal(calls.createOrder.length, 0);
    assert.equal(calls.updateProduct.length, 0);
    assert.deepEqual(res.body, { received: true });
  });

  test("creates an order and decrements every purchased product after payment succeeds", async () => {
    const orderItems = [
      { product: "product_1", name: "One", price: 12.5, quantity: 2, image: "one.jpg" },
      { product: "product_2", name: "Two", price: 5, quantity: 1, image: "two.jpg" },
    ];
    const shippingAddress = {
      fullName: "Test Shopper",
      streetAddress: "1 Main St",
      city: "Austin",
      state: "TX",
      zipCode: "78701",
      phoneNumber: "555-0100",
    };
    globalThis.__paymentControllerMocks.constructEvent = () => ({
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_success",
          metadata: {
            userId: "user_1",
            clerkId: "clerk_1",
            orderItems: JSON.stringify(orderItems),
            shippingAddress: JSON.stringify(shippingAddress),
            totalPrice: "47.80",
          },
        },
      },
    });
    const res = createResponse();

    await handleWebhook({ body: Buffer.from("event"), headers: {} }, res);

    assert.deepEqual(calls.createOrder, [[{
      user: "user_1",
      clerkId: "clerk_1",
      orderItems,
      shippingAddress,
      paymentResult: { id: "pi_success", status: "succeeded" },
      totalPrice: 47.8,
    }]]);
    assert.deepEqual(calls.updateProduct, [
      ["product_1", { $inc: { stock: -2 } }],
      ["product_2", { $inc: { stock: -1 } }],
    ]);
    assert.deepEqual(res.body, { received: true });
  });

  test("acknowledges the webhook when malformed metadata prevents order creation", async () => {
    globalThis.__paymentControllerMocks.constructEvent = () => ({
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_bad_metadata",
          metadata: { orderItems: "not-json", shippingAddress: "{}" },
        },
      },
    });
    const res = createResponse();

    await handleWebhook({ body: Buffer.from("event"), headers: {} }, res);

    assert.equal(calls.createOrder.length, 0);
    assert.equal(calls.updateProduct.length, 0);
    assert.deepEqual(res.body, { received: true });
  });
});
