import { FastifyInstance } from "fastify";
import { uploadController } from "../controllers/upload.controller";

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/upload",
    {
      schema: {
        response: {
          201: {
            type: "object",
            properties: {
              id: { type: "string" },
              status: { type: "string", enum: ["pending"] },
            },
            required: ["id", "status"],
          },
          400: {
            type: "object",
            properties: { error: { type: "string" } },
          },
          413: {
            type: "object",
            properties: { error: { type: "string" } },
          },
          415: {
            type: "object",
            properties: { error: { type: "string" } },
          },
          500: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    uploadController
  );
}
