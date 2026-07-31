import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const ActivityLogSchema = new Schema(
  {
    level: {
      type: String,
      enum: ["info", "success", "warning", "error"],
      default: "info",
      index: true,
    },
    // e.g. "post.published", "ai.generate", "automation.run", "n8n.webhook"
    action: { type: String, required: true, index: true },
    message: { type: String, required: true },
    meta: { type: Schema.Types.Mixed },
    post: { type: Schema.Types.ObjectId, ref: "Post" },
    automation: { type: Schema.Types.ObjectId, ref: "Automation" },
    actor: { type: String, default: "system" },
  },
  { timestamps: true },
);

ActivityLogSchema.index({ createdAt: -1 });

export type ActivityLogDoc = InferSchemaType<typeof ActivityLogSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const ActivityLog: Model<ActivityLogDoc> =
  (mongoose.models.ActivityLog as Model<ActivityLogDoc>) ||
  mongoose.model<ActivityLogDoc>("ActivityLog", ActivityLogSchema);

export async function logActivity(entry: {
  level?: "info" | "success" | "warning" | "error";
  action: string;
  message: string;
  meta?: unknown;
  post?: mongoose.Types.ObjectId | string;
  automation?: mongoose.Types.ObjectId | string;
  actor?: string;
}) {
  try {
    await ActivityLog.create(entry);
  } catch {
    // Logging kadi request ne fail na kare.
  }
}
