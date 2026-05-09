import { FastifyInstance } from "fastify";
import { resultsController } from "../controllers/results.controller";

export async function resultsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/results/:id",
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
              status: { type: "string", enum: ["completed"] },
              results: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    checkName: { type: "string" },
                    passed: { type: "boolean" },
                    confidence: { type: "number" },
                    message: { type: ["string", "null"] },
                  },
                  required: ["checkName", "passed", "confidence", "message"],
                },
              },
            },
            required: ["id", "status", "results"],
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
    resultsController
  );
}
