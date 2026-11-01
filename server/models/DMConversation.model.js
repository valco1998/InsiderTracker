import mongoose from "mongoose";

const schema = new mongoose.Schema({
  /** Sorted "smallerUserId_largerUserId" — guarantees one doc per pair */
  pairKey:       { type: String, required: true, unique: true },
  participants:  [{ type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }],
  lastMessage:   { type: String,  default: "" },
  lastMessageAt: { type: Date,    default: null },
  lastSenderId:  { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

  /** userId (string) → unread message count */
  unread: { type: mongoose.Schema.Types.Mixed, default: {} },

  /**
   * Users who have hidden/deleted this conversation from their sidebar.
   * A new incoming message removes the sender from hiddenFor (restores visibility).
   */
  hiddenFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

  /**
   * userId (string) → ISO timestamp when they last cleared their message view.
   * getDMHistory only returns messages created AFTER this date for that user.
   */
  clearedAt: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

schema.index({ participants: 1 });

export default mongoose.model("DMConversation", schema);
