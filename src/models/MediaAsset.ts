import {
  model,
  ObjectId,
  Schema,
  type BaseFields,
  type HydratedDocument,
} from "@/lib/localdb";

/**
 * One media file: an uploaded product photo, an AI-generated image, a rendered
 * reel, or a music track.
 *
 * Instagram needs a public https URL, so every asset carries two locations:
 *   localPath — on disk, for the render pipeline
 *   publicUrl — reachable from the internet (CDN / tunnel / /api/media)
 */
export type MediaAssetDoc = BaseFields & {
  brand?: ObjectId;
  kind: "image" | "video" | "audio" | "other";
  role:
    | "product"
    | "avatar"
    | "generated"
    | "keyframe"
    | "clip"
    | "reel"
    | "thumbnail"
    | "music"
    | "voiceover"
    | "reference"
    | "other";
  filename: string;
  mimeType: string;
  bytes: number;
  /** Path on disk, inside the project's `storage/` folder. */
  localPath?: string;
  /** Publicly reachable URL — this is what Instagram and Facebook receive. */
  publicUrl?: string;
  /** Where it is hosted: local | cloudinary | catbox | imgbb | external */
  host: string;
  width?: number;
  height?: number;
  /** Seconds, for video and audio. */
  duration?: number;
  /** For AI output: which provider produced it, and from which prompt. */
  provider?: string;
  prompt?: string;
  /** Lets unused media be cleaned up automatically. */
  expiresAt?: Date;
  createdBy?: ObjectId;
};

/** A live document, with `save()` attached. */
export type MediaAssetDocument = HydratedDocument<MediaAssetDoc>;

const MediaAssetSchema = new Schema(
  {
    brand: { type: Schema.Types.ObjectId, ref: "Brand", index: true },

    kind: {
      type: String,
      enum: ["image", "video", "audio", "other"],
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: [
        "product",   // a product image uploaded by the user
        "avatar",    // the user's own photo or model
        "generated", // an AI-generated image
        "keyframe",  // the still behind one reel scene
        "clip",      // an AI-generated video clip for a scene
        "reel",      // the finished rendered video
        "thumbnail", // the reel cover
        "music",     // background track
        "voiceover", // text-to-speech audio
        "reference", // a reference reel supplied by the user
        "other",
      ],
      default: "other",
      index: true,
    },

    filename: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true, trim: true },
    bytes: { type: Number, default: 0 },

    localPath: { type: String, trim: true },
    publicUrl: { type: String, trim: true },
    host: { type: String, trim: true, default: "local" },

    width: { type: Number },
    height: { type: Number },
    duration: { type: Number },

    provider: { type: String, trim: true },
    prompt: { type: String, trim: true },

    expiresAt: { type: Date },

    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

MediaAssetSchema.index({ brand: 1, role: 1, createdAt: -1 });

export const MediaAsset = model<MediaAssetDoc>("MediaAsset", MediaAssetSchema);
