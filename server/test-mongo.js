import "dotenv/config";
import mongoose from "mongoose";

async function run() {
  try {
    console.log("MONGO_URL exists:", !!process.env.MONGO_URL);

    await mongoose.connect(process.env.MONGO_URL, {
      serverSelectionTimeoutMS: 10000,
    });

    console.log("✅ CONNECTED OK");
    process.exit(0);
  } catch (err) {
    console.error("❌ FAILED:");
    console.error(err);
    process.exit(1);
  }
}

run();