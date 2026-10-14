import express from "express";
import {
  getStaff,
  createStaff,
  updateStaff,
  deleteStaff
} from "../controllers/staff.controller.js";

const router = express.Router();

router.get("/", getStaff);
router.post("/", createStaff);
router.patch("/:id", updateStaff);
router.delete("/:id", deleteStaff);

export default router;
