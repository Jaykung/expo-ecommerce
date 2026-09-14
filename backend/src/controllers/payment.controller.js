import Stripe from "stripe";
import mongoose from "mongoose";
import { ENV } from "../config/env.js";
import { Product } from "../models/product.model.js";
import { User } from "../models/user.model.js";
import { Order } from "../models/order.model.js";

const stripe = new Stripe(ENV.STRIPE_SECRET_KEY);

export async function createPaymentIntent(req, res) {
  try {
    const { cartItems, shippingAddress } = req.body;
    const user = req.user;

    // Validate cart items
    if (!cartItems || cartItems.length === 0) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    // Calculate total from server-side
    let subtotal = 0;
    const validatedItems = [];

    for (const item of cartItems) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        return res.status(400).json({ error: "Invalid item quantity" });
      }

      const product = await Product.findById(item.product._id);
      if (!product) {
        return res.status(404).json({ error: `Product ${item.product.name} not found` });
      }

      if (product.stock < item.quantity) {
        return res.status(400).json({ error: `Insufficient stock for ${product.name}` });
      }

      subtotal += product.price * item.quantity;
      validatedItems.push({
        product: product._id.toString(),
        name: product.name,
        price: product.price,
        quantity: item.quantity,
        image: product.images[0],
      });
    }

    const shipping = 10.0;
    const tax = subtotal * 0.08;
    const total = subtotal + shipping + tax;

    if (total < 0) {
      return res.status(400).json({ error: "Invalid order total" });
    }

    // find or create the Stripe customer
    let customer;
    if (user.stripeCustomerId) {
      // find the customer
      customer = await stripe.customers.retrieve(user.stripeCustomerId);
    } else {
      // create the customer
      customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: {
          clerkId: user.clerkId,
          userId: user._id.toString(),
        },
      });

      // add the stripe customer ID to the  user object in the DB
      await User.findByIdAndUpdate(user._id, { stripeCustomerId: customer.id });
    }

    // create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(total * 100),  // convert to cents
      currency: "usd",
      customer: customer.id,
      automatic_payment_methods: {
        enabled: true,
      },

      // use for webhook
      metadata: {
        clerkId: user.clerkId,
        userId: user._id.toString(),
        orderItems: JSON.stringify(validatedItems),
        shippingAddress: JSON.stringify(shippingAddress),
        totalPrice: total.toFixed(2),
      },
    });

    res.status(200).json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    console.error("Error creating payment intent:", error);
    res.status(500).json({ error: "Failed to create payment intent" });
  }
}

export async function handleWebhook(req, res) {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, ENV.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error("Webhook signature verification failed:", error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  if (event.type === "payment_intent.succeeded") {
    const paymentIntent = event.data.object;

    console.log("Payment succeeded:", paymentIntent.id);

    const session = await mongoose.startSession();

    try {
      const { userId, clerkId, orderItems, shippingAddress, totalPrice } = paymentIntent.metadata;
      const items = JSON.parse(orderItems);
      let order;
      let orderAlreadyExists = false;

      await session.withTransaction(async () => {
        const existingOrder = await Order.findOne({ "paymentResult.id": paymentIntent.id }).session(session);
        if (existingOrder) {
          orderAlreadyExists = true;
          return;
        }

        for (const item of items) {
          const updatedProduct = await Product.findOneAndUpdate(
            { _id: item.product, stock: { $gte: item.quantity } },
            { $inc: { stock: -item.quantity } },
            { new: true, session }
          );

          if (!updatedProduct) {
            throw new Error(`Product ${item.product} not found or has insufficient stock`);
          }
        }

        [order] = await Order.create([{
          user: userId,
          clerkId,
          orderItems: items,
          shippingAddress: JSON.parse(shippingAddress),
          paymentResult: {
            id: paymentIntent.id,
            status: "succeeded",
          },
          totalPrice: parseFloat(totalPrice),
        }], { session });
      });

      if (orderAlreadyExists) {
        console.log("Order already exists for payment:", paymentIntent.id);
        return res.json({ received: true });
      }

      console.log("Order created successfully:", order._id);
    } catch (error) {
      console.error("Error creating order from webhook:", error);
      return res.status(500).json({ error: "Order fulfillment failed" });  
    } finally {
      await session.endSession();
    }
  }

  res.json({ received: true });
}