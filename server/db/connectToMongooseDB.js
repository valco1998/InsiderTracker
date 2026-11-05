import "../config/legacyServerGuard.js"; // must stay the FIRST import: refuses InsiderTracker databases (legacy SkinTel code)
import mongoose from "mongoose";

export default async function connectToMongoDB() {
    const uri = (process.env.MONGO_URI || process.env.MONGO_URL || "").trim();
    if (!uri) throw new Error("MONGO_URI missing in .env");

    mongoose.set("strictQuery", true);

    try {
        await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 15000,
        });
    } catch (err) {
        console.error("❌ MongoDB connection failed:", err.message);
        console.error(err.stack);
        throw err;
    }

    return mongoose.connection;
}
