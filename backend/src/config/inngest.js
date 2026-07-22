import { Inngest } from "inngest";
import { User } from "../models/user.model.js";
import { connectDB } from "./db.js";

export const inngest = new Inngest({ id: "ecommerce-app" });

const syncUser = inngest.createFunction(
  { id: "sync-user", triggers: [{ event: "clerk/user.created" }] },
  async ({ event, step }) => {
    await connectDB();
    const { id, email_addresses, first_name, last_name, image_url } = event.data;

    const newUser = {
      clerkId: id,
      email: email_addresses[0].email_address,
      name: `${first_name || ""} ${last_name || ""}` || "User",
      imageUrl: image_url,
      addresses: [],
      wishlist: [],
    };

    await step.run("create-database-user", async () => {
      return await User.create(newUser);
    });
  }
);

const deleteUserFromDB = inngest.createFunction(
  { id: "delete-user-from-db", triggers: [{ event: "clerk/user.deleted" }] },
  async ({ event, step }) => {
    await connectDB();
    const { id } = event.data;

    await step.run("delete-database-user", async () => {
      return await User.deleteOne({ clerkId: id });
    });
  }
);

export const functions = [syncUser, deleteUserFromDB];