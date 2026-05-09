import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db/prisma.client";

interface FailureParams {
  id: string;
}

export async function failureController(
  req: FastifyRequest<{ Params: FailureParams }>,
  reply: FastifyReply
): Promise<void> {
  const { id } = req.params;

  const image = await prisma.image.findUnique({
    where: { id },
    select: { id: true, status: true, failureReason: true },
  });

  if (!image) {
    return reply.status(404).send({ error: `Image not found: ${id}` });
  }

  if (image.status !== "failed") {
    return reply.status(400).send({
      error: "Image has not failed processing",
      status: image.status,
    });
  }

  return reply.status(200).send({
    id: image.id,
    failureReason: image.failureReason,
  });
}
