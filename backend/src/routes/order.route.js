import { Router } from "express";
import { createOrder, getUserOrders } from "../controllers/order.controller.js";
import { protectRoute } from "../middleware/auth.middleware.js";

const router = Router();

router.post("/", protectRoute, createOrder);
router.get("/", protectRoute, getUserOrders);

export default router;