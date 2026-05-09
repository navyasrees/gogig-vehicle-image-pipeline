import { FastifyInstance } from "fastify";
import { failureController } from "../controllers/failure.controller";

export async function failureRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/failure/:id",
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
              failureReason: { type: ["string", "null"] },
            },
            required: ["id", "failureReason"],
          },
          400: {
            type: "object",
            properties: {
              error: { type: "string" },
              status: { type: "string" },
            },
          },
          404: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    failureController
  );
}
