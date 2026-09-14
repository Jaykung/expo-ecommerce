import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { after, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { transformSync } from "@babel/core";
import transformReactJsx from "@babel/plugin-transform-react-jsx";
import transformTypeScript from "@babel/plugin-transform-typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const mockModuleSources = {
  "@/components/AddressSelectionModal": `
    import React from "react";
    export default function AddressSelectionModal() {
      return React.createElement("div", { "data-address-modal": true });
    }
  `,
  "@/components/OrderSummary": `
    import React from "react";
    export default function OrderSummary(props) {
      globalThis.__mobileRenderMocks.orderSummaryProps.push(props);
      return React.createElement("section", { "data-order-summary": true });
    }
  `,
  "@/components/SafeScreen": `
    import React from "react";
    export default function SafeScreen({ children }) {
      return React.createElement("main", null, children);
    }
  `,
  "@/hooks/useAddressess": `
    export function useAddresses() {
      return globalThis.__mobileRenderMocks.addressState;
    }
  `,
  "@/hooks/useCart": `
    export default function useCart() {
      return globalThis.__mobileRenderMocks.cartState;
    }
  `,
  "@/lib/api": `
    export function useApi() {
      return globalThis.__mobileRenderMocks.api;
    }
  `,
  "@expo/vector-icons": `
    import React from "react";
    export const Ionicons = ({ name }) => React.createElement("i", { "data-icon": name });
  `,
  "@sentry/react-native": `
    export const logger = { info() {}, error() {} };
  `,
  "@stripe/stripe-react-native": `
    export function useStripe() {
      return globalThis.__mobileRenderMocks.stripe;
    }
  `,
  "expo-image": `
    import React from "react";
    export const Image = ({ source }) => React.createElement("img", { src: source });
  `,
  "react-native": `
    import React from "react";
    const element = (tag) => ({
      children,
      activeOpacity,
      animationType,
      contentContainerStyle,
      numberOfLines,
      onPress,
      onRequestClose,
      showsVerticalScrollIndicator,
      transparent,
      visible,
      ...props
    }) =>
      React.createElement(tag, props, children);
    export const ActivityIndicator = () => React.createElement("span", { "data-loading": true });
    export const Alert = { alert() {} };
    export const Modal = element("dialog");
    export const ScrollView = element("div");
    export const Text = element("span");
    export const TouchableOpacity = element("button");
    export const View = element("div");
  `,
};

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const source = mockModuleSources[specifier];
    if (source) {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(source)}`,
      };
    }
    if (context.parentURL?.startsWith("data:")) {
      return nextResolve(specifier, { ...context, parentURL: import.meta.url });
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === "file:" && parsedUrl.pathname.endsWith(".tsx")) {
      const filename = fileURLToPath(url);
      const result = transformSync(readFileSync(filename, "utf8"), {
        babelrc: false,
        configFile: false,
        filename,
        plugins: [
          [transformTypeScript, { allExtensions: true, isTSX: true }],
          [transformReactJsx, { runtime: "automatic" }],
        ],
      });

      return { format: "module", shortCircuit: true, source: result.code };
    }
    return nextLoad(url, context);
  },
});

const OrderSummary = (await import("./OrderSummary.tsx?unit-test")).default;
const AddressSelectionModal = (await import("./AddressSelectionModal.tsx?unit-test")).default;
const CartScreen = (await import("../app/(tabs)/cart.tsx?unit-test")).default;

function resetRenderMocks() {
  globalThis.__mobileRenderMocks = {
    addressState: { addresses: [], isLoading: false },
    api: { post: async () => ({ data: { clientSecret: "secret" } }) },
    cartState: {
      cart: undefined,
      cartItemCount: 0,
      cartTotal: 0,
      clearCart() {},
      isError: false,
      isLoading: false,
      isRemoving: false,
      isUpdating: false,
      removeFromCart() {},
      updateQuantity() {},
    },
    orderSummaryProps: [],
    stripe: {
      initPaymentSheet: async () => ({}),
      presentPaymentSheet: async () => ({}),
    },
  };
}

beforeEach(resetRenderMocks);

after(() => {
  delete globalThis.__mobileRenderMocks;
  hooks.deregister();
});

describe("OrderSummary", () => {
  test("formats every monetary value to two decimal places", () => {
    const markup = renderToStaticMarkup(React.createElement(OrderSummary, {
      subtotal: 12.345,
      shipping: 10,
      tax: 1.987,
      total: 24.332,
    }));

    assert.match(markup, /\$12\.35/);
    assert.match(markup, /\$10\.00/);
    assert.match(markup, /\$1\.99/);
    assert.match(markup, /\$24\.33/);
  });
});

describe("AddressSelectionModal", () => {
  test("shows a loading state while saved addresses are being fetched", () => {
    globalThis.__mobileRenderMocks.addressState = { addresses: [], isLoading: true };

    const markup = renderToStaticMarkup(React.createElement(AddressSelectionModal, {
      visible: true,
      onClose() {},
      onProceed() {},
      isProcessing: false,
    }));

    assert.match(markup, /data-loading="true"/);
    assert.match(markup, /<button[^>]*disabled=""[^>]*>.*Continue to Payment/s);
  });

  test("renders saved address details and disables proceeding until one is selected", () => {
    globalThis.__mobileRenderMocks.addressState = {
      isLoading: false,
      addresses: [{
        _id: "address_1",
        label: "Home",
        fullName: "Test Shopper",
        streetAddress: "1 Main St",
        city: "Austin",
        state: "TX",
        zipCode: "78701",
        phoneNumber: "555-0100",
        isDefault: true,
      }],
    };

    const markup = renderToStaticMarkup(React.createElement(AddressSelectionModal, {
      visible: true,
      onClose() {},
      onProceed() {},
      isProcessing: false,
    }));

    assert.match(markup, /Home/);
    assert.match(markup, /Default/);
    assert.match(markup, /Test Shopper/);
    assert.match(markup, /1 Main St/);
    assert.match(markup, /Austin, TX 78701/);
    assert.match(markup, /555-0100/);
    assert.match(markup, /<button[^>]*disabled=""[^>]*>.*Continue to Payment/s);
  });
});

describe("CartScreen", () => {
  test("renders distinct loading, error, and empty states", async (t) => {
    const cases = [
      [{ isLoading: true }, "Loading cart..."],
      [{ isError: true }, "Failed to load cart"],
      [{ cart: { items: [] } }, "Your cart is empty"],
    ];

    for (const [cartState, expectedText] of cases) {
      await t.test(expectedText, () => {
        resetRenderMocks();
        Object.assign(globalThis.__mobileRenderMocks.cartState, cartState);

        const markup = renderToStaticMarkup(React.createElement(CartScreen));

        assert.match(markup, new RegExp(expectedText.replaceAll(".", "\\.")));
      });
    }
  });

  test("renders authoritative line totals and passes calculated checkout totals to the summary", () => {
    globalThis.__mobileRenderMocks.cartState = {
      ...globalThis.__mobileRenderMocks.cartState,
      cart: {
        items: [{
          _id: "cart_item_1",
          product: {
            _id: "product_1",
            images: ["one.jpg"],
            name: "Product one",
            price: 19.99,
          },
          quantity: 2,
        }],
      },
      cartItemCount: 2,
      cartTotal: 39.98,
    };

    const markup = renderToStaticMarkup(React.createElement(CartScreen));

    assert.match(markup, /Product one/);
    assert.match(markup, /\$39\.98/);
    assert.match(markup, /\$19\.99 each/);
    assert.match(markup, />2 items</);
    assert.match(markup, /\$53\.18/);
    assert.equal(globalThis.__mobileRenderMocks.orderSummaryProps.length, 1);
    const { subtotal, shipping, tax, total } = globalThis.__mobileRenderMocks.orderSummaryProps[0];
    assert.equal(subtotal, 39.98);
    assert.equal(shipping, 10);
    assert.equal(tax, 3.1984);
    assert.ok(Math.abs(total - 53.1784) < Number.EPSILON * 53.1784);
  });
});
