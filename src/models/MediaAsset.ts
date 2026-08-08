import mongoose, {
  Schema,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
} from "mongoose";

/**
 * Ek media file — upload kareli product image, AI e banaveli image,
 * render thayelo reel, ke music track.
 *
 * Instagram ne PUBLIC https URL joiye j che, etle dareak asset ne be URL hoy:
 *   localPath — aapna disk par, render pipeline mate
 *   publicUrl — bahar thi khuli shakay evu (CDN / tunnel / /api/media)
 */
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
        "product",       // user e upload kareli product image
        "avatar",        // user no potano photo / model
        "generated",     // AI e banaveli image
        "keyframe",      // reel na scene ni image
        "clip",          // AI e banavelu scene nu video (Omni)
        "reel",          // final render thayelo video
        "thumbnail",     // reel no cover
        "music",         // background track
        "voiceover",     // TTS audio
        "reference",     // reference reel je user e aapyo
        "other",
      ],
      default: "other",
      index: true,
    },

    filename: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true, trim: true },
    bytes: { type: Number, default: 0 },

    /** Disk par nu path (repo ni andar `storage/` folder). */
    localPath: { type: String, trim: true },
    /** Bahar thi khuli shakay evu URL — IG/FB ne aa aapiye chie. */
    publicUrl: { type: String, trim: true },
    /** Kaya host par mukyu — local | cloudinary | catbox | imgbb | external */
    host: { type: String, trim: true, default: "local" },

    width: { type: Number },
    height: { type: Number },
    /** Video/audio mate — seconds. */
    duration: { type: Number },

    /** AI e banavi hoy to kaya provider e ane kaya prompt thi. */
    provider: { type: String, trim: true },
    prompt: { type: String, trim: true },

    /** Vagar vaparelu media aapoaap saaf karva mate. */
    expiresAt: { type: Date },

    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

MediaAssetSchema.index({ brand: 1, role: 1, createdAt: -1 });

export type MediaAssetDoc = InferSchemaType<typeof MediaAssetSchema> & {
  _id: mongoose.Types.ObjectId;
};

/** DB mathi aavelu jivant document — `.save()` jevi methods sathe. */
export type MediaAssetDocument = HydratedDocument<MediaAssetDoc>;

export const MediaAsset: Model<MediaAssetDoc> =
  (mongoose.models.MediaAsset as Model<MediaAssetDoc>) ||
  mongoose.model<MediaAssetDoc>("MediaAsset", MediaAssetSchema);
