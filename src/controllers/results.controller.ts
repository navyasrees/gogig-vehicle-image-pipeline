import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db/prisma.client";

interface ResultsParams {
  id: string;
}

export async function resultsController(
  req: FastifyRequest<{ Params: ResultsParams }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = req.params;

  const image = await prisma.image.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      analysisResults: {
        select: {
          checkName: true,
          passed: true,
          confidence: true,
          message: true,
        },
      },
    },
  });

  if (!image) {
    return reply.status(404).send({ error: `Image not found: ${id}` });
  }

  if (image.status !== "completed") {
    return reply.status(400).send({
      error: "Processing not complete",
      status: image.status,
    });
  }

  return reply.status(200).send({
    id: image.id,
    status: image.status,
    results: image.analysisResults.map((r) => ({
      checkName: r.checkName,
      passed: r.passed,
      confidence: r.confidence,
      message: r.message,
    })),
  });
}
