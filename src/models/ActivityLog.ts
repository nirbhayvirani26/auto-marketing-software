import { model, ObjectId, Schema, type BaseFields } from "@/lib/localdb";

/** One line in the audit trail. Everything the app does ends up here. */
export type ActivityLogDoc = BaseFields & {
  level: "info" | "success" | "warning" | "error";
  /** e.g. "post.published", "ai.generate", "automation.run", "n8n.webhook" */
  action: string;
  message: string;
  meta?: unknown;
  post?: ObjectId;
  automation?: ObjectId;
  actor: string;
};

const ActivityLogSchema = new Schema(
  {
    level: {
      type: String,
      enum: ["info", "success", "warning", "error"],
      default: "info",
      index: true,
    },
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

export const ActivityLog = model<ActivityLogDoc>("ActivityLog", ActivityLogSchema);

export async function logActivity(entry: {
  level?: "info" | "success" | "warning" | "error";
  action: string;
  message: string;
  meta?: unknown;
  post?: ObjectId | string;
  automation?: ObjectId | string;
  actor?: string;
}) {
  try {
    await ActivityLog.create(entry as Partial<ActivityLogDoc>);
  } catch {
    // Logging must never fail the request that triggered it.
  }
}
