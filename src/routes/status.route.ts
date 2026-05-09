import { FastifyInstance } from "fastify";
import { statusController } from "../controllers/status.controller";

export async function statusRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/status/:id",
    {
      schema: {
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string" },
              status: { type: "string", enum: ["pending", "processing", "completed", "failed"] },
              createdAt: { type: "string", format: "date-time" },
              updatedAt: { type: "string", format: "date-time" },
            },
            required: ["id", "status", "createdAt", "updatedAt"],
          },
          404: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    statusController
  );
}
